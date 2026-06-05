// src/tests/profiler.test.ts
// Tests for:
//   - StreetSeeder idempotency (seed runs are skipped when hash already recorded)
//   - QueryProfiler records queries and getSlowQueries returns sorted results
//   - PgPool emits pool:exhausted event when pool is saturated
//
// Uses SqlitePool with :memory: for seeder tests (no PG server required).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SqlitePool } from '../database/sqlite/pool.js';
import { StreetSeeder } from '../database/seeder.js';
import { QueryProfiler, ConnectionDiagnostics } from '../database/profiler.js';
import { PgPool, onPoolExhausted } from '../database/pool.js';
import type { DbResult } from '../database/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Write a temp SQL seed file and return its path. */
async function writeSeedFile(name: string, sql: string): Promise<string> {
  const filePath = join(tmpdir(), `street-seed-test-${name}-${Date.now()}.sql`);
  await writeFile(filePath, sql, 'utf8');
  return filePath;
}

// ─── 1. StreetSeeder — idempotency ────────────────────────────────────────────

describe('StreetSeeder — seed runs are idempotent', () => {
  it('applies a seed file and records the hash', async () => {
    const pool = new SqlitePool({ filePath: ':memory:' });
    try {
      // Create table so seed has something to insert
      await pool.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)');

      const seedPath = await writeSeedFile('first', "INSERT INTO users VALUES (1, 'Alice')");
      try {
        const result = await StreetSeeder.run(pool, seedPath);
        assert.equal(result.skipped, false, 'first run should apply');
        assert.ok(typeof result.hash === 'string' && result.hash.length === 64, 'hash should be a 64-char hex string');

        // Verify row was inserted
        const rows = await pool.query('SELECT * FROM users');
        assert.equal(rows.rows.length, 1);
        assert.equal(rows.rows[0]!['name'], 'Alice');
      } finally {
        await rm(seedPath, { force: true });
      }
    } finally {
      await pool.close();
    }
  });

  it('skips seed file when the same content hash already exists', async () => {
    const pool = new SqlitePool({ filePath: ':memory:' });
    try {
      await pool.query('CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT)');

      const seedPath = await writeSeedFile('idempotent', "INSERT INTO items VALUES (1, 'x')");
      try {
        // First run — applies
        const first = await StreetSeeder.run(pool, seedPath);
        assert.equal(first.skipped, false, 'first run should not be skipped');

        // Second run — must be skipped; table still has only 1 row
        const second = await StreetSeeder.run(pool, seedPath);
        assert.equal(second.skipped, true, 'second run should be skipped');
        assert.equal(second.hash, first.hash, 'hash must match between runs');

        // Row was not inserted twice
        const rows = await pool.query('SELECT COUNT(*) AS cnt FROM items');
        assert.equal(rows.rows[0]!['cnt'], '1', 'row must not be duplicated');
      } finally {
        await rm(seedPath, { force: true });
      }
    } finally {
      await pool.close();
    }
  });

  it('treats two files with different content as different seeds', async () => {
    const pool = new SqlitePool({ filePath: ':memory:' });
    try {
      await pool.query('CREATE TABLE logs (id INTEGER PRIMARY KEY, msg TEXT)');

      const seedA = await writeSeedFile('different-a', "INSERT INTO logs VALUES (1, 'a')");
      const seedB = await writeSeedFile('different-b', "INSERT INTO logs VALUES (2, 'b')");
      try {
        const rA = await StreetSeeder.run(pool, seedA);
        const rB = await StreetSeeder.run(pool, seedB);

        assert.equal(rA.skipped, false);
        assert.equal(rB.skipped, false);
        assert.notEqual(rA.hash, rB.hash, 'different content must produce different hashes');

        const rows = await pool.query('SELECT COUNT(*) AS cnt FROM logs');
        assert.equal(rows.rows[0]!['cnt'], '2');
      } finally {
        await rm(seedA, { force: true });
        await rm(seedB, { force: true });
      }
    } finally {
      await pool.close();
    }
  });
});

// ─── 2. QueryProfiler — records queries and sorts slow results ─────────────────

/**
 * A minimal mock pool that introduces artificial latency to simulate
 * slow vs fast queries without touching any real database.
 */
function makeMockPool(delaysByQuery: Map<string, number>): {
  query(sql: string, params?: unknown[]): Promise<DbResult>;
} {
  return {
    async query(sql: string, _params?: unknown[]): Promise<DbResult> {
      const delayMs = delaysByQuery.get(sql) ?? 0;
      if (delayMs > 0) {
        await new Promise<void>((r) => setTimeout(r, delayMs));
      }
      return { rows: [], rowCount: 0, command: 'SELECT' };
    },
  };
}

describe('QueryProfiler — records queries', () => {
  it('records a query after execution', async () => {
    const profiler = new QueryProfiler();
    const inner = makeMockPool(new Map([['SELECT 1', 5]]));
    const wrapped = profiler.enable(inner);

    await wrapped.query('SELECT 1');

    assert.equal(profiler.recordedCount, 1, 'should have recorded 1 query');
    const slow = profiler.getSlowQueries(0);
    assert.equal(slow.length, 1);
    assert.equal(slow[0]!.sql, 'SELECT 1');
    assert.ok(slow[0]!.durationMs >= 0, 'durationMs should be non-negative');
  });

  it('records multiple queries', async () => {
    const profiler = new QueryProfiler();
    const inner = makeMockPool(new Map());
    const wrapped = profiler.enable(inner);

    await wrapped.query('SELECT 1');
    await wrapped.query('SELECT 2');
    await wrapped.query('SELECT 3');

    assert.equal(profiler.recordedCount, 3);
  });

  it('records params alongside the query', async () => {
    const profiler = new QueryProfiler();
    const inner = makeMockPool(new Map([['SELECT $1', 0]]));
    const wrapped = profiler.enable(inner);

    await wrapped.query('SELECT $1', [42]);

    const records = profiler.getSlowQueries(0);
    assert.deepEqual(records[0]!.params, [42]);
  });

  it('clear() removes all records', async () => {
    const profiler = new QueryProfiler();
    const inner = makeMockPool(new Map());
    const wrapped = profiler.enable(inner);

    await wrapped.query('SELECT 1');
    assert.equal(profiler.recordedCount, 1);

    profiler.clear();
    assert.equal(profiler.recordedCount, 0);
    assert.equal(profiler.getSlowQueries(0).length, 0);
  });
});

describe('QueryProfiler — getSlowQueries returns sorted results', () => {
  it('returns only queries at or above the threshold', async () => {
    const profiler = new QueryProfiler();
    // Use artificially-set durations by manually recording entries
    profiler._record({ sql: 'fast', params: [], startedAt: Date.now(), durationMs: 5 });
    profiler._record({ sql: 'medium', params: [], startedAt: Date.now(), durationMs: 50 });
    profiler._record({ sql: 'slow', params: [], startedAt: Date.now(), durationMs: 200 });

    const results = profiler.getSlowQueries(50);
    assert.equal(results.length, 2, 'only queries >= 50ms should be returned');
    // All returned entries must be at or above threshold
    for (const r of results) {
      assert.ok(r.durationMs >= 50, `durationMs ${r.durationMs} should be >= 50`);
    }
  });

  it('returns queries sorted by durationMs descending (slowest first)', () => {
    const profiler = new QueryProfiler();
    profiler._record({ sql: 'a', params: [], startedAt: Date.now(), durationMs: 10 });
    profiler._record({ sql: 'b', params: [], startedAt: Date.now(), durationMs: 300 });
    profiler._record({ sql: 'c', params: [], startedAt: Date.now(), durationMs: 150 });
    profiler._record({ sql: 'd', params: [], startedAt: Date.now(), durationMs: 75 });

    const results = profiler.getSlowQueries(0);
    assert.equal(results.length, 4);
    // Verify descending order
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(
        results[i]!.durationMs >= results[i + 1]!.durationMs,
        `Entry ${i} (${results[i]!.durationMs}ms) should be >= entry ${i + 1} (${results[i + 1]!.durationMs}ms)`,
      );
    }
    assert.equal(results[0]!.sql, 'b', 'slowest query (300ms) should be first');
  });

  it('returns empty array when no queries meet the threshold', () => {
    const profiler = new QueryProfiler();
    profiler._record({ sql: 'q', params: [], startedAt: Date.now(), durationMs: 10 });
    const results = profiler.getSlowQueries(100);
    assert.deepEqual(results, []);
  });

  it('returns empty array when no queries recorded', () => {
    const profiler = new QueryProfiler();
    assert.deepEqual(profiler.getSlowQueries(0), []);
  });
});

describe('QueryProfiler — ring buffer behaviour', () => {
  it('records up to RING_CAPACITY without overflowing', async () => {
    // Only test a small batch — do not spin 10,000 iterations in CI
    const profiler = new QueryProfiler();
    const inner = makeMockPool(new Map());
    const wrapped = profiler.enable(inner);

    const N = 50;
    for (let i = 0; i < N; i++) {
      await wrapped.query('SELECT 1');
    }
    assert.equal(profiler.recordedCount, N);
  });
});

// ─── 3. pool:exhausted fires on a REAL PgPool when saturated ──────────────────
//
// These tests exercise the real PgPool and its real `events` EventEmitter — no
// mock of the unit under test. A pool created with `maxConnections: 0` is
// saturated from the very first acquire: PgPool can never create a connection,
// so `acquire()` synchronously emits 'pool:exhausted' (reporting the pre-enqueue
// state) before pushing a waiter. No live database is contacted because no
// connection is ever attempted at maxConnections: 0. The queued waiter is then
// settled deterministically by closing the pool (no reliance on timers).

/** Connect options for a saturated pool; no DB is reached at maxConnections: 0. */
const SATURATED_OPTS = {
  host: '127.0.0.1',
  port: 5432,
  user: 'street',
  password: 'street',
  database: 'street',
  maxConnections: 0,
  acquireTimeoutMs: 50,
} as const;

describe('pool:exhausted — real PgPool emits on saturation', () => {
  it('emits pool:exhausted before enqueueing when the pool is full', async () => {
    const pool = new PgPool({ ...SATURATED_OPTS });

    let received: { total: number; idle: number; waiting: number } | undefined;
    pool.events.once('pool:exhausted', (state: { total: number; idle: number; waiting: number }) => {
      received = state;
    });

    // acquire() cannot create a connection at maxConnections: 0, so it emits
    // pool:exhausted synchronously and enqueues a waiter (still pending here).
    const pending = pool.acquire();
    const settled = assert.rejects(pending, /Connection pool is closed/);

    assert.ok(received !== undefined, 'pool:exhausted must be emitted on saturation');
    assert.equal(received.total, 0, 'no connections exist at saturation');
    assert.equal(received.idle, 0, 'no idle connections at saturation');
    assert.equal(received.waiting, 0, 'event fires BEFORE the waiter is enqueued');

    // Closing the pool rejects the queued waiter deterministically.
    await pool.close();
    await settled;
  });

  it('reports the growing queue length before each enqueue', async () => {
    const pool = new PgPool({ ...SATURATED_OPTS });

    const waitingAtEmit: number[] = [];
    pool.events.on('pool:exhausted', (state: { waiting: number }) => {
      waitingAtEmit.push(state.waiting);
    });

    // Two acquires: the first sees an empty wait queue, the second sees the
    // first waiter already enqueued. Both emits happen synchronously.
    const first = assert.rejects(pool.acquire(), /Connection pool is closed/);
    const second = assert.rejects(pool.acquire(), /Connection pool is closed/);

    assert.equal(waitingAtEmit.length, 2, 'pool:exhausted fires once per acquire attempt');
    assert.deepEqual(waitingAtEmit, [0, 1], 'event reports queue length before each enqueue');

    await pool.close();
    await Promise.all([first, second]);
  });
});

describe('onPoolExhausted — attaches and detaches on a real PgPool', () => {
  it('helper fires on saturation and stops after detach', async () => {
    const pool = new PgPool({ ...SATURATED_OPTS });

    const fired: Array<{ total: number; idle: number; waiting: number }> = [];
    const off = onPoolExhausted(pool, (state) => {
      fired.push(state);
    });

    const first = assert.rejects(pool.acquire(), /Connection pool is closed/);
    assert.equal(fired.length, 1, 'listener should fire once on saturation');

    // Detach and verify no further events are delivered.
    off();
    const second = assert.rejects(pool.acquire(), /Connection pool is closed/);
    assert.equal(fired.length, 1, 'listener should not fire after detach');

    await pool.close();
    await Promise.all([first, second]);
  });
});

// ─── 4. ConnectionDiagnostics — ping & poolStats ──────────────────────────────

describe('ConnectionDiagnostics.ping — sends SELECT 1 and measures round-trip', () => {
  it('issues SELECT 1 and returns a non-negative latency', async () => {
    let received: string | undefined;
    const pool = {
      async query(sql: string): Promise<DbResult> {
        received = sql;
        await new Promise<void>((r) => setTimeout(r, 2));
        return { rows: [], rowCount: 0, command: 'SELECT' };
      },
    };

    const { latencyMs } = await ConnectionDiagnostics.ping(pool);

    assert.equal(received, 'SELECT 1', 'ping must send SELECT 1');
    assert.ok(latencyMs >= 0, 'latency should be non-negative');
  });
});

describe('ConnectionDiagnostics.poolStats — wires real pool stats', () => {
  const noopQuery = async (): Promise<DbResult> => ({ rows: [], rowCount: 0, command: 'SELECT' });

  it('reflects real waiting and avgAcquireMs from the pool', () => {
    const pool = {
      query: noopQuery,
      size: 10,
      idle: 4,
      waiting: 3,
      avgAcquireMs: 12.5,
    };

    const stats = ConnectionDiagnostics.poolStats(pool);
    assert.equal(stats.total, 10);
    assert.equal(stats.idle, 4);
    assert.equal(stats.inUse, 6);
    assert.equal(stats.waiting, 3);
    assert.equal(stats.avgAcquireMs, 12.5);
  });

  it('unwraps ProfiledPool and reads stats from the inner pool', () => {
    const inner = {
      query: noopQuery,
      size: 8,
      idle: 2,
      waiting: 5,
      avgAcquireMs: 7,
    };
    const profiler = new QueryProfiler();
    const wrapped = profiler.enable(inner);

    const stats = ConnectionDiagnostics.poolStats(wrapped);
    assert.equal(stats.total, 8);
    assert.equal(stats.idle, 2);
    assert.equal(stats.inUse, 6);
    assert.equal(stats.waiting, 5);
    assert.equal(stats.avgAcquireMs, 7);
  });

  it('defaults missing fields to 0 for pools that do not expose them', () => {
    const pool = { query: noopQuery };
    const stats = ConnectionDiagnostics.poolStats(pool);
    assert.deepEqual(stats, { total: 0, idle: 0, inUse: 0, waiting: 0, avgAcquireMs: 0 });
  });
});
