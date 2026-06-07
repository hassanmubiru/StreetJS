// tests/mysql-dialect-seam.test.ts
// Offline regression test for the wire↔mariadb decoupling (Phase 8). Loading
// the MariaDB module must register a dialect-upgrade factory on MysqlConnection,
// with no circular import. No live database required.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MysqlConnection } from '../database/mysql/wire.js';
import { MariaDbConnection } from '../database/mysql/mariadb.js';

describe('MySQL dialect-factory seam (no circular dependency)', () => {
  it('importing mariadb registers a dialect factory on MysqlConnection', () => {
    const factory = (MysqlConnection as unknown as { _dialectFactory: unknown })['_dialectFactory'];
    assert.equal(typeof factory, 'function');
  });

  it('the registered factory upgrades a base connection to MariaDbConnection', () => {
    const factory = (MysqlConnection as unknown as {
      _dialectFactory: (base: MysqlConnection, version: string) => MysqlConnection;
    })['_dialectFactory'];
    const base = new MysqlConnection();
    const upgraded = factory(base, '10.11.2-MariaDB');
    assert.ok(upgraded instanceof MariaDbConnection);
    assert.ok(upgraded instanceof MysqlConnection); // subclass relationship intact
  });

  it('MariaDbConnection remains a MysqlConnection subclass', () => {
    assert.ok(Object.getPrototypeOf(MariaDbConnection.prototype) === MysqlConnection.prototype);
  });
});
