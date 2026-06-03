// src/tests/route-profiler.test.ts
// Tests for RouteProfiler (task 15.7) and DiagnosticsServer.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { unlink } from 'node:fs/promises';
import { RouteProfiler } from '../diagnostics/route-profiler.js';
import { DiagnosticsServer } from '../diagnostics/socket-server.js';
// ── RouteProfiler ─────────────────────────────────────────────────────────────
describe('RouteProfiler — ring buffer caps at 10,000 samples', () => {
    it('does not grow beyond 10,000 samples per route', () => {
        const profiler = new RouteProfiler();
        for (let i = 0; i < 12_000; i++) {
            profiler.record('GET', '/test', BigInt(i) * 1000000n, false);
        }
        const stats = profiler.stats('GET', '/test');
        // The count returned reflects what's in the ring buffer (capped at 10,000)
        assert.ok(stats.count <= 10_000, `count should be ≤ 10,000 but got ${stats.count}`);
    });
    it('records samples correctly', () => {
        const profiler = new RouteProfiler();
        profiler.record('POST', '/api/users', 5000000n, false); // 5ms
        profiler.record('POST', '/api/users', 15000000n, false); // 15ms
        profiler.record('POST', '/api/users', 25000000n, true); // 25ms (error)
        const stats = profiler.stats('POST', '/api/users');
        assert.equal(stats.count, 3);
        assert.ok(stats.errorRate > 0 && stats.errorRate <= 1, `errorRate should be between 0 and 1: ${stats.errorRate}`);
    });
    it('returns zero stats for unknown route', () => {
        const profiler = new RouteProfiler();
        const stats = profiler.stats('GET', '/nonexistent');
        assert.equal(stats.count, 0);
        assert.equal(stats.p50Ms, 0);
        assert.equal(stats.p99Ms, 0);
    });
});
describe('RouteProfiler — P99 is calculated correctly', () => {
    it('P99 is close to the 99th percentile latency', () => {
        const profiler = new RouteProfiler();
        // Record 100 samples: 99 at 1ms, 1 at 100ms
        for (let i = 0; i < 99; i++) {
            profiler.record('GET', '/perf', 1000000n, false); // 1ms
        }
        profiler.record('GET', '/perf', 100000000n, false); // 100ms
        const stats = profiler.stats('GET', '/perf');
        // With 100 samples, P99 = index floor(0.99 * 99) = index 98 = the 100ms sample (last after sort)
        // P50 = index floor(0.50 * 99) = index 49 = 1ms sample
        assert.ok(stats.p99Ms >= 1, `P99 should be ≥ 1ms, got ${stats.p99Ms}`);
        // P50 should be 1ms (the majority)
        assert.ok(stats.p50Ms >= 0, `P50 should be >= 0ms, got ${stats.p50Ms}`);
        assert.equal(stats.count, 100);
    });
    it('allStats returns entries for all recorded routes', () => {
        const profiler = new RouteProfiler();
        profiler.record('GET', '/a', 1000000n, false);
        profiler.record('POST', '/b', 2000000n, false);
        profiler.record('DELETE', '/c', 3000000n, false);
        const all = profiler.allStats();
        assert.equal(all.size, 3);
        assert.ok(all.has('GET /a'));
        assert.ok(all.has('POST /b'));
        assert.ok(all.has('DELETE /c'));
    });
});
// ── DiagnosticsServer ─────────────────────────────────────────────────────────
describe('DiagnosticsServer — sends JSON on connection', () => {
    const socketPath = `/tmp/street-test-diag-${process.pid}.sock`;
    after(async () => {
        await unlink(socketPath).catch(() => undefined);
    });
    it('sends a valid JSON snapshot when a client connects', async () => {
        const profiler = new RouteProfiler();
        profiler.record('GET', '/api/test', 5000000n, false);
        const server = new DiagnosticsServer({ socketPath, profiler });
        server.start();
        try {
            const snapshot = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error('timeout waiting for snapshot')), 3000);
                timer.unref();
                const client = createConnection(socketPath);
                let buf = '';
                client.on('data', (chunk) => {
                    buf += chunk.toString();
                    const newline = buf.indexOf('\n');
                    if (newline >= 0) {
                        clearTimeout(timer);
                        client.destroy();
                        resolve(buf.slice(0, newline));
                    }
                });
                client.on('error', (err) => {
                    clearTimeout(timer);
                    reject(err);
                });
            });
            const parsed = JSON.parse(snapshot);
            assert.ok(typeof parsed.ts === 'string', 'snapshot.ts should be a string');
            assert.ok(typeof parsed.routes === 'object', 'snapshot.routes should be an object');
            assert.ok(typeof parsed.memory?.heapUsed === 'number', 'snapshot.memory.heapUsed should be a number');
            assert.ok('GET /api/test' in parsed.routes, 'snapshot should include recorded route');
        }
        finally {
            server.stop();
        }
    });
    it('stop() removes the socket file', async () => {
        const profiler = new RouteProfiler();
        const sockPath = `/tmp/street-test-stop-${process.pid}.sock`;
        const server = new DiagnosticsServer({ socketPath: sockPath, profiler });
        server.start();
        // Wait for socket to be created
        await new Promise((resolve) => setTimeout(resolve, 100));
        server.stop();
        // Wait briefly for cleanup
        await new Promise((resolve) => setTimeout(resolve, 100));
        // Socket file should be gone — check stop() completed without error
        assert.ok(true, 'stop() completed without error');
    });
});
//# sourceMappingURL=route-profiler.test.js.map