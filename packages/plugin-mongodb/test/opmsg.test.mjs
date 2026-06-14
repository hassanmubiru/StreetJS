// Unit tests for OP_MSG framing + config validation. Pure/offline.
// Run: npm test -w packages/plugin-mongodb

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { encodeOpMsg, parseOpMsg, OP_MSG } from '../dist/opmsg.js';
import { validateMongoConfig, mongoPluginManifest, MONGODB_PLUGIN_NAME } from '../dist/index.js';

describe('OP_MSG framing', () => {
  it('round-trips a command document', () => {
    const wire = encodeOpMsg(7, { find: 'users', filter: { active: true }, $db: 'app' });
    const reply = parseOpMsg(wire);
    assert.equal(reply.opCode, OP_MSG);
    assert.equal(reply.requestId, 7);
    assert.equal(reply.flagBits, 0);
    assert.equal(reply.document.find, 'users');
    assert.equal(reply.document.$db, 'app');
    assert.equal(reply.document.filter.active, true);
  });

  it('writes a messageLength equal to the buffer length', () => {
    const wire = encodeOpMsg(1, { ping: 1, $db: 'admin' });
    assert.equal(wire.readInt32LE(0), wire.length);
  });

  it('returns null when the message is incomplete', () => {
    const wire = encodeOpMsg(1, { ping: 1, $db: 'admin' });
    assert.equal(parseOpMsg(wire.subarray(0, 10)), null);
    assert.equal(parseOpMsg(wire.subarray(0, wire.length - 1)), null);
  });

  it('throws on a non-OP_MSG opcode', () => {
    const wire = encodeOpMsg(1, { ping: 1, $db: 'admin' });
    wire.writeInt32LE(1, 12); // corrupt opcode
    assert.throws(() => parseOpMsg(wire), /expected OP_MSG/);
  });
});

describe('validateMongoConfig', () => {
  it('accepts a minimal config', () => {
    const cfg = validateMongoConfig({ host: 'localhost', database: 'app' });
    assert.equal(cfg.host, 'localhost');
    assert.equal(cfg.database, 'app');
  });
  it('rejects a missing database', () => {
    assert.throws(() => validateMongoConfig({ host: 'h' }), /"database" is required/);
  });
  it('requires user and password together', () => {
    assert.throws(() => validateMongoConfig({ host: 'h', database: 'd', user: 'u' }), /provided together/);
  });
  it('rejects an out-of-range port', () => {
    assert.throws(() => validateMongoConfig({ host: 'h', database: 'd', port: 0 }), /"port"/);
  });
});

describe('manifest', () => {
  it('declares name, capabilities, permissions', () => {
    const m = mongoPluginManifest();
    assert.equal(m.name, MONGODB_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['database', 'document-store', 'mongodb']);
    assert.deepEqual(m.permissions, ['net', 'secrets', 'middleware']);
  });
});
