// Property-based + unit tests for MarzPay webhook signature verification.
// Pure/offline — no network. Run: npm test -w packages/plugin-marzpay
//
// Property 7 exercises the scheme-parameterized HMAC primitive
// `verifyWebhookSignature`. Because MarzPay publishes NO webhook signature
// scheme (Research_Artifact §L4), `MARZPAY_SPEC.webhook` is intentionally
// UNBOUND (undefined) and the live primitive returns `false` for an undefined
// scheme. To exercise the HMAC round-trip/tamper cases the TEST supplies an
// EXPLICIT scheme object and computes the expected signature with node:crypto.
// This is generic cryptography, NOT a claim about MarzPay behavior — the
// unbound-scheme assertion below documents verify-don't-invent.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fc from 'fast-check';

import { verifyWebhookSignature } from '../dist/index.js';

/** Compute the canonical signature for a given scheme using node:crypto. */
function sign(scheme, secret, rawBody) {
  return createHmac(scheme.algorithm, secret).update(rawBody, 'utf8').digest(scheme.encoding);
}

// Generators constrained to the input space of MarzPayWebhookScheme + HMAC.
const algorithm = fc.constantFrom('sha256', 'sha512');
const encoding = fc.constantFrom('hex', 'base64');
const scheme = fc.record({
  signatureHeader: fc.constant('x-marzpay-signature'),
  algorithm,
  encoding,
});
// Non-empty secret (HMAC key). The primitive treats only '' as missing.
const secret = fc.string({ minLength: 1, maxLength: 64 });
// Arbitrary raw payload bytes, including empty.
const rawBody = fc.string({ maxLength: 256 });

// ── Unit tests: concrete round-trip + tamper examples (Requirements 3.6, 3.7) ──
describe('verifyWebhookSignature (examples)', () => {
  const s256 = { signatureHeader: 'x-marzpay-signature', algorithm: 'sha256', encoding: 'hex' };
  const s512 = { signatureHeader: 'x-marzpay-signature', algorithm: 'sha512', encoding: 'base64' };
  const body = '{"event":"collection.completed","reference":"abc-123"}';
  const key = 'shhh-secret';

  it('accepts a correct sha256/hex signature (round-trip)', () => {
    assert.equal(verifyWebhookSignature(s256, key, body, sign(s256, key, body)), true);
  });
  it('accepts a correct sha512/base64 signature (round-trip)', () => {
    assert.equal(verifyWebhookSignature(s512, key, body, sign(s512, key, body)), true);
  });
  it('rejects a tampered body', () => {
    assert.equal(verifyWebhookSignature(s256, key, body + ' ', sign(s256, key, body)), false);
  });
  it('rejects a wrong key', () => {
    assert.equal(verifyWebhookSignature(s256, key + 'X', body, sign(s256, key, body)), false);
  });
  it('rejects absent/empty/malformed signature material', () => {
    assert.equal(verifyWebhookSignature(s256, key, body, undefined), false);
    assert.equal(verifyWebhookSignature(s256, key, body, ''), false);
    assert.equal(verifyWebhookSignature(s256, key, body, 'not-a-valid-signature'), false);
  });
  it('verify-don\'t-invent: an UNBOUND scheme returns false even for an otherwise-correct signature', () => {
    // MARZPAY_SPEC.webhook is undefined (§L4); compute a sig under an explicit
    // scheme, then verify with scheme=undefined → must be false.
    assert.equal(verifyWebhookSignature(undefined, key, body, sign(s256, key, body)), false);
  });
});

// ── Property 7 ────────────────────────────────────────────────────────────────
// Feature: marzpay-integration, Property 7: Webhook signing round-trip and tamper rejection
// Validates: Requirements 3.6, 3.7, 14.6
describe('Property 7: Webhook signing round-trip and tamper rejection', () => {
  it('round-trip is positive; tampered/wrong-key/absent/malformed and unbound-scheme are negative', () => {
    fc.assert(
      fc.property(scheme, secret, rawBody, (sch, key, body) => {
        const correct = sign(sch, key, body);

        // Round-trip (positive): the canonical signature verifies.
        assert.equal(verifyWebhookSignature(sch, key, body, correct), true);

        // Tampered body (negative): a different payload deterministically yields
        // a different HMAC, so the original signature must not verify.
        const tampered = body + 'TAMPER';
        assert.equal(verifyWebhookSignature(sch, key, tampered, correct), false);

        // Wrong key (negative): a different signing secret breaks verification.
        assert.equal(verifyWebhookSignature(sch, key + 'X', body, correct), false);

        // Absent/empty signature material (negative).
        assert.equal(verifyWebhookSignature(sch, key, body, undefined), false);
        assert.equal(verifyWebhookSignature(sch, key, body, ''), false);

        // Malformed signature (negative): wrong length / not the canonical form.
        assert.equal(verifyWebhookSignature(sch, key, body, correct + 'AA'), false);

        // verify-don't-invent (negative): with the scheme UNBOUND (the real
        // MARZPAY_SPEC.webhook state, §L4) even a correct signature is rejected.
        assert.equal(verifyWebhookSignature(undefined, key, body, correct), false);

        return true;
      }),
      { numRuns: 200 },
    );
  });
});
