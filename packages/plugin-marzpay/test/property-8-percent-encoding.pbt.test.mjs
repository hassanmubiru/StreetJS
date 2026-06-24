// Property-based test for the MarzPay plugin's URL construction safety. Pure /
// offline — no network. Uses fast-check with Node's built-in test runner.
// Run: npm test -w packages/plugin-marzpay
//
// Covers one design.md Correctness Property:
//   • Property 8 — Interpolated path and query segments are percent-encoded
//     (Req 6.6, 13.7)
//
// Feature: marzpay-scope-alignment, Property 8: Interpolated path and query
// segments are percent-encoded
//
// For any reference/identifier string (including ones containing `/`, `?`,
// `#`, `&`, spaces, or unicode), the built request URL carries
// `encodeURIComponent(reference)` in the interpolated PATH segment, and no raw
// structural delimiter from the identifier appears unencoded in the path or
// query portion of the URL. The path builders (`verifyPayment`,
// `getTransaction`) percent-encode via `encodeURIComponent`; the list builder
// composes its query string via `URLSearchParams`, which likewise encodes every
// structural delimiter.
//
// Validates: Requirements 6.6, 13.7

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  buildVerifyPaymentRequest,
  buildGetTransactionRequest,
  buildListTransactionsRequest,
  MARZPAY_SPEC,
} from '../dist/index.js';

const RUNS = 200; // ≥100 iterations.

/** Base config; environment overridden per-case. */
function cfgWith(environment) {
  const cfg = { apiKey: 'ak', secretKey: 'sk' };
  if (environment !== undefined) cfg.environment = environment;
  return cfg;
}

// Structural delimiters that, if left raw in the path/query, would let an
// attacker-controlled identifier inject URL structure.
const DELIMITERS = ['/', '?', '#', '&'];

// A reference/identifier generator that intentionally exercises structural
// delimiters, spaces, and unicode. The raw value trims to a non-empty core of
// at most 256 chars (the range the builders accept), so every generated value
// reaches the interpolation/query path rather than the validation-error path.
const identifier = fc
  .array(
    fc.oneof(
      // Structural delimiters + space (the dangerous cases).
      fc.constantFrom('/', '?', '#', '&', ' ', '=', '%', '+'),
      // Unicode (multi-byte, combining, emoji, non-latin).
      fc.constantFrom('é', 'ü', 'ß', 'ñ', '日', '本', '🎉', '☃', 'Ω'),
      // Ordinary identifier characters.
      fc.constantFrom('a', 'b', 'Z', '0', '9', '-', '_', '.'),
    ),
    { minLength: 1, maxLength: 256 },
  )
  .map((chars) => chars.join(''))
  // Guarantee a non-empty trimmed core so the value is accepted by the builders.
  .map((raw) => (raw.trim().length === 0 ? `x${raw}x` : raw))
  .map((raw) => ({ raw, trimmed: raw.trim() }))
  // raw ≤ 256 ⇒ trimmed ≤ 256; the guard requires trimmed ∈ [1, 256].
  .filter(({ trimmed }) => trimmed.length >= 1 && trimmed.length <= 256);

describe('Property 8: Interpolated path and query segments are percent-encoded', () => {
  it('encodes interpolated path/query segments; no raw delimiter leaks into the URL', () => {
    fc.assert(
      fc.property(
        identifier,
        fc.constantFrom('sandbox', 'production', undefined),
        ({ raw, trimmed }, environment) => {
          const cfg = cfgWith(environment);
          const base = MARZPAY_SPEC.baseAddress[environment ?? 'sandbox'];
          const encoded = encodeURIComponent(trimmed);

          // --- Path builders: verifyPayment + getTransaction ------------------
          for (const build of [buildVerifyPaymentRequest, buildGetTransactionRequest]) {
            const req = build(cfg, MARZPAY_SPEC, raw);

            // The URL is exactly base + the verified path with the ENCODED segment.
            assert.equal(
              req.url,
              `${base}/transactions/${encoded}`,
              'path URL must interpolate encodeURIComponent(trimmed)',
            );
            assert.ok(
              req.url.includes(encoded),
              'path URL must contain encodeURIComponent(trimmed)',
            );

            // The interpolated segment (everything after `/transactions/`) must be
            // exactly the encoded value and must contain NO raw structural
            // delimiter, regardless of what the identifier contained.
            const prefix = `${base}/transactions/`;
            assert.ok(req.url.startsWith(prefix));
            const segment = req.url.slice(prefix.length);
            assert.equal(segment, encoded, 'interpolated segment must be the encoded value');
            for (const d of DELIMITERS) {
              assert.ok(
                !segment.includes(d),
                `interpolated path segment must not contain a raw "${d}"`,
              );
            }
            // A round-trip decode recovers the original trimmed identifier.
            assert.equal(decodeURIComponent(segment), trimmed);
          }

          // --- Query builder: listTransactions (reference filter) -------------
          const listReq = buildListTransactionsRequest(cfg, MARZPAY_SPEC, {
            reference: raw,
          });
          assert.equal(listReq.method, 'GET');

          // The query portion is everything after the first `?`.
          const qIndex = listReq.url.indexOf('?');
          assert.ok(qIndex !== -1, 'list URL must carry a query string for a reference filter');
          const queryPortion = listReq.url.slice(qIndex + 1);

          // The reference value is round-trippable via the URL parser, proving it
          // was encoded rather than injected as raw structure.
          const parsed = new URL(listReq.url);
          assert.equal(
            parsed.searchParams.get('reference'),
            trimmed,
            'parsed reference must equal the trimmed identifier',
          );

          // No raw structural delimiter from the identifier may appear unencoded
          // in the query string. URLSearchParams encodes `/`,`?`,`#`,`&` (and
          // space → `+`), so the only `&`/`?`/etc. present would be ones it
          // itself emitted — but with a single `reference` param there are none.
          for (const d of DELIMITERS) {
            if (trimmed.includes(d)) {
              assert.ok(
                !queryPortion.includes(d),
                `query string must not contain a raw "${d}" from the identifier`,
              );
            }
          }
        },
      ),
      { numRuns: RUNS },
    );
  });
});
