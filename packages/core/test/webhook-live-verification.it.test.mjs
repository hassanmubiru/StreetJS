// Integration harness: verify REAL captured provider webhooks against the
// shipped, exported verifiers. This complements the unit tests
// (src/tests/plugins-official-hardening.test.ts), which use locally-generated
// signatures, by allowing an operator to feed an ACTUAL payload + header +
// signing secret captured from the provider dashboard / a real delivery.
//
// It is SKIP-BY-DEFAULT: each case skips unless its environment variables are
// present, so CI without secrets is unaffected (no failures, no secrets in the
// repo). Supply real captures via env to exercise the live path:
//
//   Stripe:
//     STREET_IT_STRIPE_PAYLOAD   (raw request body, exactly as received)
//     STREET_IT_STRIPE_SIG       (Stripe-Signature header value)
//     STREET_IT_STRIPE_SECRET    (whsec_… endpoint secret)
//
//   Twilio:
//     STREET_IT_TWILIO_URL       (full request URL)
//     STREET_IT_TWILIO_PARAMS    (JSON object of POST params)
//     STREET_IT_TWILIO_SIG       (X-Twilio-Signature header value)
//     STREET_IT_TWILIO_TOKEN     (Twilio auth token)
//
//   SendGrid (Event Webhook, ECDSA):
//     STREET_IT_SENDGRID_PAYLOAD   (raw body)
//     STREET_IT_SENDGRID_SIG       (X-Twilio-Email-Event-Webhook-Signature)
//     STREET_IT_SENDGRID_TS        (X-Twilio-Email-Event-Webhook-Timestamp)
//     STREET_IT_SENDGRID_PUBKEY    (verification key: PEM or base64 DER)
//
// Run:  npm run build -w packages/core && node --test packages/core/test/webhook-live-verification.it.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { verifyStripeWebhook, verifyTwilioSignature, verifySendGridWebhook } from '../dist/index.js';

const env = process.env;
const have = (...keys) => keys.every((k) => typeof env[k] === 'string' && env[k].length > 0);

test('Stripe: a real captured webhook re-verifies against the endpoint secret', {
  skip: !have('STREET_IT_STRIPE_PAYLOAD', 'STREET_IT_STRIPE_SIG', 'STREET_IT_STRIPE_SECRET')
    && 'set STREET_IT_STRIPE_PAYLOAD/SIG/SECRET to run',
}, () => {
  const ok = verifyStripeWebhook(
    env.STREET_IT_STRIPE_PAYLOAD,
    env.STREET_IT_STRIPE_SIG,
    env.STREET_IT_STRIPE_SECRET,
  );
  assert.equal(ok, true, 'real Stripe signature should verify; check the body was not re-serialized');
});

test('Twilio: a real captured request re-verifies against the auth token', {
  skip: !have('STREET_IT_TWILIO_URL', 'STREET_IT_TWILIO_PARAMS', 'STREET_IT_TWILIO_SIG', 'STREET_IT_TWILIO_TOKEN')
    && 'set STREET_IT_TWILIO_URL/PARAMS/SIG/TOKEN to run',
}, () => {
  const params = JSON.parse(env.STREET_IT_TWILIO_PARAMS);
  const ok = verifyTwilioSignature(env.STREET_IT_TWILIO_TOKEN, env.STREET_IT_TWILIO_URL, params, env.STREET_IT_TWILIO_SIG);
  assert.equal(ok, true, 'real Twilio signature should verify; check URL + params match the request exactly');
});

test('SendGrid: a real captured event webhook re-verifies (ECDSA P-256)', {
  skip: !have('STREET_IT_SENDGRID_PAYLOAD', 'STREET_IT_SENDGRID_SIG', 'STREET_IT_SENDGRID_TS', 'STREET_IT_SENDGRID_PUBKEY')
    && 'set STREET_IT_SENDGRID_PAYLOAD/SIG/TS/PUBKEY to run',
}, () => {
  const ok = verifySendGridWebhook(
    env.STREET_IT_SENDGRID_PUBKEY,
    env.STREET_IT_SENDGRID_PAYLOAD,
    env.STREET_IT_SENDGRID_SIG,
    env.STREET_IT_SENDGRID_TS,
  );
  assert.equal(ok, true, 'real SendGrid event-webhook signature should verify');
});
