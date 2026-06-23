// packages/plugin-marzpay/test/webhook-roundtrip.example.test.mjs
// Explicit, concrete (non-property) webhook round-trip + tamper EXAMPLE test.
//
// Requirement 14.6 requires the suite to demonstrate, with a worked example,
// that round-trip signing+validation of a payload returns a POSITIVE result and
// that a payload modified after signing (a tampered payload) returns a NEGATIVE
// result. This file is the dedicated, named example sibling to the Property 7
// generative test in webhook.pbt.test.mjs.
//
// It exercises the plugin's `verifyWebhookSignature` with an EXPLICIT scheme
// (MarzPay publishes no signature scheme — Research_Artifact §L4 — so a scheme
// is supplied by the test, as Property 7 does) and signs the payload with
// node:crypto so the canonical signature is reproduced exactly.
//
// Validates: Requirements 14.6, 3.6, 3.7

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { verifyWebhookSignature } from '../dist/index.js';

/** Sign a raw payload under an explicit scheme (canonical HMAC). */
function sign(scheme, secret, rawBody) {
  return createHmac(scheme.algorithm, secret).update(rawBody, 'utf8').digest(scheme.encoding);
}

describe('Webhook round-trip + tamper (explicit example) — Validates: Requirement 14.6', () => {
  // A concrete, fixed scheme / secret / payload — not generated.
  const scheme = { signatureHeader: 'x-marzpay-signature', algorithm: 'sha256', encoding: 'hex' };
  const secret = 'whsec_marzpay_example_key';
  const signedPayload = JSON.stringify({
    event_type: 'collection.completed',
    transaction: { reference: 'TXN-2024-0001', status: 'completed', amount: { raw: 50000, currency: 'UGX' } },
  });

  it('round-trip: a payload signed and then validated returns a POSITIVE result', () => {
    const signature = sign(scheme, secret, signedPayload);
    const valid = verifyWebhookSignature(scheme, secret, signedPayload, signature);
    assert.equal(valid, true, 'the canonical signature of the untouched payload must validate');
  });

  it('tamper: a payload modified after signing returns a NEGATIVE result', () => {
    // Sign the ORIGINAL payload, then deliver a payload mutated after signing.
    const signature = sign(scheme, secret, signedPayload);
    const tamperedPayload = signedPayload.replace('"amount":{"raw":50000', '"amount":{"raw":5000000');
    assert.notEqual(tamperedPayload, signedPayload, 'the tampered payload must differ from the signed one');

    const valid = verifyWebhookSignature(scheme, secret, tamperedPayload, signature);
    assert.equal(valid, false, 'a payload tampered after signing must NOT validate');
  });
});
