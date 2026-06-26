// Outbound-timeout config validation (Outstanding Action #8). Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validatePayPalConfig, PAYPAL_DEFAULT_TIMEOUT_MS } from '../dist/index.js';

const cfg = { clientId: 'cid', clientSecret: 'secret' };

describe('PayPal timeoutMs', () => {
  it('default constant is 30s', () => assert.equal(PAYPAL_DEFAULT_TIMEOUT_MS, 30_000));
  it('accepts a positive integer', () => assert.equal(validatePayPalConfig({ ...cfg, timeoutMs: 5000 }).timeoutMs, 5000));
  it('is undefined when omitted (backward compatible)', () => assert.equal(validatePayPalConfig(cfg).timeoutMs, undefined));
  it('rejects non-positive / non-integer', () => {
    assert.throws(() => validatePayPalConfig({ ...cfg, timeoutMs: 0 }), /timeoutMs.*positive integer/);
    assert.throws(() => validatePayPalConfig({ ...cfg, timeoutMs: -1 }), /timeoutMs.*positive integer/);
    assert.throws(() => validatePayPalConfig({ ...cfg, timeoutMs: 1.5 }), /timeoutMs.*positive integer/);
  });
});
