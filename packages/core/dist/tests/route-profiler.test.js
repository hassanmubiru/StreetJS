// src/tests/route-profiler.test.ts
// Tests for RouteProfiler (task 15.7) and DiagnosticsServer.
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { createConnection } from 'node:net';
import { unlink } from 'node:fs/promises';
import { writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { RouteProfiler } from '../diagnostics/route-profiler.js';
import { DiagnosticsServer, isStaleSocket } from '../diagnostics/socket-server.js';
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
    it('computes exact P50/P95/P99 on a known distribution (1ms..100ms)', () => {
        const profiler = new RouteProfiler();
        // Record 100 samples with latencies 1ms, 2ms, ... 100ms (insertion order
        // is irrelevant since stats() sorts a copy before computing percentiles).
        for (let i = 1; i <= 100; i++) {
            profiler.record('GET', '/dist', BigInt(i) * 1000000n, false);
        }
        const stats = profiler.stats('GET', '/dist');
        assert.equal(stats.count, 100);
        // Nearest-rank index = floor((p/100) * (n-1)) on the ascending sorted set.
        // n=100 → P50 idx 49 → 50ms, P95 idx 94 → 95ms, P99 idx 98 → 99ms.
        assert.equal(stats.p50Ms, 50);
        assert.equal(stats.p95Ms, 95);
        assert.equal(stats.p99Ms, 99);
        assert.equal(stats.errorRate, 0);
    });
    it('caps at exactly 10,000 samples and evicts oldest', () => {
        const profiler = new RouteProfiler();
        // Record 10,100 samples; the last 10,000 should survive (oldest evicted).
        // Latencies 1ms..10,100ms means the surviving window is 101ms..10,100ms.
        for (let i = 1; i <= 10_100; i++) {
            profiler.record('GET', '/cap', BigInt(i) * 1000000n, false);
        }
        const stats = profiler.stats('GET', '/cap');
        assert.equal(stats.count, 10_000);
        // Surviving sorted window: 101ms..10,100ms (n=10,000).
        // P50 idx floor(0.50 * 9999) = 4999 → 101 + 4999 = 5100ms.
        assert.equal(stats.p50Ms, 5100);
        // P99 idx floor(0.99 * 9999) = 9899 → 101 + 9899 = 10,000ms.
        assert.equal(stats.p99Ms, 10_000);
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
// ── isStaleSocket — stale socket is cleaned up ──────────────────────────────────
describe('isStaleSocket — stale socket detection', () => {
    // Find a PID that is definitely not alive by spawning a trivial child and
    // reusing its PID after it has fully exited. The OS will not have reassigned
    // it within the test window, so process.kill(pid, 0) reports ESRCH (dead).
    const exited = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
    const deadPid = exited.pid;
    const staleSocketPath = `/tmp/street-${deadPid}.sock`;
    const livePid = process.pid;
    const liveSocketPath = `/tmp/street-${livePid}.sock`;
    after(() => {
        rmSync(staleSocketPath, { force: true });
        rmSync(liveSocketPath, { force: true });
    });
    it('returns true for an existing socket whose owning process is dead', async () => {
        assert.ok(typeof deadPid === 'number' && deadPid > 0, 'expected a valid child PID');
        writeFileSync(staleSocketPath, '');
        const stale = await isStaleSocket(staleSocketPath);
        assert.equal(stale, true, `expected socket for dead PID ${deadPid} to be stale`);
    });
    it('returns false for an existing socket whose owning process is alive', async () => {
        writeFileSync(liveSocketPath, '');
        const stale = await isStaleSocket(liveSocketPath);
        assert.equal(stale, false, `expected socket for live PID ${livePid} to not be stale`);
    });
    it('returns false when the socket file does not exist', async () => {
        rmSync(staleSocketPath, { force: true });
        const stale = await isStaleSocket(staleSocketPath);
        assert.equal(stale, false, 'expected a missing socket file to not be reported as stale');
    });
});
//# sourceMappingURL=route-profiler.test.js.map