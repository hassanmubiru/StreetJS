// tests/validation-rejection-pbt.test.ts
// Property-based test for the runtime input Validator (Phase 1, Requirement 2).
//
// Feature: consumer-platform-security, Property 2 — Invalid input is rejected
// safely before the handler runs.
// Validates: Requirements 2.3, 2.4, 2.5
//
// Across arbitrary Validation_Schemas declared over every External_Input source
// (body, query, params, headers, cookies) paired with deliberately
// non-conforming inputs, this file proves three things:
//   1. Safe, pre-handler rejection (R2.3): `validate()` throws a ValidationError
//      carrying HTTP status 400 BEFORE calling next(), so the route handler never
//      begins execution at all.
//   2. Complete failing-field reporting (R2.4): the serialized error lists every
//      failing field path together with a non-empty reason, and exactly those
//      paths that were broken — no more, no fewer.
//   3. Safe formatting (R2.5): the serialized response body excludes raw stack
//      traces and internal type information; each issue carries only `path` and
//      `message`.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs without disturbing the
// example/edge-case unit tests for the Validator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { z } from 'zod';

import { validate, ValidationError, type InputSource, type RouteSchemas } from '../security/validation.js';
import type { StreetContext } from '../core/context.js';

const NUM_RUNS = 100;

const SOURCES: readonly InputSource[] = ['body', 'query', 'params', 'headers', 'cookies'];

// ── A minimal StreetContext stand-in ─────────────────────────────────────────
//
// `validate()` only reads the per-source raw inputs (ctx.body / query / params /
// headers, with cookies parsed from the `cookie` header). A small object carrying
// exactly those fields is a faithful substrate for the property and avoids
// spinning up a real HTTP server.
interface CtxParts {
  body?: unknown;
  query: Record<string, string>;
  params: Record<string, string>;
  headers: Record<string, string>;
}

function makeCtx(parts: CtxParts): StreetContext {
  return {
    body: parts.body ?? null,
    query: { ...parts.query },
    params: { ...parts.params },
    headers: { ...parts.headers },
    state: {},
  } as unknown as StreetContext;
}

// ── Generators ────────────────────────────────────────────────────────────────

// Distinct, non-colliding key pools per source. Cookie keys deliberately exclude
// "cookie" so a co-declared `headers` source (whose raw includes the synthesized
// cookie header) does not interfere.
const KEY_POOLS: Record<InputSource, readonly string[]> = {
  body: ['a', 'b', 'c', 'd'],
  query: ['q1', 'q2', 'q3', 'q4'],
  params: ['p1', 'p2', 'p3', 'p4'],
  headers: ['h1', 'h2', 'h3', 'h4'],
  cookies: ['sid', 'csrf', 'theme', 'lang'],
};

// Alphanumeric values are safe to place directly into a Cookie header value (no
// ';', '=', or whitespace) so present keys round-trip cleanly and only the
// omitted keys fail validation.
const ALNUM = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
const alnumStr: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(''));

/**
 * For one source, choose a set of declared string-typed keys and partition them
 * into `present` (a conforming value is supplied) and `missing` (the key is
 * omitted from the raw input, so the required string fails as `undefined`). The
 * schema is `z.object({ key: z.string(), ... })` over every declared key.
 */
interface SourcePlan {
  schema: z.ZodObject<Record<string, z.ZodString>>;
  present: Record<string, string>;
  missingKeys: string[];
}

function sourcePlanArb(source: InputSource): fc.Arbitrary<SourcePlan> {
  const pool = KEY_POOLS[source];
  return fc
    .uniqueArray(fc.constantFrom(...pool), { minLength: 1, maxLength: pool.length })
    .chain((keys) =>
      // Decide for each declared key whether it is present (true) or missing (false).
      fc
        .tuple(
          fc.array(fc.boolean(), { minLength: keys.length, maxLength: keys.length }),
          fc.array(alnumStr, { minLength: keys.length, maxLength: keys.length }),
        )
        .map(([flags, values]) => {
          const shape: Record<string, z.ZodString> = {};
          const present: Record<string, string> = {};
          const missingKeys: string[] = [];
          keys.forEach((key, i) => {
            shape[key] = z.string();
            if (flags[i]) {
              present[key] = values[i] as string;
            } else {
              missingKeys.push(key);
            }
          });
          return { schema: z.object(shape), present, missingKeys } satisfies SourcePlan;
        }),
    );
}

interface Plan {
  schemas: RouteSchemas;
  ctxParts: CtxParts;
  /** All field paths that must appear (and only these) in the error. */
  expectedFailingPaths: string[];
}

function buildCookieHeader(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

/**
 * A plan declares a non-empty subset of sources, supplies a partially-present
 * raw input for each, and guarantees AT LEAST ONE missing key overall so the
 * request is genuinely non-conforming. `expectedFailingPaths` is computed
 * independently of the Validator (from the omitted keys) so the property
 * compares the Validator's reported paths against the contract, not itself.
 */
const planArb: fc.Arbitrary<Plan> = fc
  .record({
    body: fc.option(sourcePlanArb('body'), { nil: undefined }),
    query: fc.option(sourcePlanArb('query'), { nil: undefined }),
    params: fc.option(sourcePlanArb('params'), { nil: undefined }),
    headers: fc.option(sourcePlanArb('headers'), { nil: undefined }),
    cookies: fc.option(sourcePlanArb('cookies'), { nil: undefined }),
  })
  .filter((r) => SOURCES.some((s) => r[s] !== undefined))
  // At least one missing key across all declared sources ⇒ guaranteed rejection.
  .filter((r) => SOURCES.some((s) => (r[s]?.missingKeys.length ?? 0) > 0))
  .map((r) => {
    const schemas: RouteSchemas = {};
    const expectedFailingPaths: string[] = [];
    const ctxParts: CtxParts = { query: {}, params: {}, headers: {} };

    const apply = (source: InputSource, plan: SourcePlan | undefined): void => {
      if (!plan) return;
      schemas[source] = plan.schema;
      for (const key of plan.missingKeys) expectedFailingPaths.push(`${source}.${key}`);
    };

    apply('body', r.body);
    if (r.body) ctxParts.body = { ...r.body.present };

    apply('query', r.query);
    if (r.query) ctxParts.query = { ...r.query.present };

    apply('params', r.params);
    if (r.params) ctxParts.params = { ...r.params.present };

    apply('headers', r.headers);
    if (r.headers) Object.assign(ctxParts.headers, r.headers.present);

    apply('cookies', r.cookies);
    if (r.cookies) ctxParts.headers['cookie'] = buildCookieHeader(r.cookies.present);

    return { schemas, ctxParts, expectedFailingPaths };
  });

// ── Properties ────────────────────────────────────────────────────────────────

// Feature: consumer-platform-security, Property 2: Invalid input is rejected safely before the handler runs
// Validates: Requirements 2.3, 2.4, 2.5
describe('Property 2: invalid input is rejected safely before the handler runs', () => {
  it('rejects with status 400 before the handler runs, reports every failing path, and leaks nothing (R2.3/R2.4/R2.5)', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        const ctx = makeCtx(plan.ctxParts);
        let handlerRan = false;

        let thrown: unknown;
        try {
          await validate(plan.schemas)(ctx, async () => {
            handlerRan = true;
          });
        } catch (err) {
          thrown = err;
        }

        // R2.3: the handler must NEVER run on invalid input…
        assert.equal(handlerRan, false);
        // …no validated state is exposed…
        const valid = (ctx.state as Record<string, unknown> | undefined)?.['valid'];
        assert.equal(valid, undefined);
        // …and rejection is a ValidationError carrying HTTP 400.
        assert.ok(thrown instanceof ValidationError);
        const error = thrown as ValidationError;
        assert.equal(error.status, 400);

        // R2.4: every failing field path is reported with a non-empty reason, and
        // the reported set is EXACTLY the set of broken paths (no more, no fewer).
        const reportedPaths = error.issues.map((i) => i.path).sort();
        const expectedPaths = [...plan.expectedFailingPaths].sort();
        assert.deepEqual(reportedPaths, expectedPaths);
        for (const issue of error.issues) {
          assert.equal(typeof issue.path, 'string');
          assert.equal(typeof issue.message, 'string');
          assert.ok(issue.message.length > 0);
        }

        // R2.5: the serialized body excludes stack traces and internal type info.
        const body = error.toResponse();
        const jsonBody = error.toJSON();
        assert.deepEqual(jsonBody, body);
        assert.equal(body.error, 'ValidationError');

        // Each issue object carries ONLY path + message — no Zod-internal fields
        // (e.g. `code`, `expected`, `received`) and no stack trace.
        for (const issue of body.issues) {
          assert.deepEqual(Object.keys(issue).sort(), ['message', 'path']);
        }

        // The full serialized payload must not embed the raw stack trace or a
        // `stack` field anywhere.
        const serialized = JSON.stringify(body);
        assert.equal(serialized.includes('"stack"'), false);
        assert.equal(serialized.includes('\n    at '), false);
        if (error.stack) {
          assert.equal(serialized.includes(error.stack), false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
