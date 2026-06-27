// TLS config-surface validation (Outstanding Action #15). Pure/offline.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateRabbitMqConfig, toRabbitMqOptions } from '../dist/index.js';

const base = { host: 'mq.example.com', port: 5671 };

describe('RabbitMQ TLS config (AMQPS)', () => {
  it('defaults to plain TCP (tls undefined) — backward compatible', () => {
    assert.equal(validateRabbitMqConfig(base).tls, undefined);
  });
  it('accepts the TLS surface and threads it into core options', () => {
    const cfg = validateRabbitMqConfig({ ...base, tls: true, tlsRejectUnauthorized: false, tlsServerName: 'mq.internal', tlsCa: '-----BEGIN CERTIFICATE-----' });
    assert.equal(cfg.tls, true);
    const opts = toRabbitMqOptions(cfg);
    assert.equal(opts.tls, true);
    assert.equal(opts.tlsRejectUnauthorized, false);
    assert.equal(opts.tlsServerName, 'mq.internal');
    assert.ok(opts.tlsCa.startsWith('-----BEGIN'));
  });
  it('rejects wrong types', () => {
    assert.throws(() => validateRabbitMqConfig({ ...base, tls: 'yes' }), /"tls" must be a boolean/);
    assert.throws(() => validateRabbitMqConfig({ ...base, tlsRejectUnauthorized: 1 }), /"tlsRejectUnauthorized" must be a boolean/);
    assert.throws(() => validateRabbitMqConfig({ ...base, tlsServerName: 5 }), /"tlsServerName" must be a string/);
    assert.throws(() => validateRabbitMqConfig({ ...base, tlsCa: {} }), /"tlsCa" must be a string/);
  });
});
