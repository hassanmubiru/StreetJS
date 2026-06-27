// TLS config-surface validation (Outstanding Action #15). Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRedisConfig } from '../dist/index.js';

const base = { host: 'cache.example.com', port: 6380 };

describe('Redis TLS config', () => {
  it('defaults to plain TCP (tls undefined) — backward compatible', () => {
    assert.equal(validateRedisConfig(base).tls, undefined);
  });
  it('accepts the TLS surface (rediss)', () => {
    const c = validateRedisConfig({ ...base, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'cache.internal', tlsCa: '-----BEGIN CERTIFICATE-----' });
    assert.equal(c.tls, true);
    assert.equal(c.tlsRejectUnauthorized, false);
    assert.equal(c.tlsServerName, 'cache.internal');
    assert.ok(c.tlsCa.startsWith('-----BEGIN'));
  });
  it('rejects wrong types', () => {
    assert.throws(() => validateRedisConfig({ ...base, tls: 'yes' }), /"tls" must be a boolean/);
    assert.throws(() => validateRedisConfig({ ...base, tlsRejectUnauthorized: 1 }), /"tlsRejectUnauthorized" must be a boolean/);
    assert.throws(() => validateRedisConfig({ ...base, tlsServerName: 5 }), /"tlsServerName" must be a string/);
    assert.throws(() => validateRedisConfig({ ...base, tlsCa: {} }), /"tlsCa" must be a string/);
  });
});
