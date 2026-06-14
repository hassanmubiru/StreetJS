// Unit tests for the MySQL plugin's config validation + option mapping.
// Pure/offline — no database required. Run: npm test -w packages/plugin-mysql

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateMysqlConfig, toPoolOptions,
  mysqlPluginManifest, MYSQL_PLUGIN_NAME,
} from '../dist/index.js';

const base = { host: 'h', user: 'u', password: 'p', database: 'd' };

describe('validateMysqlConfig', () => {
  it('accepts a config without an explicit port (defaults applied downstream)', () => {
    const cfg = validateMysqlConfig(base);
    assert.equal(cfg.host, 'h');
    assert.equal(cfg.port, undefined);
  });

  it('accepts an explicit port', () => {
    const cfg = validateMysqlConfig({ ...base, port: 3307 });
    assert.equal(cfg.port, 3307);
  });

  it('rejects a missing host', () => {
    assert.throws(() => validateMysqlConfig({ ...base, host: undefined }), /"host" is required/);
  });

  it('rejects a missing database', () => {
    assert.throws(() => validateMysqlConfig({ ...base, database: undefined }), /"database" is required/);
  });

  it('rejects an out-of-range port', () => {
    assert.throws(() => validateMysqlConfig({ ...base, port: 70000 }), /"port"/);
  });

  it('rejects a negative pool size', () => {
    assert.throws(() => validateMysqlConfig({ ...base, maxConnections: -2 }), /maxConnections/);
  });
});

describe('toPoolOptions', () => {
  it('maps connection fields and omits stateKey', () => {
    const opts = toPoolOptions(validateMysqlConfig({ ...base, port: 3306, stateKey: 'mysql' }));
    assert.equal(opts.host, 'h');
    assert.equal(opts.port, 3306);
    assert.equal('stateKey' in opts, false);
  });

  it('omits port when not provided', () => {
    const opts = toPoolOptions(validateMysqlConfig(base));
    assert.equal('port' in opts, false);
  });
});

describe('manifest', () => {
  it('declares the expected name, capabilities, and permissions', () => {
    const m = mysqlPluginManifest();
    assert.equal(m.name, MYSQL_PLUGIN_NAME);
    assert.deepEqual(m.capabilities, ['database', 'sql', 'mysql']);
    assert.deepEqual(m.permissions, ['net', 'middleware']);
  });
});
