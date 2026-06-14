// Unit tests for the PayPal plugin's request builders + config validation.
// Pure/offline — no network. Run: npm test -w packages/plugin-paypal

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePayPalConfig, buildTokenRequest, buildCreateOrderRequest, baseUrl,
  payPalPluginManifest, PAYPAL_PLUGIN_NAME,
} from '../dist/index.js';

const cfg = { clientId: 'cid', clientSecret: 'secret' };

describe('validatePayPalConfig', () => {
  it('accepts minimal credentials', () => {
    assert.equal(validatePayPalConfig(cfg).clientId, 'cid');
  });
  it('rejects a missing clientSecret', () => {
    assert.throws(() => validatePayPalConfig({ clientId: 'x' }), /"clientSecret" is required/);
  });
  it('rejects an invalid environment', () => {
    assert.throws(() => validatePayPalConfig({ ...cfg, environment: 'prod' }), /"environment"/);
  });
});

describe('baseUrl', () => {
  it('selects sandbox vs live hosts', () => {
    assert.match(baseUrl('sandbox'), /sandbox\.paypal\.com$/);
    assert.match(baseUrl('live'), /api-m\.paypal\.com$/);
  });
});

describe('buildTokenRequest', () => {
  it('uses Basic auth with base64(clientId:secret) and a form body', () => {
    const req = buildTokenRequest(cfg);
    assert.equal(req.method, 'POST');
    assert.match(req.url, /\/v1\/oauth2\/token$/);
    assert.equal(req.headers.authorization, 'Basic ' + Buffer.from('cid:secret').toString('base64'));
    assert.equal(req.body, 'grant_type=client_credentials');
  });
});

describe('buildCreateOrderRequest', () => {
  it('builds a CAPTURE order with bearer auth and JSON purchase units', () => {
    const req = buildCreateOrderRequest('tok', { amount: '20.00', currency: 'USD' });
    assert.match(req.url, /\/v2\/checkout\/orders$/);
    assert.equal(req.headers.authorization, 'Bearer tok');
    const body = JSON.parse(req.body);
    assert.equal(body.intent, 'CAPTURE');
    assert.equal(body.purchase_units[0].amount.value, '20.00');
    assert.equal(body.purchase_units[0].amount.currency_code, 'USD');
  });
  it('rejects a malformed amount', () => {
    assert.throws(() => buildCreateOrderRequest('t', { amount: '20.000', currency: 'USD' }), /invalid amount/);
  });
  it('rejects a malformed currency', () => {
    assert.throws(() => buildCreateOrderRequest('t', { amount: '1.00', currency: 'usd' }), /invalid currency/);
  });
});

describe('manifest', () => {
  it('declares name, capabilities, permissions', () => {
    const m = payPalPluginManifest();
    assert.equal(m.name, PAYPAL_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['payments', 'paypal']);
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
  });
});
