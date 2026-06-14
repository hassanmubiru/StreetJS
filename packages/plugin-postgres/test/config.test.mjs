// Unit tests for the Postgres plugin's config validation + option mapping.
// Pure/offline — no database required. Run: npm test -w packages/plugin-postgres

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validatePostgresConfig, toPoolOptions,
  postgresPluginManifest, POSTGRES_PLUGIN_NAME,
} from '../dist/index.js';

const base = { host: 'h', port: 5432, user: 'u', password: 'p', database: 'd' };

describe('validatePostgresConfig', () => {
  it('accepts a complete connection config', () => {
    const cfg = validatePostgresConfig(base);
    assert.equal(cfg.host, 'h');
    assert.equal(cfg.database, 'd');
  });

  it('allows an empty-string password (e.g. trust auth) but requires the key', () => {
    const cfg = validatePostgresConfig({ ...base, password: '' });
    assert.equal(cfg.password, '');
  });

  it('rejects a missing host', () => {
    assert.throws(() => validatePostgresConfig({ ...base, host: undefined }), /"host" is required/);
  });

  it('rejects a missing database', () => {
    assert.throws(() => validatePostgresConfig({ ...base, database: undefined }), /"database" is required/);
  });

  it('rejects an out-of-range port', () => {
    assert.throws(() => validatePostgresConfig({ ...base, port: 0 }), /"port"/);
  });

  it('rejects a negative pool size', () => {
    assert.throws(() => validatePostgresConfig({ ...base, maxConnections: -1 }), /maxConnections/);
  });

  it('accepts pool tuning options', () => {
    const cfg = validatePostgresConfig({ ...base, minConnections: 1, maxConnections: 10, idleTimeoutMs: 1000 });
    assert.equal(cfg.maxConnections, 10);
  });
});

describe('toPoolOptions', () => {
  it('maps connection fields and omits stateKey', () => {
    const opts = toPoolOptions(validatePostgresConfig({ ...base, stateKey: 'pg', maxConnections: 5 }));
    assert.equal(opts.host, 'h');
    assert.equal(opts.maxConnections, 5);
    assert.equal('stateKey' in opts, false);
  });
});

describe('manifest', () => {
  it('declares the expected name, capabilities, and permissions', () => {
    const m = postgresPluginManifest();
    assert.equal(m.name, POSTGRES_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['database', 'sql', 'postgres']);
    assert.deepEqual(m.permissions, ['net', 'middleware']);
  });
});
