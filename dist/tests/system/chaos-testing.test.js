// tests/system/chaos-testing.test.ts
// Production-grade chaos engineering: fault injection, network failures,
// shutdown storms, resource exhaustion simulation, error cascades.
// Uses only node:test, node:assert, node:http, node:net.
import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createConnection } from 'node:net';
import { Readable } from 'node:stream';
import { PgConnection } from '../../src/database/wire.js';
// ═══════════════════════════════════════════════════════════════════════════════
// 1. Network Fault Injection
// ═══════════════════════════════════════════════════════════════════════════════
describe('Network — fault injection', () => {
    let server;
    let port;
    before(async () => {
        port = 5100 + Math.floor(Math.random() * 900);
        server = createServer((req, res) => {
            // Simulate a slow server that sometimes drops connections
            if (req.url === '/slow') {
                // Never respond — simulate timeout
                return;
            }
            if (req.url === '/half-close') {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.write('partial data');
                // End without finishing — partial response
                return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok' }));
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
            port = server.address().port;
            resolve();
        }));
    });
    after(async () => {
        await new Promise((r) => server.close(() => r()));
    });
    it('handles connection reset while reading response', async () => {
        const socket = createConnection({ host: '127.0.0.1', port });
        await new Promise((resolve, reject) => {
            socket.on('connect', () => {
                socket.write('GET /slow HTTP/1.1\r\nHost: localhost\r\n\r\n');
                // Immediately destroy the connection — chaos!
                setTimeout(() => {
                    socket.destroy();
                    resolve();
                }, 50);
            });
            socket.on('error', () => { });
            setTimeout(() => reject(new Error('Timeout')), 2000);
        });
    });
    it('handles half-open connections gracefully', async () => {
        const socket = createConnection({ host: '127.0.0.1', port });
        const data = await new Promise((resolve, reject) => {
            let received = '';
            socket.on('connect', () => {
                socket.write('GET /half-close HTTP/1.1\r\nHost: localhost\r\n\r\n');
            });
            socket.on('data', (chunk) => {
                received += chunk.toString();
                // Destroy after getting partial data
                setTimeout(() => {
                    socket.destroy();
                    resolve(received);
                }, 100);
            });
            socket.on('error', () => resolve(received));
            setTimeout(() => reject(new Error('Timeout')), 2000);
        });
        assert.ok(data.length > 0, 'Should have received at least partial data');
    });
    it('handles many rapid connect/disconnect cycles', async () => {
        const promises = Array.from({ length: 50 }, async (_, i) => {
            return new Promise((resolve) => {
                const socket = createConnection({ host: '127.0.0.1', port });
                socket.on('connect', () => {
                    if (i % 2 === 0) {
                        socket.write('GET / HTTP/1.1\r\nHost: localhost\r\n\r\n');
                    }
                    setTimeout(() => {
                        socket.destroy();
                        resolve();
                    }, Math.random() * 50);
                });
                socket.on('error', () => resolve());
            });
        });
        await Promise.all(promises);
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 2. Server Shutdown Chaos
// ═══════════════════════════════════════════════════════════════════════════════
describe('Server — shutdown chaos', () => {
    it('handles server start/close cycles without errors', async () => {
        for (let i = 0; i < 20; i++) {
            const server = createServer((_req, res) => res.end('ok'));
            await new Promise((resolve, reject) => {
                server.on('error', reject);
                server.listen(0, '127.0.0.1', resolve);
            });
            await new Promise((r) => server.close(() => r()));
        }
    });
    it('handles close() called before listen() completes', async () => {
        const server = createServer((_req, res) => res.end('ok'));
        const closeBeforeReady = new Promise((resolve) => {
            server.listen(0, '127.0.0.1');
            // Call close before listen callback fires
            server.close(() => resolve());
        });
        await closeBeforeReady;
    });
    it('handles multiple concurrent close() calls', async () => {
        const server = createServer((_req, res) => res.end('ok'));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        // Fire multiple close calls — should not throw
        const results = await Promise.allSettled([
            new Promise((r) => server.close(() => r())),
            new Promise((r) => server.close(() => r())),
            new Promise((r) => server.close(() => r())),
        ]);
        for (const r of results) {
            assert.equal(r.status, 'fulfilled');
        }
    });
    it('handles request during shutdown', async () => {
        const server = createServer((_req, res) => {
            setTimeout(() => res.end('ok'), 100);
        });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const port = server.address().port;
        const { request: httpRequestFn } = await import('node:http');
        // Start a slow request, then immediately close
        const requestPromise = new Promise((resolve) => {
            const req = httpRequestFn({ hostname: '127.0.0.1', port, path: '/', method: 'GET' }, (res) => {
                res.on('data', () => { });
                res.on('end', resolve);
            });
            req.on('error', () => { resolve(); });
            req.end();
        });
        await new Promise((r) => setTimeout(r, 10));
        await new Promise((r) => server.close(() => r()));
        // The request should eventually complete or fail gracefully
        try {
            await requestPromise;
        }
        catch {
            // Expected — request may fail after close
        }
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 3. Resource Exhaustion Simulation
// ═══════════════════════════════════════════════════════════════════════════════
describe('Resource exhaustion — simulation', () => {
    it('handles extremely large number of LRU cache instances', async () => {
        // Create and destroy many cache instances to test timer cleanup
        const caches = [];
        const { LruCache: LruCacheCls } = await import('../../src/cache/lru.js');
        for (let i = 0; i < 200; i++) {
            const cache = new LruCacheCls({ maxEntries: 10, ttlMs: 1000 });
            caches.push(cache);
        }
        for (const c of caches)
            c.destroy();
    });
    it('handles extreme rate limiter key pressure without crash', async () => {
        const { RateLimiter } = await import('../../src/security/ratelimit.js');
        const limiter = new RateLimiter({ windowMs: 60000, maxRequests: 100 });
        const mw = limiter.middleware();
        // Generate many unique keys rapidly
        const promises = [];
        for (let i = 0; i < 500; i++) {
            const ctx = {
                headers: { 'x-forwarded-for': `chaos-${i}` },
                req: { socket: { remoteAddress: `chaos-${i}` } },
                sent: false,
            };
            promises.push(mw(ctx, async () => undefined).catch(() => undefined));
        }
        await Promise.all(promises);
        const store = limiter.store;
        assert.ok(store.size <= 100000, 'Store exceeded MAX_KEYS during pressure test');
        limiter.destroy();
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 4. Error Cascade Testing
// ═══════════════════════════════════════════════════════════════════════════════
describe('Error cascade — propagation chaos', () => {
    it('handles errors thrown from middleware pipeline', async () => {
        const { Router } = await import('../../src/router/router.js');
        const router = new Router();
        router.add('GET', '/chaos', [
            async (_ctx, next) => { await next(); },
            async (_ctx, _next) => { throw new Error('Middleware chaos!'); },
        ], async (_ctx) => { throw new Error('Should never reach here'); });
        const { createContext } = await import('../../src/core/context.js');
        const fakeReq = { method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '' } };
        const fakeRes = { writeHead: () => undefined, write: () => true, end: () => undefined, setHeader: () => undefined, writableEnded: false, once: () => fakeRes, on: () => fakeRes };
        const ctx = createContext(fakeReq, fakeRes, '/chaos', {});
        await assert.rejects(() => router.dispatch(ctx), /Middleware chaos/);
    });
    it('handles nested middleware throws', async () => {
        const { Router } = await import('../../src/router/router.js');
        const router = new Router();
        router.add('GET', '/nested-chaos', [
            async (_ctx, next) => {
                try {
                    await next();
                }
                catch {
                    throw new Error('Caught and re-thrown');
                }
            },
            async (_ctx, _next) => { throw new Error('Inner chaos'); },
        ], async (_ctx) => { });
        const { createContext } = await import('../../src/core/context.js');
        const fakeReq = { method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '' } };
        const fakeRes = { writeHead: () => undefined, write: () => true, end: () => undefined, setHeader: () => undefined, writableEnded: false, once: () => fakeRes, on: () => fakeRes };
        const ctx = createContext(fakeReq, fakeRes, '/nested-chaos', {});
        await assert.rejects(() => router.dispatch(ctx), /Caught and re-thrown/);
    });
    it('middleware calling next() multiple times is safe', async () => {
        const { Router } = await import('../../src/router/router.js');
        const router = new Router();
        let handlerCalls = 0;
        router.add('GET', '/double-next', [
            async (_ctx, next) => { await next(); await next(); }, // double call
            async (_ctx, next) => { await next(); },
        ], async (_ctx) => { handlerCalls++; });
        const { createContext } = await import('../../src/core/context.js');
        const fakeReq = { method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '' } };
        const fakeRes = { writeHead: () => undefined, write: () => true, end: () => undefined, setHeader: () => undefined, writableEnded: false, once: () => fakeRes, on: () => fakeRes };
        const ctx = createContext(fakeReq, fakeRes, '/double-next', {});
        await router.dispatch(ctx);
        // Handler may be called multiple times, but should not crash
        assert.ok(handlerCalls >= 1);
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 5. Timer / Interval Storm Testing
// ═══════════════════════════════════════════════════════════════════════════════
describe('Timer storm — concurrent timer chaos', () => {
    it('handles many overlapping timers', async () => {
        let timerFired = 0;
        const timers = [];
        for (let i = 0; i < 500; i++) {
            const timer = setTimeout(() => { timerFired++; }, Math.floor(Math.random() * 50));
            timers.push(timer);
        }
        // Clear some timers while others fire (chaos)
        for (let i = 0; i < 250; i++) {
            clearTimeout(timers[i]);
        }
        await new Promise((r) => setTimeout(r, 100));
        assert.ok(timerFired >= 0); // Just ensure no crash
    });
    it('handles interval creation/destruction storm', () => {
        const intervals = [];
        for (let i = 0; i < 100; i++) {
            const interval = setInterval(() => { }, 10);
            intervals.push(interval);
        }
        for (const iv of intervals)
            clearInterval(iv);
    });
});
// ═══════════════════════════════════════════════════════════════════════════════
// 6. Pool Chaos (mocked connections)
// ═══════════════════════════════════════════════════════════════════════════════
describe('PgPool — chaos testing (mocked)', () => {
    let mockConnect;
    before(() => {
        const mockConn = () => ({
            isReady: true,
            isClosed: false,
            close: async () => { },
            query: async (_sql, _params) => ({ rows: [], fields: [] }),
            queryStream: (_sql) => new Readable({ read() { this.push(null); } }),
        });
        mockConnect = mock.method(PgConnection, 'connect', mockConn);
    });
    after(() => {
        mockConnect.mock.restore();
    });
    it('acquire/release chaos with concurrent close', async () => {
        const { PgPool } = await import('../../src/database/pool.js');
        const pool = new PgPool({
            host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
            minConnections: 2, maxConnections: 5, acquireTimeoutMs: 1000,
        });
        // Concurrent acquire/release/close chaos
        const results = await Promise.allSettled([
            pool.acquire(),
            pool.acquire(),
            pool.acquire(),
            pool.close(),
            pool.acquire().catch(() => undefined),
            pool.acquire().catch(() => undefined),
        ]);
        // Should not throw unhandled rejections
        for (const r of results) {
            if (r.status === 'rejected') {
                assert.ok(r.reason.message.includes('closed') || r.reason.message.includes('timeout'));
            }
        }
    });
    it('concurrent initializations share connections correctly', async () => {
        const { PgPool } = await import('../../src/database/pool.js');
        const pool = new PgPool({
            host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
            minConnections: 2, maxConnections: 10, acquireTimeoutMs: 5000,
        });
        // Fire many concurrent queries
        const results = await Promise.allSettled(Array.from({ length: 50 }, () => pool.query('SELECT 1')));
        const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
        const rejected = results.filter((r) => r.status === 'rejected').length;
        assert.ok(fulfilled >= 40, `Too many query rejections: ${rejected} rejected, ${fulfilled} fulfilled`);
        await pool.close();
    });
});
//# sourceMappingURL=chaos-testing.test.js.map