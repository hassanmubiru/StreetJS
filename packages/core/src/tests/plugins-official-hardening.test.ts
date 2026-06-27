// tests/plugins-official-hardening.test.ts
// Covers the plugin-hardening additions (Outstanding Actions #8/#9):
//   • outbound-request `timeoutMs` config validation on the 4 node:https plugins
//   • verifyStripeWebhook  (Stripe-Signature, HMAC-SHA256 over `t.payload`)
//   • verifyTwilioSignature (X-Twilio-Signature, HMAC-SHA1 over URL+sorted params)
// Pure/offline — no network.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import {
  validateStripeConfig, verifyStripeWebhook, STRIPE_DEFAULT_TIMEOUT_MS,
} from '../platform/plugins/official/stripe.js';
import {
  validateTwilioConfig, verifyTwilioSignature, TWILIO_DEFAULT_TIMEOUT_MS,
} from '../platform/plugins/official/twilio.js';
import { validateSendGridConfig, verifySendGridWebhook } from '../platform/plugins/official/sendgrid.js';
import { validateAuth0Config } from '../platform/plugins/official/auth0.js';

describe('plugin outbound timeout config', () => {
  it('defaults are 30s constants', () => {
    assert.equal(STRIPE_DEFAULT_TIMEOUT_MS, 30_000);
    assert.equal(TWILIO_DEFAULT_TIMEOUT_MS, 30_000);
  });

  it('accepts a positive-integer timeoutMs (all 4 plugins)', () => {
    assert.equal(validateStripeConfig({ apiKey: 'sk', timeoutMs: 5000 }).timeoutMs, 5000);
    assert.equal(validateTwilioConfig({ accountSid: 'AC', authToken: 't', timeoutMs: 5000 }).timeoutMs, 5000);
    assert.equal(validateSendGridConfig({ apiKey: 'k', timeoutMs: 5000 }).timeoutMs, 5000);
    assert.equal(validateAuth0Config({ domain: 'd.auth0.com', clientId: 'c', clientSecret: 's', timeoutMs: 5000 }).timeoutMs, 5000);
  });

  it('omitting timeoutMs leaves it undefined (backward compatible)', () => {
    assert.equal(validateStripeConfig({ apiKey: 'sk' }).timeoutMs, undefined);
    assert.equal(validateTwilioConfig({ accountSid: 'AC', authToken: 't' }).timeoutMs, undefined);
  });

  it('rejects non-positive / non-integer timeoutMs', () => {
    assert.throws(() => validateStripeConfig({ apiKey: 'sk', timeoutMs: 0 }), /timeoutMs.*positive integer/);
    assert.throws(() => validateStripeConfig({ apiKey: 'sk', timeoutMs: -1 }), /timeoutMs.*positive integer/);
    assert.throws(() => validateStripeConfig({ apiKey: 'sk', timeoutMs: 1.5 }), /timeoutMs.*positive integer/);
    assert.throws(() => validateTwilioConfig({ accountSid: 'AC', authToken: 't', timeoutMs: -5 }), /timeoutMs.*positive integer/);
    assert.throws(() => validateSendGridConfig({ apiKey: 'k', timeoutMs: 0 }), /timeoutMs.*positive integer/);
    assert.throws(() => validateAuth0Config({ domain: 'd', clientId: 'c', clientSecret: 's', timeoutMs: 0 }), /timeoutMs.*positive integer/);
  });
});

describe('verifyStripeWebhook', () => {
  const secret = 'whsec_test_secret';
  const payload = '{"id":"evt_1","type":"payment_intent.succeeded"}';

  function header(ts: number, body: string, withSecret = secret): string {
    const sig = createHmac('sha256', withSecret).update(`${ts}.${body}`, 'utf8').digest('hex');
    return `t=${ts},v1=${sig}`;
  }

  it('accepts a valid, in-tolerance signature', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(verifyStripeWebhook(payload, header(now, payload), secret), true);
  });

  it('accepts a Buffer payload', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(verifyStripeWebhook(Buffer.from(payload), header(now, payload), secret), true);
  });

  it('rejects a tampered payload', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(verifyStripeWebhook(payload + 'x', header(now, payload), secret), false);
  });

  it('rejects a wrong secret', () => {
    const now = Math.floor(Date.now() / 1000);
    assert.equal(verifyStripeWebhook(payload, header(now, payload, 'whsec_wrong'), secret), false);
  });

  it('rejects a timestamp outside tolerance (replay)', () => {
    const old = Math.floor(Date.now() / 1000) - 10_000;
    assert.equal(verifyStripeWebhook(payload, header(old, payload), secret, 300), false);
  });

  it('honors a v1 among multiple signatures and rejects malformed/empty headers', () => {
    const now = Math.floor(Date.now() / 1000);
    const valid = createHmac('sha256', secret).update(`${now}.${payload}`, 'utf8').digest('hex');
    assert.equal(verifyStripeWebhook(payload, `t=${now},v1=deadbeef,v1=${valid}`, secret), true);
    assert.equal(verifyStripeWebhook(payload, '', secret), false);
    assert.equal(verifyStripeWebhook(payload, `t=${now}`, secret), false);
    assert.equal(verifyStripeWebhook(payload, header(now, payload), ''), false);
  });
});

describe('verifyTwilioSignature', () => {
  const authToken = 'twilio_auth_token';
  const url = 'https://example.com/webhooks/sms';
  const params = { To: '+15551234567', From: '+15557654321', Body: 'Hello' };

  function sign(token: string, u: string, p: Record<string, string>): string {
    let data = u;
    for (const k of Object.keys(p).sort()) data += k + p[k];
    return createHmac('sha1', token).update(Buffer.from(data, 'utf8')).digest('base64');
  }

  it('accepts a valid signature', () => {
    assert.equal(verifyTwilioSignature(authToken, url, params, sign(authToken, url, params)), true);
  });

  it('is independent of param insertion order', () => {
    const reordered = { Body: 'Hello', From: '+15557654321', To: '+15551234567' };
    assert.equal(verifyTwilioSignature(authToken, url, reordered, sign(authToken, url, params)), true);
  });

  it('rejects a wrong token, tampered url/params, and empty signature', () => {
    const good = sign(authToken, url, params);
    assert.equal(verifyTwilioSignature('wrong', url, params, good), false);
    assert.equal(verifyTwilioSignature(authToken, url + '/x', params, good), false);
    assert.equal(verifyTwilioSignature(authToken, url, { ...params, Body: 'Bye' }, good), false);
    assert.equal(verifyTwilioSignature(authToken, url, params, ''), false);
  });
});

describe('verifySendGridWebhook', () => {
  // SendGrid Event Webhook uses ECDSA P-256 over `${timestamp}${payload}`.
  const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const pubB64 = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const ts = '1600000000';
  const payload = '[{"event":"delivered"}]';

  function sigFor(body: string, timestamp: string): string {
    return cryptoSign('sha256', Buffer.concat([Buffer.from(timestamp), Buffer.from(body)]), privateKey).toString('base64');
  }

  it('accepts a valid signature (PEM key)', () => {
    assert.equal(verifySendGridWebhook(pubPem, payload, sigFor(payload, ts), ts), true);
  });
  it('accepts a valid signature (base64 DER key, as the dashboard provides)', () => {
    assert.equal(verifySendGridWebhook(pubB64, payload, sigFor(payload, ts), ts), true);
  });
  it('rejects a tampered payload / timestamp / empty inputs', () => {
    const sig = sigFor(payload, ts);
    assert.equal(verifySendGridWebhook(pubPem, payload + 'x', sig, ts), false);
    assert.equal(verifySendGridWebhook(pubPem, payload, sig, '1600000001'), false);
    assert.equal(verifySendGridWebhook(pubPem, payload, '', ts), false);
    assert.equal(verifySendGridWebhook('', payload, sig, ts), false);
  });
});
