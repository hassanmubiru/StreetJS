// tests/validation-safe-rejection-pbt.test.ts
// Property-based test for the runtime input Validator (Phase 1, Requirement 2).
//
// Feature: consumer-platform-security, Property 2 — Invalid input is rejected
// safely before the handler runs.
// Validates: Requirements 2.3, 2.4, 2.5
//
// Across arbitrary Validation_Schemas and NON-conforming inputs spanning every
// External_Input source (body, query, params, headers, cookies), this file
// proves three things:
//   1. Reject-before-handler (R2.3): when any declared source supplies a value
//      that does not conform, `validate()` throws a ValidationError (HTTP 400)
//      BEFORE calling `next()`, so the route handler never begins execution.
//   2. Field-path + reason reporting (R2.4): the thrown ValidationError's
//      serialized form lists exactly the failing field paths, each with a
//      non-empty reason string.
//   3. Safe formatting (R2.5): the serialized response body contains only
//      `{ error, issues: [{ path, message }] }` — no stack traces and no
//      internal type/implementation structure.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs alongside (not inside) the
// example/edge-case unit tests for the Validator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import { validate, ValidationError, type RouteSchemas } from '../security/validation.js';
import type { StreetContext } from '../core/context.js';

const NUM_RUNS = 100;

// ── A minimal StreetContext stand-in ─────────────────────────────────────────
//
// `validate()` only reads the per-source raw inputs (ctx.body / query / params /
// headers, with cookies parsed from the `cookie` header) and writes parsed
// values to `ctx.state.valid`. A small object carrying exactly those fields is a
// faithful substrate for the property and avoids spinning up a real HTTP server.
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

const ALNUM = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const alnumStr: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALNUM), { minLength: 1, maxLength: 8 })
  .map((cs) => cs.join(''));

// Per-field plan: each key is either conforming or guaranteed to violate its
// schema. `violated` keys must produce a failing issue at path `<source>.<key>`.
interface FieldPlan {
  violated: boolean;
}

/**
 * Build a record source (query/params/headers/cookies). At runtime these are
 * `Record<string,string>`, so a key declared as `z.number()` with a string
 * value is GUARANTEED to fail (z.number does not coerce), while a key declared
 * as `z.string()` always passes. Returns the schema, the raw string record, and
 * the set of failing keys.
 */
function buildRecordSource(fields: Record<string, FieldPlan>): {
  schema: ZodTypeAny;
  record: Record<string, string>;
  violatedKeys: string[];
} {
  const shape: Record<string, ZodTypeAny> = {};
  const record: Record<string, string> = {};
  const violatedKeys: string[] = [];
  for (const [key, plan] of Object.entries(fields)) {
    record[key] = 'v'; // a non-numeric string value, present for every key
    if (plan.violated) {
      shape[key] = z.number(); // string value can never satisfy z.number()
      violatedKeys.push(key);
    } else {
      shape[key] = z.string();
    }
  }
  return { schema: z.object(shape), record, violatedKeys };
}

/**
 * Build the `body` source as a `z.object`. A `violated` key is declared
 * `z.string()` but supplied a number value (guaranteed mismatch); a conforming
 * key is `z.string()` with a string value.
 */
function buildBodySource(fields: Record<string, FieldPlan>): {
  schema: ZodTypeAny;
  value: Record<string, unknown>;
  violatedKeys: string[];
} {
  const shape: Record<string, ZodTypeAny> = {};
  const value: Record<string, unknown> = {};
  const violatedKeys: string[] = [];
  for (const [key, plan] of Object.entries(fields)) {
    shape[key] = z.string();
    if (plan.violated) {
      value[key] = 1; // a number can never satisfy z.string()
      violatedKeys.push(key);
    } else {
      value[key] = 'ok';
    }
  }
  return { schema: z.object(shape), value, violatedKeys };
}

const fieldPlanArb: fc.Arbitrary<FieldPlan> = fc.record({ violated: fc.boolean() });

// A dictionary of 1-4 fields drawn from a fixed key pool (so per-source keys
// never collide with the `cookie` header used for the cookies source).
const fieldsArb = (keyPool: readonly string[]): fc.Arbitrary<Record<string, FieldPlan>> =>
  fc.dictionary(fc.constantFrom(...keyPool), fieldPlanArb, { minKeys: 1, maxKeys: 4 });

function buildCookieHeader(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

interface Plan {
  schemas: RouteSchemas;
  ctxParts: CtxParts;
  /** Fully-qualified `<source>.<key>` paths that MUST appear as issues. */
  expectedFailingPaths: string[];
}

// A plan declares a non-empty subset of sources, supplies a raw input for each,
// and is constrained so AT LEAST ONE field across the whole plan is violated —
// guaranteeing the request must be rejected.
const planArb: fc.Arbitrary<Plan> = fc
  .record({
    body: fc.option(fieldsArb(['a', 'b', 'c', 'd']), { nil: undefined }),
    query: fc.option(fieldsArb(['x', 'y', 'z', 'w']), { nil: undefined }),
    params: fc.option(fieldsArb(['p', 'q', 'r', 's']), { nil: undefined }),
    headers: fc.option(fieldsArb(['hx', 'hy', 'hz', 'hw']), { nil: undefined }),
    cookies: fc.option(fieldsArb(['sid', 'csrf', 'theme', 'lang']), { nil: undefined }),
  })
  .filter((r) => Object.values(r).some((v) => v !== undefined))
  .map((r) => {
    const schemas: RouteSchemas = {};
    const ctxParts: CtxParts = { query: {}, params: {}, headers: {} };
    const expectedFailingPaths: string[] = [];

    if (r.body) {
      const built = buildBodySource(r.body);
      schemas.body = built.schema;
      ctxParts.body = built.value;
      for (const k of built.violatedKeys) expectedFailingPaths.push(`body.${k}`);
    }
    if (r.query) {
      const built = buildRecordSource(r.query);
      schemas.query = built.schema;
      ctxParts.query = built.record;
      for (const k of built.violatedKeys) expectedFailingPaths.push(`query.${k}`);
    }
    if (r.params) {
      const built = buildRecordSource(r.params);
      schemas.params = built.schema;
      ctxParts.params = built.record;
      for (const k of built.violatedKeys) expectedFailingPaths.push(`params.${k}`);
    }
    if (r.headers) {
      const built = buildRecordSource(r.headers);
      schemas.headers = built.schema;
      Object.assign(ctxParts.headers, built.record);
      for (const k of built.violatedKeys) expectedFailingPaths.push(`headers.${k}`);
    }
    if (r.cookies) {
      const built = buildRecordSource(r.cookies);
      schemas.cookies = built.schema;
      ctxParts.headers['cookie'] = buildCookieHeader(built.record);
      for (const k of built.violatedKeys) expectedFailingPaths.push(`cookies.${k}`);
    }

    return { schemas, ctxParts, expectedFailingPaths };
  })
  // Guarantee non-conformance: at least one field must violate its schema.
  .filter((plan) => plan.expectedFailingPaths.length > 0);

// ── Properties ────────────────────────────────────────────────────────────────

// Feature: consumer-platform-security, Property 2: Invalid input is rejected safely before the handler runs
// Validates: Requirements 2.3, 2.4, 2.5
describe('Property 2: invalid input is rejected safely before the handler runs', () => {
  it('rejects with HTTP 400 before next(); the handler never runs (R2.3)', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        const ctx = makeCtx(plan.ctxParts);
        let handlerRan = false;

        let thrown: unknown;
        try {
          await validate(plan.schemas)(ctx, async () => {
            handlerRan = true;
          });
          assert.fail('validate() should have rejected non-conforming input');
        } catch (err) {
          thrown = err;
        }

        // The handler must never have begun execution.
        assert.equal(handlerRan, false);

        // Rejection is a ValidationError carrying HTTP status 400.
        assert.ok(thrown instanceof ValidationError);
        assert.equal((thrown as ValidationError).status, 400);

        // No validated state is exposed on a rejected request.
        const valid = (ctx.state as Record<string, unknown>)['valid'];
        assert.equal(valid, undefined);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('lists exactly the failing field paths, each with a reason (R2.4)', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        const ctx = makeCtx(plan.ctxParts);

        const err = await validate(plan.schemas)(ctx, async () => {}).then(
          () => {
            throw new Error('expected rejection');
          },
          (e: unknown) => e,
        );

        assert.ok(err instanceof ValidationError);

        const issuePaths = err.issues.map((i) => i.path).sort();
        assert.deepEqual(issuePaths, [...plan.expectedFailingPaths].sort());

        // Every reported issue carries a non-empty reason string.
        for (const issue of err.issues) {
          assert.equal(typeof issue.message, 'string');
          assert.ok(issue.message.length > 0);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('serializes to a safe body with no stack traces or internal types (R2.5)', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        const ctx = makeCtx(plan.ctxParts);

        const err = await validate(plan.schemas)(ctx, async () => {}).then(
          () => {
            throw new Error('expected rejection');
          },
          (e: unknown) => e,
        );

        assert.ok(err instanceof ValidationError);

        // The error does carry a stack internally (it is an Error)…
        assert.equal(typeof err.stack, 'string');

        // …but the serialized body exposes ONLY { error, issues:[{path,message}] }.
        for (const body of [err.toResponse(), err.toJSON()]) {
          const round = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;
          assert.deepEqual(Object.keys(round).sort(), ['error', 'issues']);
          assert.equal(round['error'], 'ValidationError');

          const issues = round['issues'] as Array<Record<string, unknown>>;
          assert.ok(Array.isArray(issues));
          for (const issue of issues) {
            // No stray fields (e.g. no `stack`, no internal Zod structure).
            assert.deepEqual(Object.keys(issue).sort(), ['message', 'path']);
          }

          // No stack-frame markers leak into the serialized body.
          const serialized = JSON.stringify(body);
          assert.equal(serialized.includes('\n    at '), false);
          assert.equal(/\bat \S+:\d+:\d+/.test(serialized), false);
          assert.equal(serialized.toLowerCase().includes('"stack"'), false);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
