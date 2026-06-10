// tests/devtools-inspector-pbt.test.ts
// Property-based test for the API Inspector failure path (Req 7.5).
// Kept in its own file so it does not clobber the example/edge-case unit tests
// in devtools.test.ts. The universal property here is exercised across many
// generated request inputs and errors; concrete examples live in devtools.test.ts.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { inspectorFailure, type InspectorRequest } from '../devx/devtools.js';

// ── Generators ────────────────────────────────────────────────────────────────
//
// Intelligently constrain to the InspectorRequest input space:
//  - method: any HTTP-verb-ish token (kept simple; case/value is retained verbatim).
//  - url: any string — the inspector must retain whatever was submitted.
//  - headers: optional record of string→string.
//  - body: optional string.
// The optional fields are sometimes absent so the property also covers requests
// that omit headers and/or body.

const headersArb: fc.Arbitrary<Record<string, string>> = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 12 }),
  fc.string({ maxLength: 24 }),
  { maxKeys: 6 },
);

const requestArb: fc.Arbitrary<InspectorRequest> = fc.record(
  {
    method: fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'get', 'post'),
    url: fc.string({ maxLength: 40 }),
    headers: headersArb,
    body: fc.string({ maxLength: 40 }),
  },
  { requiredKeys: ['method', 'url'] },
);

/**
 * An arbitrary error value. The inspector accepts `unknown`, so cover the realistic
 * cases: an Error instance (message is used), and non-Error values that get coerced
 * via String(...) — including empty-ish values that trigger the 'Request failed'
 * fallback.
 */
const errorArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.string().map((m) => new Error(m)),
  fc.string(),
  fc.integer(),
  fc.constantFrom(null, undefined, 0, false, ''),
);

// Feature: platform-leadership-gaps, Property 19: A failed inspector request retains its input
// Validates: Requirements 7.5
describe('Property 19: a failed inspector request retains its input', () => {
  it('inspectorFailure(request, error) reports an error and retains the submitted request verbatim', () => {
    fc.assert(
      fc.property(requestArb, errorArb, (request, error) => {
        const result = inspectorFailure(request, error);

        // 1. Failure is indicated.
        assert.equal(result.ok, false, 'a failed request must have ok=false');

        // 2. An error message is present and non-empty (the 'Request failed'
        //    fallback guarantees this even for empty/falsy error values).
        assert.equal(typeof result.error, 'string', 'error must be a string');
        assert.ok((result.error as string).length > 0, 'error message must be non-empty');

        // 3. The submitted request input is retained exactly (deep equality).
        assert.deepEqual(result.request, request, 'the submitted request must be retained verbatim');

        // 4. When the error is an Error, its message is surfaced (unless empty,
        //    in which case the non-empty fallback applies).
        if (error instanceof Error) {
          assert.equal(result.error, error.message || 'Request failed');
        }
      }),
      { numRuns: 200 },
    );
  });
});
