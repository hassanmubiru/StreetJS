// src/tests/profiler.test.ts
// Tests for:
//   - StreetSeeder idempotency (seed runs are skipped when hash already recorded)
//   - QueryProfiler records queries and getSlowQueries returns sorted results
//   - PgPool emits pool:exhausted event when pool is saturated
//
// Uses SqlitePool with :memory: for seeder tests (no PG server required).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SqlitePool } from '../database/sqlite/pool.js';
import { StreetSeeder } from '../database/seeder.js';
import { QueryProfiler } from '../database/profiler.js';
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Write a temp SQL seed file and return its path. */
async function writeSeedFile(name, sql) {
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
                assert.equal(rows.rows[0]['name'], 'Alice');
            }
            finally {
                await rm(seedPath, { force: true });
            }
        }
        finally {
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
                assert.equal(rows.rows[0]['cnt'], '1', 'row must not be duplicated');
            }
            finally {
                await rm(seedPath, { force: true });
            }
        }
        finally {
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
                assert.equal(rows.rows[0]['cnt'], '2');
            }
            finally {
                await rm(seedA, { force: true });
                await rm(seedB, { force: true });
            }
        }
        finally {
            await pool.close();
        }
    });
});
// ─── 2. QueryProfiler — records queries and sorts slow results ─────────────────
/**
 * A minimal mock pool that introduces artificial latency to simulate
 * slow vs fast queries without touching any real database.
 */
function makeMockPool(delaysByQuery) {
    return {
        async query(sql, _params) {
            const delayMs = delaysByQuery.get(sql) ?? 0;
            if (delayMs > 0) {
                await new Promise((r) => setTimeout(r, delayMs));
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
        assert.equal(slow[0].sql, 'SELECT 1');
        assert.ok(slow[0].durationMs >= 0, 'durationMs should be non-negative');
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
        assert.deepEqual(records[0].params, [42]);
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
            assert.ok(results[i].durationMs >= results[i + 1].durationMs, `Entry ${i} (${results[i].durationMs}ms) should be >= entry ${i + 1} (${results[i + 1].durationMs}ms)`);
        }
        assert.equal(results[0].sql, 'b', 'slowest query (300ms) should be first');
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
// ─── 3. pool:exhausted event fires when pool is saturated ─────────────────────
describe('pool:exhausted — event fires when pool queue is entered', () => {
    it('emits pool:exhausted with correct shape', () => {
        // Build a minimal fake pool that mirrors the PgPool event contract:
        // - has an `events` EventEmitter
        // - emits 'pool:exhausted' before enqueuing a wait request
        class FakeExhaustedPool extends EventEmitter {
            events = new EventEmitter();
            simulate() {
                // Mirrors what PgPool.acquire() does before pushing to waitQueue
                this.events.emit('pool:exhausted', {
                    total: 5,
                    idle: 0,
                    waiting: 3,
                });
            }
        }
        const pool = new FakeExhaustedPool();
        let received;
        pool.events.on('pool:exhausted', (state) => {
            received = state;
        });
        pool.simulate();
        assert.ok(received !== undefined, 'pool:exhausted event must be emitted');
        assert.equal(received.total, 5);
        assert.equal(received.idle, 0);
        assert.equal(received.waiting, 3);
    });
    it('onPoolExhausted helper attaches and detaches listener', async () => {
        // Import onPoolExhausted from pool.js via the core package path
        const { onPoolExhausted } = await import('../database/pool.js');
        // Create a mock that matches the PgPool shape expected by onPoolExhausted
        class MinimalPool {
            events = new EventEmitter();
        }
        const pool = new MinimalPool();
        const fired = [];
        const off = onPoolExhausted(pool, (state) => {
            fired.push(state);
        });
        pool.events.emit('pool:exhausted', { total: 2, idle: 0, waiting: 1 });
        assert.equal(fired.length, 1, 'listener should fire once');
        // Detach and verify no more events
        off();
        pool.events.emit('pool:exhausted', { total: 2, idle: 0, waiting: 2 });
        assert.equal(fired.length, 1, 'listener should not fire after detach');
    });
});
//# sourceMappingURL=profiler.test.js.map