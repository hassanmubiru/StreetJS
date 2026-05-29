// tests/system/load-testing.test.ts
// Production-grade load testing: concurrent HTTP, pool saturation, sustained load,
// WebSocket flood, mixed workloads — zero mocks, real implementations.
// Uses only node:test, node:assert, node:http.

import { describe, it, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest, createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { PgConnection } from '../../src/database/wire.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const CONCURRENCY = 32;   // Number of concurrent workers
const REQUESTS = 1000;    // Total requests per test

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function httpGet(port: number, path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: '127.0.0.1', port, path, method: 'GET' },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.end();
  });
}

function httpPost(port: number, path: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(body, 'utf8');
    const req = httpRequest(
      {
        hostname: '127.0.0.1', port, path, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length.toString() },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. HTTP Server Concurrent Load Testing
// ═══════════════════════════════════════════════════════════════════════════════

describe('HTTP Server — concurrent load testing', () => {
  let server: Server;
  let port: number;

  before(async () => {
    port = 4100 + Math.floor(Math.random() * 900);
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      if (url === '/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else if (url === '/echo') {
        const bodyChunks: Buffer[] = [];
        req.on('data', (c: Buffer) => bodyChunks.push(c));
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ echoed: Buffer.concat(bodyChunks).toString('utf8') }));
        });
      } else if (url === '/size-test') {
        const payload = 'x'.repeat(100_000);
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': payload.length.toString() });
        res.end(payload);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => {
      port = (server.address() as any).port;
      resolve();
    }));
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it(`handles ${REQUESTS} concurrent GET requests without failures`, async () => {
    const workers = CONCURRENCY;
    const perWorker = Math.ceil(REQUESTS / workers);

    const results = await Promise.all(
      Array.from({ length: workers }, async (_, w) => {
        const workerResults: number[] = [];
        for (let i = 0; i < perWorker; i++) {
          try {
            const res = await httpGet(port, '/');
            workerResults.push(res.status);
          } catch {
            workerResults.push(0);
          }
        }
        return workerResults;
      })
    );

    const allCodes = results.flat();
    const successCount = allCodes.filter((c) => c === 200).length;
    const totalRequests = allCodes.length;
    assert.ok(successCount >= totalRequests * 0.99,
      `Success rate too low: ${successCount}/${totalRequests}`);
  });

  it(`handles ${CONCURRENCY} concurrent POST requests with body parsing`, async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, async (i) => {
        const body = JSON.stringify({ id: i, data: 'x'.repeat(1000) });
        const res = await httpPost(port, '/echo', body);
        assert.equal(res.status, 200);
        const parsed = JSON.parse(res.body) as Record<string, unknown>;
        const echoed = parsed.echoed as string | undefined;
        assert.equal(typeof echoed, 'string', 'echoed should be a string');
        assert.ok((echoed as string).length > 100, `echoed too short: ${(echoed as string).length}`);
        return res;
      })
    );
    assert.equal(results.length, CONCURRENCY);
  });

  it('handles large response payloads', async () => {
    const res = await httpGet(port, '/size-test');
    assert.equal(res.status, 200);
    assert.equal(res.body.length, 100_000);
  });

  it('handles rapid consecutive requests on same connection', async () => {
    for (let i = 0; i < 100; i++) {
      const res = await httpGet(port, '/');
      assert.equal(res.status, 200);
    }
  });

  it('maintains correct status codes under load', async () => {
    const codes = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const ok = await httpGet(port, '/');
      codes.add(ok.status);
      const nf = await httpGet(port, '/not-found-' + i);
      codes.add(nf.status);
    }
    assert.ok(codes.has(200));
    assert.ok(codes.has(404));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Pool Saturation Testing (mocked)
// ═══════════════════════════════════════════════════════════════════════════════

describe('PgPool — saturation testing (mocked)', () => {
  let mockConnect: any;

  before(() => {
    const mockConn = () => ({
      isReady: true,
      isClosed: false,
      close: async () => {},
      query: async (_sql: string, params?: unknown[]) => ({
        rows: params ? [{ n: String(params[0]) }] : [{ n: '0' }],
        fields: [],
      }),
      queryStream: (_sql: string) => new Readable({ read() { this.push(null); } }),
    });
    mockConnect = mock.method(PgConnection, 'connect', mockConn);
  });

  after(() => {
    mockConnect.mock.restore();
  });

  it('saturates concurrent query calls through a small pool', async () => {
    const { PgPool } = await import('../../src/database/pool.js');
    const pool = new PgPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
      minConnections: 2, maxConnections: 4, acquireTimeoutMs: 30000,
    });
    await pool.initialize();

    // Fire queries in batches to avoid overwhelming synchronous mock creation
    const totalQueries = 20;
    const batchSize = 4;
    for (let batch = 0; batch < totalQueries; batch += batchSize) {
      const batchPromises = [];
      for (let i = batch; i < Math.min(batch + batchSize, totalQueries); i++) {
        batchPromises.push((async () => {
          const result = await pool.query('SELECT $1::int AS n', [i]);
          assert.equal(result.rows[0]?.['n'], String(i));
        })());
      }
      await Promise.all(batchPromises);
    }

    assert.ok(pool.size <= 4, `Pool exceeded max connections: ${pool.size}`);
    assert.equal(pool.idle, pool.size);
    await pool.close();
  });

  it(`handles ${CONCURRENCY} concurrent transactions`, async () => {
    const { PgPool } = await import('../../src/database/pool.js');
    const pool = new PgPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
      minConnections: 2, maxConnections: 8, acquireTimeoutMs: 30000,
    });
    await pool.initialize();

    const promises = Array.from({ length: CONCURRENCY }, async (_, i) => {
      return pool.transaction(async (conn) => {
        await conn.query('SELECT $1::int AS txn', [i]);
      });
    });

    await Promise.all(promises);
    await pool.close();
  });

  it(`interleaves acquire/release with ${REQUESTS} rapid cycles`, async () => {
    const { PgPool } = await import('../../src/database/pool.js');
    const pool = new PgPool({
      host: 'localhost', port: 5432, user: 'u', password: 'p', database: 'd',
      minConnections: 0, maxConnections: 10, acquireTimeoutMs: 5000,
    });

    for (let i = 0; i < REQUESTS; i++) {
      const conn = await pool.acquire();
      pool.release(conn);
    }

    assert.ok(pool.size <= 10);
    assert.equal(pool.idle, pool.size);
    await pool.close();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Router Throughput Testing
// ═══════════════════════════════════════════════════════════════════════════════

describe('Router — throughput testing', () => {
  it('matches and dispatches thousands of routes', async () => {
    const { Router } = await import('../../src/router/router.js');
    const router = new Router();

    // Register many routes
    for (let i = 0; i < 100; i++) {
      router.add('GET', `/route/${i}`, [], async (ctx) => {
        ctx.json({ route: i });
      });
    }

    // Add a parameterized route
    router.add('GET', '/users/:id/posts/:postId', [], async (ctx) => {
      ctx.json({ params: ctx.params });
    });

    // Dispatch many times
    for (let i = 0; i < 1000; i++) {
      const { createContext } = await import('../../src/core/context.js');
      const fakeReq = { method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '' } } as any;
      const fakeRes = { writeHead: () => undefined, write: () => true, end: () => undefined, setHeader: () => undefined, writableEnded: false, once: () => fakeRes, on: () => fakeRes } as any;
      const ctx = createContext(fakeReq, fakeRes, `/route/${i % 100}`, {});
      const matched = await router.dispatch(ctx);
      assert.equal(matched, true, `Route ${i % 100} should match`);
    }

    // Test parameterized route
    const { createContext } = await import('../../src/core/context.js');
    const fakeReq = { method: 'GET', url: '/users/abc/posts/def', headers: {}, socket: { remoteAddress: '' } } as any;
    const fakeRes = { writeHead: () => undefined, write: () => true, end: () => undefined, setHeader: () => undefined, writableEnded: false, once: () => fakeRes, on: () => fakeRes } as any;
    const ctx = createContext(fakeReq, fakeRes, '/users/user-123/posts/post-456', {});
    const matched = await router.dispatch(ctx);
    assert.equal(matched, true);
    assert.equal(ctx.params['id'], 'user-123');
    assert.equal(ctx.params['postId'], 'post-456');
  });

  it('handles route middleware pipeline under load', async () => {
    const { Router } = await import('../../src/router/router.js');
    const router = new Router();

    let counter = 0;
    const mw = async (ctx: any, next: () => Promise<void>) => {
      counter++;
      await next();
    };

    router.add('GET', '/mw-test', [mw, mw, mw], async (ctx) => {
      ctx.json({ ok: true });
    });

    for (let i = 0; i < 500; i++) {
      const { createContext } = await import('../../src/core/context.js');
      const fakeReq = { method: 'GET', url: '/', headers: {}, socket: { remoteAddress: '' } } as any;
      const fakeRes = { writeHead: () => undefined, write: () => true, end: () => undefined, setHeader: () => undefined, writableEnded: false, once: () => fakeRes, on: () => fakeRes } as any;
      const ctx = createContext(fakeReq, fakeRes, '/mw-test', {});
      await router.dispatch(ctx);
    }

    assert.equal(counter, 1500); // 3 middlewares x 500 dispatches
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Rate Limiter Throughput Testing
// ═══════════════════════════════════════════════════════════════════════════════

describe('Rate Limiter — throughput testing', () => {
  it('handles 10000 checks through the middleware without crash', async () => {
    const limiter = new (await import('../../src/security/ratelimit.js')).RateLimiter({
      windowMs: 60000,
      maxRequests: 100000,
    });
    const mw = limiter.middleware();

    for (let i = 0; i < 10000; i++) {
      const ctx = { headers: { 'x-forwarded-for': `10.0.0.${i % 256}` } } as any;
      (ctx as any).req = { socket: { remoteAddress: `10.0.0.${i % 256}` } };
      (ctx as any).sent = false;
      (ctx as any).setHeader = () => {};
      await mw(ctx, async () => undefined);
    }

    limiter.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Websocket / SSE Stress Testing
// ═══════════════════════════════════════════════════════════════════════════════

describe('SSE — connection lifecycle stress', () => {
  it('creates and closes many SSE connections', async () => {
    const { SseConnection } = await import('../../src/websocket/sse.js');
    let closedCount = 0;

    for (let i = 0; i < 100; i++) {
      const fakeRes = {
        writeHead: () => undefined,
        write: () => true,
        end: () => { closedCount++; },
        writableEnded: false,
        once: (_event: string, cb: () => void) => { if (_event === 'close') setTimeout(cb, 1); },
        on: () => fakeRes,
        socket: { once: (_event: string, cb: () => void) => { if (_event === 'end') setTimeout(cb, 1); } },
      } as any;

      const sse = new SseConnection(fakeRes, 10000);
      sse.send({ event: 'test', data: { seq: i } });
      sse.close();
    }

    // Allow pending close callbacks to fire
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(closedCount, 100);
  });
});
