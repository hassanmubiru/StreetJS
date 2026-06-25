// Property-based test for the MarzPay plugin's webhook signature trust path.
// Pure / offline — no network. Uses fast-check with Node's built-in test runner.
// Run: npm test -w packages/plugin-marzpay
//
// Covers one design.md Correctness Property:
//   • Property 7 — Webhook signature is fail-closed and, with a scheme, exact
//     (Req 6.4, 6.5)
//
// Feature: marzpay-scope-alignment, Property 7: Webhook signature is fail-closed
// and, with a scheme, exact
//
// Two complementary facets in a single property:
//   Part A (fail-closed): `MARZPAY_SPEC.webhook` is UNBOUND (§L4), so a real
//     `new MarzPayClient(config, MARZPAY_SPEC, spy).validateWebhook(rawBody,
//     signature)` returns `false` for ANY rawBody / signature material — there
//     is no fail-open path — and issues ZERO network sends (the injected
//     transport spy records no calls).
//   Part B (exact, with a scheme): for any EXPLICIT scheme + secret + rawBody,
//     `verifyWebhookSignature` returns `true` for the canonical HMAC signature
//     and `false` for any tampered signature, length mismatch, or absent/empty
//     material. The explicit scheme is generic cryptography exercised by the
//     TEST — it is NOT a claim about a documented MarzPay scheme.
//
// Validates: Requirements 6.4, 6.5

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fc from 'fast-check';

import { verifyWebhookSignature, MarzPayClient, MARZPAY_SPEC } from '../dist/index.js';

const RUNS = 200; // ≥100 iterations.

/** Compute the canonical signature for a scheme using node:crypto. */
function sign(scheme, secret, rawBody) {
  return createHmac(scheme.algorithm, secret).update(rawBody, 'utf8').digest(scheme.encoding);
}

/**
 * A transport spy that records every send. If `validateWebhook` ever reached
 * the network this counter would be non-zero — but it must stay 0, because a
 * fail-closed signature check is purely local (node:crypto only).
 */
function spyTransport() {
  const transport = (_req, _timeoutMs) => {
    transport.calls += 1;
    return Promise.resolve({ status: 200, body: '{}' });
  };
  transport.calls = 0;
  return transport;
}

// Generators constrained to the MarzPayWebhookScheme + HMAC input space.
const algorithm = fc.constantFrom('sha256', 'sha512');
const encoding = fc.constantFrom('hex', 'base64');
const scheme = fc.record({
  signatureHeader: fc.constant('x-marzpay-signature'),
  algorithm,
  encoding,
});
// Non-empty signing secret (HMAC key). The primitive treats only '' as missing.
const secret = fc.string({ minLength: 1, maxLength: 64 });
// Arbitrary raw payload bytes, including empty.
const rawBody = fc.string({ maxLength: 256 });
// Arbitrary signature material the attacker might present (incl. absent/empty).
const arbitrarySignature = fc.option(fc.string({ maxLength: 300 }), { nil: undefined });

describe('Property 7: Webhook signature is fail-closed and, with a scheme, exact', () => {
  it('unbound scheme is always false with zero sends; an explicit scheme verifies only the canonical HMAC', () => {
    fc.assert(
      fc.property(
        scheme,
        secret,
        rawBody,
        arbitrarySignature,
        (sch, key, body, anySig) => {
          // ── Part A: fail-closed via the real client (unbound MARZPAY_SPEC.webhook) ──
          // For ANY rawBody/signature, validateWebhook must return false and
          // perform no network I/O. We assert this for several signature shapes:
          //   - arbitrary attacker-supplied material
          //   - a "correct-looking" HMAC computed under an explicit scheme
          //   - absent (undefined) and empty material
          const spy = spyTransport();
          const config = { apiKey: 'ak', secretKey: key, environment: 'sandbox' };
          const client = new MarzPayClient(config, MARZPAY_SPEC, spy);
          const canonicalUnderExplicitScheme = sign(sch, key, body);

          for (const sig of [anySig, canonicalUnderExplicitScheme, undefined, '', '   ']) {
            assert.equal(
              client.validateWebhook(body, sig),
              false,
              'unbound webhook scheme must never fail open',
            );
          }
          assert.equal(spy.calls, 0, 'fail-closed validation must not touch the network');

          // ── Part B: exact verification with an EXPLICIT scheme ──────────────
          const correct = sign(sch, key, body);

          // Canonical signature (positive): the only accepted value.
          assert.equal(
            verifyWebhookSignature(sch, key, body, correct),
            true,
            'canonical HMAC must verify under an explicit scheme',
          );

          // Tampered body (negative): a different payload yields a different HMAC.
          assert.equal(
            verifyWebhookSignature(sch, key, body + 'TAMPER', correct),
            false,
            'a signature for a different body must not verify',
          );

          // Wrong key (negative): a different signing secret breaks verification.
          assert.equal(
            verifyWebhookSignature(sch, key + 'X', body, correct),
            false,
            'a signature under a different key must not verify',
          );

          // Length mismatch (negative): appending/truncating changes the length.
          assert.equal(
            verifyWebhookSignature(sch, key, body, correct + 'AA'),
            false,
            'a length-mismatched signature must not verify',
          );
          assert.equal(
            verifyWebhookSignature(sch, key, body, correct.slice(0, -1)),
            false,
            'a truncated signature must not verify',
          );

          // Absent/empty signature material (negative).
          assert.equal(verifyWebhookSignature(sch, key, body, undefined), false);
          assert.equal(verifyWebhookSignature(sch, key, body, ''), false);
          assert.equal(verifyWebhookSignature(sch, key, body, '   '), false);

          // Even with an explicit scheme, an absent/empty secret authenticates
          // nothing (negative) — the secret material is required.
          assert.equal(verifyWebhookSignature(sch, '', body, correct), false);

          return true;
        },
      ),
      { numRuns: RUNS },
    );
  });
});
