// tests/validation-determinism-pbt.test.ts
// Property-based test for the runtime input Validator (Phase 1, Requirement 2).
//
// Feature: consumer-platform-security, Property 1 — Validation determinism and
// conforming pass-through.
// Validates: Requirements 2.2, 2.9
//
// This file proves two things across arbitrary Validation_Schemas and conforming
// inputs spanning every External_Input source (body, query, params, headers,
// cookies):
//   1. Conforming pass-through (R2.2): when a route declares a schema for a
//      source and the request supplies a conforming value, `validate()` runs the
//      handler and exposes the parsed/typed value at `ctx.state.valid.<source>`
//      (and never invents values for undeclared sources).
//   2. Determinism (R2.9): validating the same conforming input repeatedly yields
//      a value structurally equal to the schema-parsed value every time.
//
// Kept in its own *-pbt.test.ts file per the repo convention so the universal
// property is exercised across many generated inputs without disturbing the
// example/edge-case unit tests for the Validator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { z } from 'zod';
import type { ZodTypeAny } from 'zod';

import { validate, type InputSource, type RouteSchemas } from '../security/validation.js';
import type { StreetContext } from '../core/context.js';

const NUM_RUNS = 100;

const SOURCES: readonly InputSource[] = ['body', 'query', 'params', 'headers', 'cookies'];

// ── A minimal StreetContext stand-in ─────────────────────────────────────────
//
// `validate()` only reads the per-source raw inputs (ctx.body / query / params /
// headers, with cookies parsed from the `cookie` header) and writes the parsed
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

// Characters safe to place directly into a Cookie header value: no ';', '=',
// ',', or whitespace, so encode/decode is the identity and parseCookies recovers
// exactly the record we built the header from.
const ALNUM = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const alnumStr: fc.Arbitrary<string> = fc
  .array(fc.constantFrom(...ALNUM), { maxLength: 8 })
  .map((cs) => cs.join(''));

// A recursive (schema, conforming-value-generator) pair used for the `body`
// source, where the raw input may be any JSON-serializable shape. Each spec
// carries its own value arbitrary so arrays/objects stay homogeneous and every
// generated value is guaranteed to conform to its schema.
interface TypeSpec {
  schema: ZodTypeAny;
  valueArb: fc.Arbitrary<unknown>;
}

const OBJECT_KEYS = ['a', 'b', 'c', 'd'] as const;

const typeSpecArb: fc.Arbitrary<TypeSpec> = fc.letrec<{ t: TypeSpec }>((tie) => ({
  t: fc.oneof(
    { maxDepth: 3 },
    fc.constant<TypeSpec>({ schema: z.string(), valueArb: fc.string() }),
    fc.constant<TypeSpec>({ schema: z.number().int(), valueArb: fc.integer() }),
    fc.constant<TypeSpec>({ schema: z.boolean(), valueArb: fc.boolean() }),
    tie('t').map((el) => ({
      schema: z.array(el.schema),
      valueArb: fc.array(el.valueArb, { maxLength: 4 }),
    })),
    fc
      .dictionary(fc.constantFrom(...OBJECT_KEYS), tie('t'), { maxKeys: 4 })
      .map((shape) => {
        const zshape: Record<string, ZodTypeAny> = {};
        const valueArbs: Record<string, fc.Arbitrary<unknown>> = {};
        for (const [key, spec] of Object.entries(shape)) {
          zshape[key] = spec.schema;
          valueArbs[key] = spec.valueArb;
        }
        return {
          schema: z.object(zshape),
          valueArb: fc.record(valueArbs),
        } as TypeSpec;
      }),
  ),
})).t;

/** A concrete (schema, conforming value) pair for the `body` source. */
const bodySchemaValueArb: fc.Arbitrary<{ schema: ZodTypeAny; value: unknown }> = typeSpecArb.chain(
  (spec) => spec.valueArb.map((value) => ({ schema: spec.schema, value })),
);

/**
 * A string-record source (query/params/headers/cookies are `Record<string,string>`
 * at runtime). Produces a record plus a `z.object` of per-key `z.string()` that
 * accepts it exactly.
 */
const stringRecordArb = (keyPool: readonly string[]): fc.Arbitrary<{ schema: ZodTypeAny; record: Record<string, string> }> =>
  fc.dictionary(fc.constantFrom(...keyPool), alnumStr, { maxKeys: 4 }).map((record) => {
    const shape: Record<string, ZodTypeAny> = {};
    for (const key of Object.keys(record)) shape[key] = z.string();
    return { schema: z.object(shape), record };
  });

const recordSourceArb = stringRecordArb(['x', 'y', 'z', 'w']);
// Cookie keys deliberately exclude "cookie" so a co-declared `headers` source
// (whose raw includes the synthesized cookie header) strips it cleanly.
const cookieSourceArb = stringRecordArb(['sid', 'csrf', 'theme', 'lang']);

interface Plan {
  schemas: RouteSchemas;
  ctxParts: CtxParts;
  expected: Partial<Record<InputSource, unknown>>;
  declaredSources: InputSource[];
}

function buildCookieHeader(record: Record<string, string>): string {
  return Object.entries(record)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

// A plan declares a non-empty subset of sources, supplies a conforming raw input
// for each, and records the expected parsed value (computed independently via the
// schema's own `parse`, so the property compares the middleware's output against
// the schema contract rather than against itself).
const planArb: fc.Arbitrary<Plan> = fc
  .record({
    body: fc.option(bodySchemaValueArb, { nil: undefined }),
    query: fc.option(recordSourceArb, { nil: undefined }),
    params: fc.option(recordSourceArb, { nil: undefined }),
    headers: fc.option(recordSourceArb, { nil: undefined }),
    cookies: fc.option(cookieSourceArb, { nil: undefined }),
  })
  .filter((r) => Object.values(r).some((v) => v !== undefined))
  .map((r) => {
    const schemas: RouteSchemas = {};
    const expected: Partial<Record<InputSource, unknown>> = {};
    const declaredSources: InputSource[] = [];
    const ctxParts: CtxParts = { query: {}, params: {}, headers: {} };

    if (r.body) {
      schemas.body = r.body.schema;
      ctxParts.body = r.body.value;
      expected.body = r.body.schema.parse(r.body.value);
      declaredSources.push('body');
    }
    if (r.query) {
      schemas.query = r.query.schema;
      ctxParts.query = r.query.record;
      expected.query = r.query.schema.parse(r.query.record);
      declaredSources.push('query');
    }
    if (r.params) {
      schemas.params = r.params.schema;
      ctxParts.params = r.params.record;
      expected.params = r.params.schema.parse(r.params.record);
      declaredSources.push('params');
    }
    if (r.headers) {
      schemas.headers = r.headers.schema;
      Object.assign(ctxParts.headers, r.headers.record);
      declaredSources.push('headers');
      // expected.headers computed after a potential cookie header is merged in,
      // since the `headers` raw includes everything on ctx.headers.
    }
    if (r.cookies) {
      schemas.cookies = r.cookies.schema;
      ctxParts.headers['cookie'] = buildCookieHeader(r.cookies.record);
      expected.cookies = r.cookies.schema.parse(r.cookies.record);
      declaredSources.push('cookies');
    }
    if (r.headers) {
      // z.object strips the unknown `cookie` key, recovering the original record.
      expected.headers = r.headers.schema.parse(ctxParts.headers);
    }

    return { schemas, ctxParts, expected, declaredSources };
  });

// ── Properties ────────────────────────────────────────────────────────────────

// Feature: consumer-platform-security, Property 1: Validation determinism and conforming pass-through
// Validates: Requirements 2.2, 2.9
describe('Property 1: validation determinism and conforming pass-through', () => {
  it('passes the parsed/typed value of every declared source to the handler (R2.2)', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        const ctx = makeCtx(plan.ctxParts);
        let handlerRan = false;

        // A conforming request must reach the handler; no ValidationError is thrown.
        await validate(plan.schemas)(ctx, async () => {
          handlerRan = true;
        });

        assert.equal(handlerRan, true);

        const valid = (ctx.state as Record<string, unknown>)['valid'] as Record<string, unknown>;
        assert.ok(valid && typeof valid === 'object');

        // Every declared source's parsed value is exposed and equals the schema's parse.
        for (const source of plan.declaredSources) {
          assert.deepEqual(valid[source], plan.expected[source]);
        }

        // No value is invented for a source that was not declared.
        for (const source of SOURCES) {
          if (!plan.declaredSources.includes(source)) {
            assert.equal(source in valid, false);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('repeated validation of the same conforming input is structurally equal (R2.9)', async () => {
    await fc.assert(
      fc.asyncProperty(planArb, async (plan) => {
        const runOnce = async (): Promise<unknown> => {
          const ctx = makeCtx(plan.ctxParts);
          await validate(plan.schemas)(ctx, async () => {});
          return (ctx.state as Record<string, unknown>)['valid'];
        };

        const first = await runOnce();
        const second = await runOnce();

        // Determinism: identical input ⇒ structurally equal validated state.
        assert.deepEqual(first, second);

        // …and that state equals the independent schema-parsed value for each source.
        for (const source of plan.declaredSources) {
          assert.deepEqual((first as Record<string, unknown>)[source], plan.expected[source]);
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
