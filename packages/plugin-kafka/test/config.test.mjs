// Unit tests for the Kafka plugin's config validation + option mapping.
// Pure/offline — no broker required. Run: npm test -w packages/plugin-kafka

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateKafkaConfig, isValidBroker, toClientOptions,
  kafkaPluginManifest, KAFKA_PLUGIN_NAME,
} from '../dist/index.js';

describe('isValidBroker', () => {
  it('accepts host:port and rejects malformed entries', () => {
    assert.equal(isValidBroker('127.0.0.1:9092'), true);
    assert.equal(isValidBroker('broker.internal:9093'), true);
    assert.equal(isValidBroker('nohost'), false);
    assert.equal(isValidBroker('host:'), false);
    assert.equal(isValidBroker(':9092'), false);
    assert.equal(isValidBroker('host:70000'), false);
  });
});

describe('validateKafkaConfig', () => {
  it('accepts a brokers array', () => {
    const cfg = validateKafkaConfig({ brokers: ['127.0.0.1:9092', 'b2:9093'] });
    assert.deepEqual(cfg.brokers, ['127.0.0.1:9092', 'b2:9093']);
  });

  it('accepts host+port instead of brokers', () => {
    const cfg = validateKafkaConfig({ host: 'localhost', port: 9092 });
    assert.equal(cfg.host, 'localhost');
    assert.equal(cfg.port, 9092);
  });

  it('requires brokers or host', () => {
    assert.throws(() => validateKafkaConfig({ clientId: 'x' }), /provide "brokers".*or "host"/);
  });

  it('rejects an empty brokers array', () => {
    assert.throws(() => validateKafkaConfig({ brokers: [] }), /non-empty array/);
  });

  it('rejects a malformed broker entry', () => {
    assert.throws(() => validateKafkaConfig({ brokers: ['nope'] }), /invalid broker/);
  });

  it('rejects an out-of-range port', () => {
    assert.throws(() => validateKafkaConfig({ host: 'h', port: 0 }), /"port"/);
  });
});

describe('toClientOptions', () => {
  it('maps only the provided fields', () => {
    const opts = toClientOptions(validateKafkaConfig({ brokers: ['h:9092'], clientId: 'c' }));
    assert.deepEqual(opts, { brokers: ['h:9092'], clientId: 'c' });
  });

  it('omits stateKey (not a client option)', () => {
    const opts = toClientOptions(validateKafkaConfig({ host: 'h', port: 9092, stateKey: 'k' }));
    assert.equal('stateKey' in opts, false);
    assert.equal(opts.host, 'h');
  });
});

describe('manifest', () => {
  it('declares the expected name, capabilities, and permissions', () => {
    const m = kafkaPluginManifest();
    assert.equal(m.name, KAFKA_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['messaging', 'streaming', 'kafka']);
    assert.deepEqual(m.permissions, ['net', 'middleware']);
  });
});
