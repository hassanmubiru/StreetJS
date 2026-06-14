// Unit tests for the RabbitMQ plugin's config validation + option mapping.
// Pure/offline — no broker required. Run: npm test -w packages/plugin-rabbitmq

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateRabbitMqConfig, toRabbitMqOptions,
  rabbitMqPluginManifest, RABBITMQ_PLUGIN_NAME,
} from '../dist/index.js';

describe('validateRabbitMqConfig', () => {
  it('accepts a minimal valid config', () => {
    const cfg = validateRabbitMqConfig({ host: 'localhost', port: 5672 });
    assert.equal(cfg.host, 'localhost');
    assert.equal(cfg.port, 5672);
  });

  it('rejects a missing/empty host', () => {
    assert.throws(() => validateRabbitMqConfig({ port: 5672 }), /"host" is required/);
  });

  it('rejects an out-of-range port', () => {
    assert.throws(() => validateRabbitMqConfig({ host: 'h', port: 99999 }), /"port"/);
  });

  it('requires username and password together', () => {
    assert.throws(() => validateRabbitMqConfig({ host: 'h', port: 5672, username: 'guest' }), /provided together/);
  });

  it('accepts username+password when both present', () => {
    const cfg = validateRabbitMqConfig({ host: 'h', port: 5672, username: 'guest', password: 'guest' });
    assert.equal(cfg.username, 'guest');
    assert.equal(cfg.password, 'guest');
  });

  it('rejects a non-positive prefetch', () => {
    assert.throws(() => validateRabbitMqConfig({ host: 'h', port: 5672, prefetch: 0 }), /"prefetch"/);
  });

  it('accepts exchange, vhost, and prefetch', () => {
    const cfg = validateRabbitMqConfig({ host: 'h', port: 5672, exchange: 'evx', vhost: '/app', prefetch: 10 });
    assert.equal(cfg.exchange, 'evx');
    assert.equal(cfg.vhost, '/app');
    assert.equal(cfg.prefetch, 10);
  });
});

describe('toRabbitMqOptions', () => {
  it('maps host/port and only the provided optionals', () => {
    const opts = toRabbitMqOptions(validateRabbitMqConfig({ host: 'h', port: 5672, exchange: 'evx' }));
    assert.equal(opts.host, 'h');
    assert.equal(opts.port, 5672);
    assert.equal(opts.exchange, 'evx');
    assert.equal('username' in opts, false);
  });

  it('omits stateKey (not a transport option)', () => {
    const opts = toRabbitMqOptions(validateRabbitMqConfig({ host: 'h', port: 5672, stateKey: 'mq' }));
    assert.equal('stateKey' in opts, false);
  });
});

describe('manifest', () => {
  it('declares the expected name, capabilities, and permissions', () => {
    const m = rabbitMqPluginManifest();
    assert.equal(m.name, RABBITMQ_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['messaging', 'queue', 'rabbitmq']);
    assert.deepEqual(m.permissions, ['net', 'middleware']);
  });
});
