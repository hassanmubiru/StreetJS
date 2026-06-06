// tests/mysql-certification.e2e.test.ts
// End-to-end MySQL certification against a REAL MySQL instance. The whole suite
// is reported as skipped (node:test `skip`) when MYSQL_HOST is unset, so it is
// safe everywhere; CI runs it against a mysql:8.0 service container.
//
// Configure via MYSQL_HOST / MYSQL_PORT / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { MysqlConnection } from '../database/mysql/wire.js';
import { MysqlPool } from '../database/mysql/pool.js';

const MYSQL_HOST = process.env['MYSQL_HOST'];
const skip: boolean | string = MYSQL_HOST ? false : 'MYSQL_HOST not set — skipping MySQL certification';

const opts = {
  host: MYSQL_HOST ?? '127.0.0.1',
  port: parseInt(process.env['MYSQL_PORT'] ?? '3306', 10),
  user: process.env['MYSQL_USER'] ?? 'root',
  password: process.env['MYSQL_PASSWORD'] ?? '',
  database: process.env['MYSQL_DATABASE'] ?? 'street_test',
};

const table = 'cert_' + randomBytes(4).toString('hex');

describe('MySQL certification (E2E)', { skip }, () => {
  let conn: MysqlConnection;

  before(async () => {
    conn = await MysqlConnection.connect(opts);
    await conn.query(`CREATE TABLE ${table} (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(255) NOT NULL)`);
  });
  after(async () => {
    try { await conn.query(`DROP TABLE IF EXISTS ${table}`); } catch { /* ignore */ }
    await conn.close();
  });

  it('authenticates and runs a trivial query', async () => {
    const r = await conn.query('SELECT 1 AS n');
    assert.equal(Number(r.rows[0]?.['n']), 1);
  });

  it('performs parameterized CRUD', async () => {
    const ins = await conn.query(`INSERT INTO ${table} (name) VALUES (?)`, ['alice']);
    assert.ok(ins.command);
    const read = await conn.query(`SELECT name FROM ${table} WHERE name = ?`, ['alice']);
    assert.equal(read.rows[0]?.['name'], 'alice');
    await conn.query(`UPDATE ${table} SET name = ? WHERE name = ?`, ['bob', 'alice']);
    const upd = await conn.query(`SELECT count(*) AS c FROM ${table} WHERE name = ?`, ['bob']);
    assert.equal(Number(upd.rows[0]?.['c']), 1);
    await conn.query(`DELETE FROM ${table} WHERE name = ?`, ['bob']);
    const del = await conn.query(`SELECT count(*) AS c FROM ${table}`);
    assert.equal(Number(del.rows[0]?.['c']), 0);
  });

  it('commits and rolls back transactions via the pool', async () => {
    const pool = new MysqlPool({ ...opts, minConnections: 1, maxConnections: 4 });
    try {
      await pool.transaction(async (c) => { await c.query(`INSERT INTO ${table} (name) VALUES (?)`, ['tx-commit']); });
      const committed = await pool.query(`SELECT count(*) AS c FROM ${table} WHERE name = ?`, ['tx-commit']);
      assert.equal(Number(committed.rows[0]?.['c']), 1);

      await assert.rejects(pool.transaction(async (c) => {
        await c.query(`INSERT INTO ${table} (name) VALUES (?)`, ['tx-rollback']);
        throw new Error('force rollback');
      }));
      const rolled = await pool.query(`SELECT count(*) AS c FROM ${table} WHERE name = ?`, ['tx-rollback']);
      assert.equal(Number(rolled.rows[0]?.['c']), 0);
    } finally {
      await pool.close();
    }
  });

  it('handles concurrent pooled queries', async () => {
    const pool = new MysqlPool({ ...opts, minConnections: 2, maxConnections: 5 });
    try {
      const results = await Promise.all(Array.from({ length: 16 }, () => pool.query('SELECT 1 AS n')));
      assert.equal(results.length, 16);
      assert.ok(results.every((r) => Number(r.rows[0]?.['n']) === 1));
    } finally {
      await pool.close();
    }
  });

  it('rejects authentication with a wrong password (no insecure fallback)', async () => {
    await assert.rejects(MysqlConnection.connect({ ...opts, password: '__definitely_wrong__' }));
  });
});
