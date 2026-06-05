// src/tests/mysql.test.ts
// Integration tests for MysqlConnection and MysqlPool.
// Requires a running MySQL/MariaDB server.
//
// Guard: the entire suite is skipped (node:test `skip` option) when MYSQL_HOST
// is not set — the runner reports skipped suites and exits 0.
//
// Environment variables:
//   MYSQL_HOST     — hostname (required to run tests)
//   MYSQL_PORT     — port (default: 3306)
//   MYSQL_USER     — user (default: root)
//   MYSQL_PASSWORD — password (default: '')
//   MYSQL_DATABASE — database (default: 'test')
//
// Run after `tsc`:
//   MYSQL_HOST=127.0.0.1 node --test dist/tests/mysql.test.js
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { MysqlConnection } from '../database/mysql/wire.js';
import { MysqlPool } from '../database/mysql/pool.js';
import { MariaDbConnection } from '../database/mysql/mariadb.js';
// ─── Guard ────────────────────────────────────────────────────────────────────
// When MYSQL_HOST is absent the whole suite is reported as skipped via the
// node:test `skip` option — the runner prints `# skipped` and exits 0 without
// running any hooks or tests (no real connection is ever attempted).
const MYSQL_HOST = process.env['MYSQL_HOST'];
const skip = MYSQL_HOST
    ? false
    : 'MYSQL_HOST not set — skipping MySQL integration tests';
// ─── Connection options ───────────────────────────────────────────────────────
// The host falls back to a placeholder only to satisfy the type when the suite
// is skipped; it is never used because skipped suites do not run their hooks.
const opts = {
    host: MYSQL_HOST ?? '127.0.0.1',
    port: parseInt(process.env['MYSQL_PORT'] ?? '3306', 10),
    user: process.env['MYSQL_USER'] ?? 'root',
    password: process.env['MYSQL_PASSWORD'] ?? '',
    database: process.env['MYSQL_DATABASE'] ?? 'test',
};
// ─── 1. Connection ────────────────────────────────────────────────────────────
describe('MysqlConnection — connect', { skip }, () => {
    it('connects and is ready', async () => {
        const conn = await MysqlConnection.connect(opts);
        try {
            assert.ok(conn.isReady);
        }
        finally {
            await conn.close();
        }
    });
    it('exposes a non-empty serverVersion', async () => {
        const conn = await MysqlConnection.connect(opts);
        try {
            assert.equal(typeof conn.serverVersion, 'string');
            assert.ok(conn.serverVersion.length > 0, 'expected a non-empty server version string');
        }
        finally {
            await conn.close();
        }
    });
    it('close() marks the connection as closed', async () => {
        const conn = await MysqlConnection.connect(opts);
        await conn.close();
        assert.ok(conn.isClosed);
    });
    it('returns MariaDbConnection for MariaDB servers', async () => {
        const conn = await MysqlConnection.connect(opts);
        try {
            const version = conn.serverVersion;
            if (version.includes('MariaDB') || version.startsWith('5.5.5-')) {
                assert.ok(conn instanceof MariaDbConnection, 'expected MariaDbConnection for MariaDB server');
            }
            else {
                assert.ok(conn instanceof MysqlConnection, 'expected MysqlConnection for MySQL server');
            }
        }
        finally {
            await conn.close();
        }
    });
    it('throws on bad credentials', async () => {
        await assert.rejects(() => MysqlConnection.connect({ ...opts, password: '__wrong_password__' }), /MySQL error/i);
    });
});
// ─── 2. Simple query ──────────────────────────────────────────────────────────
describe('MysqlConnection — simple query', { skip }, () => {
    let conn;
    before(async () => { conn = await MysqlConnection.connect(opts); });
    after(async () => { await conn.close(); });
    it('SELECT 1 returns a row', async () => {
        const result = await conn.query('SELECT 1 AS n');
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0]['n'], '1');
    });
    it('result has command and rowCount', async () => {
        const result = await conn.query('SELECT 1 AS x');
        assert.ok(typeof result.command === 'string');
        assert.ok(typeof result.rowCount === 'number');
    });
    it('CREATE TABLE and DROP TABLE', async () => {
        await conn.query('CREATE TABLE IF NOT EXISTS _street_test_simple (id INT)');
        const r = await conn.query('DROP TABLE _street_test_simple');
        assert.ok(r !== null);
    });
});
// ─── 3. Parameterized query ───────────────────────────────────────────────────
describe('MysqlConnection — parameterized query', { skip }, () => {
    let conn;
    before(async () => {
        conn = await MysqlConnection.connect(opts);
        await conn.query('CREATE TABLE IF NOT EXISTS _street_test_params (id INT, name VARCHAR(100))');
    });
    after(async () => {
        await conn.query('DROP TABLE IF EXISTS _street_test_params');
        await conn.close();
    });
    it('INSERT with params uses prepared statement', async () => {
        const r = await conn.query('INSERT INTO _street_test_params VALUES (?, ?)', [1, 'Alice']);
        assert.equal(r.rowCount, 1);
    });
    it('SELECT with params returns matching row', async () => {
        await conn.query('INSERT INTO _street_test_params VALUES (?, ?)', [2, 'Bob']);
        const r = await conn.query('SELECT name FROM _street_test_params WHERE id = ?', [2]);
        assert.equal(r.rows.length, 1);
        assert.equal(r.rows[0]['name'], 'Bob');
    });
    it('NULL param is handled', async () => {
        await conn.query('INSERT INTO _street_test_params VALUES (?, ?)', [3, null]);
        const r = await conn.query('SELECT name FROM _street_test_params WHERE id = ?', [3]);
        assert.equal(r.rows[0]['name'], null);
    });
});
// ─── 4. Transaction commit ────────────────────────────────────────────────────
describe('MysqlConnection — transaction commit', { skip }, () => {
    let conn;
    before(async () => {
        conn = await MysqlConnection.connect(opts);
        await conn.query('CREATE TABLE IF NOT EXISTS _street_test_tx (id INT PRIMARY KEY, val VARCHAR(50))');
    });
    after(async () => {
        await conn.query('DROP TABLE IF EXISTS _street_test_tx');
        await conn.close();
    });
    it('committed rows persist after COMMIT', async () => {
        await conn.query('START TRANSACTION');
        await conn.query("INSERT INTO _street_test_tx VALUES (1, 'committed')");
        await conn.query('COMMIT');
        const r = await conn.query('SELECT val FROM _street_test_tx WHERE id = 1');
        assert.equal(r.rows[0]['val'], 'committed');
    });
});
// ─── 5. Transaction rollback ──────────────────────────────────────────────────
describe('MysqlConnection — transaction rollback', { skip }, () => {
    let conn;
    before(async () => {
        conn = await MysqlConnection.connect(opts);
        await conn.query('CREATE TABLE IF NOT EXISTS _street_test_rollback (id INT PRIMARY KEY, val VARCHAR(50))');
    });
    after(async () => {
        await conn.query('DROP TABLE IF EXISTS _street_test_rollback');
        await conn.close();
    });
    it('rolled-back rows do not persist after ROLLBACK', async () => {
        await conn.query('START TRANSACTION');
        await conn.query("INSERT INTO _street_test_rollback VALUES (10, 'lost')");
        await conn.query('ROLLBACK');
        const r = await conn.query('SELECT COUNT(*) AS cnt FROM _street_test_rollback');
        assert.equal(r.rows[0]['cnt'], '0');
    });
});
// ─── 6. Concurrent queries via MysqlPool ─────────────────────────────────────
describe('MysqlPool — concurrent queries', { skip }, () => {
    let pool;
    before(async () => {
        pool = new MysqlPool({ ...opts, minConnections: 2, maxConnections: 5 });
        await pool.query('CREATE TABLE IF NOT EXISTS _street_test_concurrent (id INT, val INT)');
        // Seed rows
        for (let i = 0; i < 10; i++) {
            await pool.query('INSERT INTO _street_test_concurrent VALUES (?, ?)', [i, i * 10]);
        }
    });
    after(async () => {
        await pool.query('DROP TABLE IF EXISTS _street_test_concurrent');
        await pool.close();
    });
    it('runs 8 concurrent SELECT queries and returns correct results', async () => {
        const promises = Array.from({ length: 8 }, (_, i) => pool.query('SELECT val FROM _street_test_concurrent WHERE id = ?', [i]));
        const results = await Promise.all(promises);
        for (let i = 0; i < 8; i++) {
            const row = results[i].rows[0];
            assert.ok(row, `expected row for id=${i}`);
            assert.equal(row['val'], String(i * 10));
        }
    });
    it('pool transaction commits correctly', async () => {
        await pool.transaction(async (conn) => {
            await conn.query("INSERT INTO _street_test_concurrent VALUES (99, 990)");
        });
        const r = await pool.query('SELECT val FROM _street_test_concurrent WHERE id = 99');
        assert.equal(r.rows[0]['val'], '990');
    });
    it('pool transaction rolls back on error', async () => {
        await assert.rejects(() => pool.transaction(async (conn) => {
            await conn.query("INSERT INTO _street_test_concurrent VALUES (100, 1000)");
            throw new Error('deliberate rollback');
        }), /deliberate rollback/);
        const r = await pool.query('SELECT COUNT(*) AS cnt FROM _street_test_concurrent WHERE id = 100');
        assert.equal(r.rows[0]['cnt'], '0');
    });
});
// ─── 7. MysqlPool lifecycle ───────────────────────────────────────────────────
describe('MysqlPool — lifecycle', { skip }, () => {
    it('close() shuts down cleanly', async () => {
        const pool = new MysqlPool({ ...opts, minConnections: 1, maxConnections: 2 });
        await pool.query('SELECT 1');
        await assert.doesNotReject(() => pool.close());
    });
    it('rejects queries after close', async () => {
        const pool = new MysqlPool({ ...opts, minConnections: 0, maxConnections: 1 });
        await pool.close();
        await assert.rejects(() => pool.query('SELECT 1'), /closed/i);
    });
    it('pool.size and pool.idle reflect state', async () => {
        const pool = new MysqlPool({ ...opts, minConnections: 0, maxConnections: 3 });
        try {
            await pool.query('SELECT 1');
            assert.ok(pool.size >= 1);
            assert.ok(pool.idle >= 1);
        }
        finally {
            await pool.close();
        }
    });
});
//# sourceMappingURL=mysql.test.js.map