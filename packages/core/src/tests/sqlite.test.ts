// src/tests/sqlite.test.ts
// Integration tests for SqlitePool — no database server required.
// Tests run against a real SQLite file (and in-memory databases) using the
// official SQLite WASM binary via worker_threads.
//
// Run after `tsc`:
//   node --test dist/tests/sqlite.test.js

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SqlitePool } from '../database/sqlite/pool.js';
import type { DbResult } from '../database/types.js';

// ─── Shared setup ─────────────────────────────────────────────────────────────

/**
 * Generate a unique flat path in `/tmp/` for a test database.
 * SQLite WASM (via Emscripten) on Node.js can only create files directly
 * in `/tmp/`, not in nested subdirectories, because the Emscripten virtual
 * filesystem does not automatically see subdirectories created on the real
 * filesystem.
 */
function dbPath(name: string): string {
  return join(tmpdir(), `street-sqlite-test-${name}-${Date.now()}.db`);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

async function withPool<T>(
  path: string,
  fn: (pool: SqlitePool) => Promise<T>,
  opts?: { maxWorkers?: number },
): Promise<T> {
  const pool = new SqlitePool({ filePath: path, maxWorkers: opts?.maxWorkers ?? 1 });
  try {
    return await fn(pool);
  } finally {
    await pool.close();
  }
}

// ─── 1. Create table ──────────────────────────────────────────────────────────

describe('SqlitePool — create table', () => {
  it('creates a table without throwing', async () => {
    await withPool(dbPath('create-table'), async (pool) => {
      const result = await pool.query(
        'CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)',
      );
      assert.equal(result.command, 'CREATE');
      assert.equal(result.rowCount, 0);
      assert.deepEqual(result.rows, []);
    });
  });

  it('returns a DbResult shaped object', async () => {
    await withPool(dbPath('result-shape'), async (pool) => {
      const result: DbResult = await pool.query('CREATE TABLE x (n INTEGER)');
      assert.ok('rows' in result);
      assert.ok('rowCount' in result);
      assert.ok('command' in result);
      assert.ok(Array.isArray(result.rows));
    });
  });
});

// ─── 2. Insert ───────────────────────────────────────────────────────────────

describe('SqlitePool — insert', () => {
  it('inserts a row and reports rowCount=1', async () => {
    await withPool(dbPath('insert'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
      const r = await pool.query("INSERT INTO t VALUES (1, 'hello')");
      assert.equal(r.command, 'INSERT');
      assert.equal(r.rowCount, 1);
    });
  });

  it('inserts with positional params', async () => {
    await withPool(dbPath('insert-params'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
      const r = await pool.query('INSERT INTO t VALUES (?, ?)', [42, 'world']);
      assert.equal(r.rowCount, 1);
    });
  });

  it('inserts multiple rows and reports correct rowCount', async () => {
    await withPool(dbPath('insert-multi'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER, val TEXT)');
      const r = await pool.query(
        "INSERT INTO t VALUES (1,'a'),(2,'b'),(3,'c')",
      );
      assert.equal(r.rowCount, 3);
    });
  });
});

// ─── 3. Query ────────────────────────────────────────────────────────────────

describe('SqlitePool — query', () => {
  it('returns rows as Record<string, string|null>[]', async () => {
    await withPool(dbPath('query-rows'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER, name TEXT)');
      await pool.query("INSERT INTO t VALUES (1, 'Alice'), (2, 'Bob')");
      const r = await pool.query('SELECT * FROM t ORDER BY id');
      assert.equal(r.command, 'SELECT');
      assert.equal(r.rows.length, 2);
      assert.deepEqual(r.rows[0], { id: '1', name: 'Alice' });
      assert.deepEqual(r.rows[1], { id: '2', name: 'Bob' });
    });
  });

  it('returns NULL columns as null', async () => {
    await withPool(dbPath('query-null'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER, note TEXT)');
      await pool.query('INSERT INTO t VALUES (1, NULL)');
      const r = await pool.query('SELECT * FROM t');
      assert.equal(r.rows[0]!['note'], null);
    });
  });

  it('returns empty rows array for no matches', async () => {
    await withPool(dbPath('query-empty'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER)');
      const r = await pool.query('SELECT * FROM t WHERE id = 999');
      assert.equal(r.rows.length, 0);
      assert.equal(r.rowCount, 0);
    });
  });

  it('uses parameterized SELECT correctly', async () => {
    await withPool(dbPath('query-param'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER, name TEXT)');
      await pool.query("INSERT INTO t VALUES (1,'X'), (2,'Y')");
      const r = await pool.query('SELECT * FROM t WHERE id = ?', [2]);
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0]!['name'], 'Y');
    });
  });
});

// ─── 4. Transaction rollback ──────────────────────────────────────────────────

describe('SqlitePool — transaction rollback', () => {
  it('rolls back all changes when the callback throws', async () => {
    await withPool(dbPath('rollback'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
      await pool.query("INSERT INTO t VALUES (1, 'before')");

      // Transaction inserts row 2 then throws — row 2 must not persist
      await assert.rejects(
        pool.transaction(async (q) => {
          await q("INSERT INTO t VALUES (2, 'inside')");
          throw new Error('deliberate rollback trigger');
        }),
        /deliberate rollback trigger/,
      );

      const r = await pool.query('SELECT COUNT(*) AS cnt FROM t');
      assert.equal(r.rows[0]!['cnt'], '1');
    });
  });

  it('commits all changes on success', async () => {
    await withPool(dbPath('commit'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER PRIMARY KEY)');

      await pool.transaction(async (q) => {
        await q('INSERT INTO t VALUES (1)');
        await q('INSERT INTO t VALUES (2)');
        await q('INSERT INTO t VALUES (3)');
      });

      const r = await pool.query('SELECT COUNT(*) AS cnt FROM t');
      assert.equal(r.rows[0]!['cnt'], '3');
    });
  });

  it('returns the value returned by the callback', async () => {
    await withPool(dbPath('tx-return'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER)');
      const val = await pool.transaction(async (q) => {
        await q('INSERT INTO t VALUES (99)');
        return 'custom-return-value';
      });
      assert.equal(val, 'custom-return-value');
    });
  });
});

// ─── 5. Concurrent reads ─────────────────────────────────────────────────────

describe('SqlitePool — concurrent reads', () => {
  it('serves multiple concurrent SELECT queries', async () => {
    await withPool(dbPath('concurrent'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER, val INTEGER)');
      // Seed 10 rows
      for (let i = 0; i < 10; i++) {
        await pool.query('INSERT INTO t VALUES (?, ?)', [i, i * 2]);
      }

      // Fire 8 concurrent reads
      const promises = Array.from({ length: 8 }, (_, i) =>
        pool.query('SELECT * FROM t WHERE id = ?', [i]),
      );
      const results = await Promise.all(promises);

      for (let i = 0; i < 8; i++) {
        const row = results[i]!.rows[0];
        assert.ok(row, `expected row for id=${i}`);
        assert.equal(row['id'], String(i));
        assert.equal(row['val'], String(i * 2));
      }
    }, { maxWorkers: 4 });
  });

  it('handles many rapid sequential queries correctly', async () => {
    await withPool(dbPath('rapid'), async (pool) => {
      await pool.query('CREATE TABLE t (n INTEGER)');
      const N = 20;
      for (let i = 0; i < N; i++) {
        await pool.query('INSERT INTO t VALUES (?)', [i]);
      }
      const r = await pool.query('SELECT COUNT(*) AS cnt FROM t');
      assert.equal(r.rows[0]!['cnt'], String(N));
    });
  });

  it('maintains isolation between concurrent transactions on separate workers', async () => {
    await withPool(dbPath('isolation'), async (pool) => {
      await pool.query('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');

      // Two concurrent transactions writing different rows
      await Promise.all([
        pool.transaction(async (q) => {
          await q("INSERT INTO t VALUES (1, 'tx1')");
        }),
        pool.transaction(async (q) => {
          await q("INSERT INTO t VALUES (2, 'tx2')");
        }),
      ]);

      const r = await pool.query('SELECT COUNT(*) AS cnt FROM t');
      assert.equal(r.rows[0]!['cnt'], '2');
    }, { maxWorkers: 2 });
  });
});

// ─── 6. Close / lifecycle ─────────────────────────────────────────────────────

describe('SqlitePool — lifecycle', () => {
  it('close() terminates workers cleanly', async () => {
    const pool = new SqlitePool({ filePath: ':memory:' });
    await pool.query('SELECT 1');
    await assert.doesNotReject(() => pool.close());
  });

  it('rejects queries after close', async () => {
    const pool = new SqlitePool({ filePath: ':memory:' });
    await pool.close();
    await assert.rejects(
      () => pool.query('SELECT 1'),
      /closed/i,
    );
  });

  it('works with :memory: database', async () => {
    const pool = new SqlitePool({ filePath: ':memory:' });
    try {
      await pool.query('CREATE TABLE m (x INTEGER)');
      await pool.query('INSERT INTO m VALUES (42)');
      const r = await pool.query('SELECT x FROM m');
      assert.equal(r.rows[0]!['x'], '42');
    } finally {
      await pool.close();
    }
  });
});
