// Property-based tests for the MarzPay plugin's argument validation and
// environment routing. Pure/offline — no network. Uses fast-check with Node's
// built-in test runner. Run: npm test -w packages/plugin-marzpay
//
// Covers two design.md Correctness Properties:
//   • Property 3 — Reference/identifier argument validation (Req 3.2, 3.3, 3.10)
//   • Property 2 — Environment selects the verified base address (Req 2.6)

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  buildVerifyPaymentRequest,
  buildGetTransactionRequest,
  buildListTransactionsRequest,
  MARZPAY_SPEC,
} from '../dist/index.js';

const RUNS = 200; // ≥100 iterations per property.

/** Base config; environment is overridden per-case. */
function cfgWith(environment) {
  const cfg = { apiKey: 'ak', secretKey: 'sk' };
  if (environment !== undefined) cfg.environment = environment;
  return cfg;
}

// ---------------------------------------------------------------------------
// Feature: marzpay-integration, Property 3: Reference/identifier argument
// validation — for all strings, verifyPayment and getTransaction build/send a
// request when the argument is non-empty after trimming and at most 256 chars,
// and otherwise raise a validation error identifying the argument and build no
// request.
// Validates: Requirements 3.2, 3.3, 3.10
// ---------------------------------------------------------------------------
describe('Property 3: Reference/identifier argument validation', () => {
  // A valid identifier: non-whitespace core (1..256 chars after trimming),
  // optionally padded with surrounding whitespace that the guard trims away.
  const validArg = fc
    .string({ minLength: 1, maxLength: 256 })
    // Constrain to non-whitespace so the core survives trimming and stays 1..256.
    .map((s) => s.replace(/\s/g, 'x'))
    .map((s) => (s.length === 0 ? 'x' : s))
    .chain((core) =>
      fc
        .tuple(
          fc.stringMatching(/^[ \t\n\r]*$/),
          fc.stringMatching(/^[ \t\n\r]*$/),
        )
        .map(([lead, trail]) => ({ raw: `${lead}${core}${trail}`, trimmed: core })),
    );

  // An invalid identifier: empty, whitespace-only, or >256 chars after trimming.
  const invalidArg = fc.oneof(
    fc.constant(''),
    // Whitespace-only strings of varying length.
    fc.stringMatching(/^[ \t\n\r]{1,12}$/),
    // Strings whose trimmed length exceeds 256 (built from a non-whitespace core).
    fc
      .integer({ min: 257, max: 600 })
      .map((n) => 'a'.repeat(n)),
  );

  it('builds requests for valid references/ids; URL carries the trimmed argument', () => {
    fc.assert(
      fc.property(
        validArg,
        fc.constantFrom('sandbox', 'production', undefined),
        ({ raw, trimmed }, environment) => {
          const cfg = cfgWith(environment);

          // The interpolated path segment is percent-encoded so a reference/id
          // containing `/`, `?`, `#`, `&`, spaces, or unicode cannot inject
          // path/query structure (Req 6.6, 13.7). The URL therefore carries the
          // ENCODED trimmed argument.
          const encodedTrimmed = encodeURIComponent(trimmed);

          const verifyReq = buildVerifyPaymentRequest(cfg, MARZPAY_SPEC, raw);
          assert.equal(verifyReq.method, 'GET');
          assert.ok(verifyReq.url.includes(encodedTrimmed), 'verify URL should contain the encoded trimmed reference');
          assert.ok(verifyReq.url.endsWith(`/transactions/${encodedTrimmed}`));

          const getReq = buildGetTransactionRequest(cfg, MARZPAY_SPEC, raw);
          assert.equal(getReq.method, 'GET');
          assert.ok(getReq.url.includes(encodedTrimmed), 'getTransaction URL should contain the encoded trimmed id');
          assert.ok(getReq.url.endsWith(`/transactions/${encodedTrimmed}`));
        },
      ),
      { numRuns: RUNS },
    );
  });

  it('rejects invalid references/ids naming the argument and builds no request', () => {
    fc.assert(
      fc.property(invalidArg, (arg) => {
        const cfg = cfgWith('sandbox');

        assert.throws(
          () => buildVerifyPaymentRequest(cfg, MARZPAY_SPEC, arg),
          /reference/,
          'verifyPayment must reject the invalid reference and name it',
        );
        assert.throws(
          () => buildGetTransactionRequest(cfg, MARZPAY_SPEC, arg),
          /\bid\b/,
          'getTransaction must reject the invalid id and name it',
        );
      }),
      { numRuns: RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: marzpay-integration, Property 2: Environment selects the verified
// base address — for all configs, the request builders direct requests to
// MARZPAY_SPEC.baseAddress[environment], defaulting to sandbox when no
// environment is provided.
//
// NOTE (research R2): the sandbox and production base addresses are the SAME
// single URL by design; the active mode is auto-detected from the account/key,
// not from the host. The property therefore asserts the built URL starts with
// MARZPAY_SPEC.baseAddress[resolvedEnv] for env ∈ {sandbox, production,
// undefined → sandbox}.
// Validates: Requirements 2.6
// ---------------------------------------------------------------------------
describe('Property 2: Environment selects the verified base address', () => {
  // A valid (1..256, non-whitespace) identifier for the lookup builders.
  const ident = fc
    .string({ minLength: 1, maxLength: 64 })
    .map((s) => s.replace(/\s/g, 'x'))
    .map((s) => (s.length === 0 ? 'x' : s));

  it('routes every builder to baseAddress[env], defaulting to sandbox', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('sandbox', 'production', undefined),
        ident,
        (environment, id) => {
          const cfg = cfgWith(environment);
          const resolvedEnv = environment ?? 'sandbox';
          const expectedBase = MARZPAY_SPEC.baseAddress[resolvedEnv];

          const verifyReq = buildVerifyPaymentRequest(cfg, MARZPAY_SPEC, id);
          assert.ok(
            verifyReq.url.startsWith(expectedBase),
            `verify URL ${verifyReq.url} should start with ${expectedBase}`,
          );

          const getReq = buildGetTransactionRequest(cfg, MARZPAY_SPEC, id);
          assert.ok(
            getReq.url.startsWith(expectedBase),
            `getTransaction URL ${getReq.url} should start with ${expectedBase}`,
          );

          const listReq = buildListTransactionsRequest(cfg, MARZPAY_SPEC);
          assert.ok(
            listReq.url.startsWith(expectedBase),
            `listTransactions URL ${listReq.url} should start with ${expectedBase}`,
          );
        },
      ),
      { numRuns: RUNS },
    );
  });
});
