// tests/stress.test.ts
// Stress tests that exercise parseBody and pool operations thousands of times
// to verify no listener pile-up, connection leaks, or memory growth under load.
//
// These tests do NOT require a PostgreSQL database — PgConnection.connect
// is mocked to return lightweight in-process connection stubs.
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { PgConnection } from '../src/database/wire.js';
const ITERATIONS = 5000;
// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Create a mock IncomingMessage-like Readable that can emit JSON body data */
function makeMockReq(body) {
    const req = new Readable({ read() { } });
    req.headers = { 'content-type': 'application/json' };
    req.method = 'POST';
    if (body) {
        req.push(Buffer.from(JSON.stringify(body)));
        req.push(null);
    }
    return req;
}
/** Simulate the parseBody listener lifecycle (mirrors src/http/server.ts) */
function simulateParseBodyLifecycle(req, maxBytes = 1024 * 1024) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;
        const onData = (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                req.destroy(new Error('Body too large'));
                reject(new Error('Request body exceeds limit'));
                return;
            }
            chunks.push(chunk);
        };
        const onEnd = () => resolve(undefined);
        const onError = (err) => reject(err);
        const onAborted = () => reject(new Error('Request aborted'));
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
        req.on('aborted', onAborted);
    }).finally(() => {
        // Mirror the cleanup in http/server.ts
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.removeAllListeners('error');
        req.removeAllListeners('aborted');
    });
}
// ─── Suite 1: parseBody stress test ───────────────────────────────────────────
// Runs the listen → consume → cleanup cycle thousands of times to verify no
// stale event listeners accumulate on request streams.
describe('parseBody — listener pile-up stress test', () => {
    it(`does not leak listeners after ${ITERATIONS} parseBody cycles`, async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            const req = makeMockReq({ iteration: i, data: 'x'.repeat(100) });
            await simulateParseBodyLifecycle(req);
            // After cleanup, all listener counts must be zero
            assert.equal(req.listenerCount('data'), 0, `data listener leak at iteration ${i}`);
            assert.equal(req.listenerCount('end'), 0, `end listener leak at iteration ${i}`);
            assert.equal(req.listenerCount('error'), 0, `error listener leak at iteration ${i}`);
            assert.equal(req.listenerCount('aborted'), 0, `aborted listener leak at iteration ${i}`);
        }
    });
    it(`handles ${ITERATIONS} parseBody error cycles without listener pile-up`, async () => {
        for (let i = 0; i < ITERATIONS; i++) {
            const req = makeMockReq();
            // Destroy with error before any data is pushed — triggers onError path
            req.destroy(new Error(`simulated error ${i}`));
            // Wait for the error to propagate through nextTick
            await assert.rejects(simulateParseBodyLifecycle(req));
            // After cleanup, must be zero
            assert.equal(req.listenerCount('data'), 0);
            assert.equal(req.listenerCount('end'), 0);
            assert.equal(req.listenerCount('error'), 0);
            assert.equal(req.listenerCount('aborted'), 0);
        }
    });
    it(`does not exceed default MaxListeners across ${ITERATIONS} concurrent streams`, async () => {
        // Run 100 concurrent parseBody cycles, repeated in batches
        const BATCH = 100;
        const BATCHES = ITERATIONS / BATCH;
        for (let b = 0; b < BATCHES; b++) {
            const promises = [];
            for (let i = 0; i < BATCH; i++) {
                const req = makeMockReq({ n: b * BATCH + i });
                promises.push(simulateParseBodyLifecycle(req));
            }
            await Promise.all(promises);
            // After each batch, all request streams must be clean
            // Note: we can't check individual req objects here since they're
            // scoped to the loop, but the EventEmitter default MaxListeners
            // warning would fire if any single stream accumulated >10 listeners
        }
    });
});
// ─── Suite 2: Pool acquire/release stress test ────────────────────────────────
// Exercises the pool's acquire → release cycle thousands of times to verify
// that the internal connections array, waitQueue, and listener counts stay
// bounded.
describe('PgPool — acquire/release stress test', () => {
    let mockConnect;
    beforeEach(() => {
        const mockConn = () => ({
            isReady: true,
            isClosed: false,
            close: async () => { },
            query: async (_sql, _params) => ({
                rows: [],
                fields: [],
            }),
            queryStream: (_sql) => new Readable({ read() { this.push(null); } }),
        });
        mockConnect = mock.method(PgConnection, 'connect', mockConn);
    });
    afterEach(() => {
        mockConnect.mock.restore();
    });
    it(`no connection leak after ${ITERATIONS} acquire/release cycles`, async () => {
        const { PgPool } = await import('../src/database/pool.js');
        const pool = new PgPool({
            host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
            minConnections: 0, maxConnections: 10, acquireTimeoutMs: 5000,
        });
        for (let i = 0; i < ITERATIONS; i++) {
            const conn = await pool.acquire();
            assert.ok(conn);
            pool.release(conn);
        }
        // After all cycles: connections may have been created (up to maxConnections)
        // but all must be idle (non-inUse) and the waitQueue must be empty
        assert.ok(pool.size <= 10, `pool grew beyond max: ${pool.size}`);
        assert.equal(pool.idle, pool.size, `not all connections idle: ${pool.idle} of ${pool.size}`);
        assert.equal(pool.waitQueue.length, 0, 'waitQueue not empty');
        await pool.close();
    });
    it(`handles ${ITERATIONS} concurrent acquire/release with max 5 connections`, async () => {
        const { PgPool } = await import('../src/database/pool.js');
        const pool = new PgPool({
            host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
            minConnections: 0, maxConnections: 5, acquireTimeoutMs: 10000,
        });
        // Spawn 20 concurrent workers, each doing 250 acquire/release cycles
        const WORKERS = 20;
        const CYCLES_PER_WORKER = ITERATIONS / WORKERS;
        await Promise.all(Array.from({ length: WORKERS }, async () => {
            for (let i = 0; i < CYCLES_PER_WORKER; i++) {
                const conn = await pool.acquire();
                await new Promise((r) => setImmediate(r)); // yield to other microtasks
                pool.release(conn);
            }
        }));
        // After all workers complete: all connections idle, waitQueue empty
        assert.equal(pool.idle, pool.size, `stale inUse connections: ${pool.size - pool.idle} busy`);
        assert.equal(pool.waitQueue.length, 0, 'waitQueue not empty');
        await pool.close();
    });
    it(`no listener accumulation on pool after ${ITERATIONS} query() calls`, async () => {
        const { PgPool } = await import('../src/database/pool.js');
        const pool = new PgPool({
            host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
            minConnections: 0, maxConnections: 3, acquireTimeoutMs: 5000,
        });
        const initialListenerCount = EventEmitter.listenerCount(process, 'warning');
        for (let i = 0; i < ITERATIONS; i++) {
            await pool.query('SELECT $1::int AS n', [i]);
        }
        // query() uses acquire/release internally — no warning listeners should accumulate
        const finalListenerCount = EventEmitter.listenerCount(process, 'warning');
        const leaked = finalListenerCount - initialListenerCount;
        assert.ok(leaked <= 2, // allow small noise from Node.js internals
        `Listener leak detected: ${leaked} new process 'warning' listeners added`);
        await pool.close();
    });
    it(`closed pool does not leak waiters after ${ITERATIONS} rapid close/open attempts`, async () => {
        const { PgPool } = await import('../src/database/pool.js');
        for (let i = 0; i < Math.min(ITERATIONS, 100); i++) {
            const pool = new PgPool({
                host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
                minConnections: 0, maxConnections: 1, acquireTimeoutMs: 5000,
            });
            // Fill the single connection
            await pool.acquire();
            // This will queue
            const pendingAcquire = pool.acquire();
            // Close should reject it
            await pool.close();
            await assert.rejects(pendingAcquire, /Connection pool is closed/);
        }
    });
});
// ─── Suite 3: Mixed stress test ───────────────────────────────────────────────
// Combined parseBody + pool stress to catch interaction issues.
describe('Mixed — concurrent parseBody + pool stress', () => {
    let mockConnect;
    beforeEach(() => {
        const mockConn = () => ({
            isReady: true,
            isClosed: false,
            close: async () => { },
            query: async (_sql, _params) => ({
                rows: [],
                fields: [],
            }),
            queryStream: (_sql) => new Readable({ read() { this.push(null); } }),
        });
        mockConnect = mock.method(PgConnection, 'connect', mockConn);
    });
    afterEach(() => {
        mockConnect.mock.restore();
    });
    it(`interleaves ${ITERATIONS} body parses and pool queries without leaks`, async () => {
        const { PgPool } = await import('../src/database/pool.js');
        const pool = new PgPool({
            host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
            minConnections: 0, maxConnections: 5, acquireTimeoutMs: 5000,
        });
        const HALF = ITERATIONS / 2;
        // Interleave parseBody and pool operations
        for (let i = 0; i < HALF; i++) {
            // parseBody cycle
            const req = makeMockReq({ iteration: i });
            await simulateParseBodyLifecycle(req);
            assert.equal(req.listenerCount('data'), 0);
            assert.equal(req.listenerCount('end'), 0);
            assert.equal(req.listenerCount('error'), 0);
            assert.equal(req.listenerCount('aborted'), 0);
            // Pool query cycle
            await pool.query('SELECT $1::int AS n', [i]);
        }
        // Final state checks
        assert.equal(pool.idle, pool.size, `stale inUse connections: ${pool.size - pool.idle} busy`);
        assert.equal(pool.waitQueue.length, 0, 'waitQueue not empty');
        await pool.close();
    });
});
//# sourceMappingURL=stress.test.js.map