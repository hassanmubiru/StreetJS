// TLS (STARTTLS) config-surface validation (Outstanding Action #15). Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateNatsConfig } from '../dist/index.js';

const base = { host: 'nats.example.com', port: 4222 };

describe('NATS TLS config (STARTTLS upgrade)', () => {
  it('defaults to plain TCP (tls undefined) — backward compatible', () => {
    assert.equal(validateNatsConfig(base).tls, undefined);
  });
  it('accepts the TLS surface', () => {
    const c = validateNatsConfig({ ...base, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'nats.internal', tlsCa: '-----BEGIN CERTIFICATE-----' });
    assert.equal(c.tls, true);
    assert.equal(c.tlsRejectUnauthorized, false);
    assert.equal(c.tlsServerName, 'nats.internal');
    assert.ok(c.tlsCa.startsWith('-----BEGIN'));
  });
  it('rejects wrong types', () => {
    assert.throws(() => validateNatsConfig({ ...base, tls: 'yes' }), /"tls" must be a boolean/);
    assert.throws(() => validateNatsConfig({ ...base, tlsRejectUnauthorized: 1 }), /"tlsRejectUnauthorized" must be a boolean/);
    assert.throws(() => validateNatsConfig({ ...base, tlsServerName: 5 }), /"tlsServerName" must be a string/);
    assert.throws(() => validateNatsConfig({ ...base, tlsCa: {} }), /"tlsCa" must be a string/);
  });
});
