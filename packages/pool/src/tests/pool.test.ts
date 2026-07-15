import 'reflect-metadata';
import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { PgConnection } from '@streetjs/postgres';
import { DatabaseConnectionError } from '@streetjs/exceptions';

import { PgPool, onPoolExhausted } from '../index.js';

// ---- A controllable fake PgConnection (no live Postgres) -------------------

interface FakeOpts {
  isClosed?: boolean;
  isReady?: boolean;
  onQuery?: (sql: string, params?: unknown[]) => unknown;
}

function makeFakeConn(opts: FakeOpts = {}): PgConnection {
  const queries: string[] = [];
  const fake = {
    isClosed: opts.isClosed ?? false,
    isReady: opts.isReady ?? true,
    queries,
    async query(sql: string, params?: unknown[]) {
      queries.push(sql);
      const r = opts.onQuery?.(sql, params);
      if (r instanceof Error) throw r;
      return r ?? { rows: [], rowCount: 0, command: sql.split(' ')[0] };
    },
    queryStream(_sql: string) {
      const s = new EventEmitter() as EventEmitter & { once: EventEmitter['once'] };
      // Emit a 'close' asynchronously so the pool releases the connection.
      setImmediate(() => s.emit('close'));
      return s as unknown as ReturnType<PgConnection['queryStream']>;
    },
    async close() {
      (fake as { isClosed: boolean }).isClosed = true;
    },
  };
  return fake as unknown as PgConnection;
}

const BASE_OPTS = {
  host: 'localhost',
  port: 5432,
  user: 'u',
  password: 'p',
  database: 'd',
};

let pools: PgPool[] = [];
function track(p: PgPool): PgPool {
  pools.push(p);
  return p;
}

beforeEach(() => {
  pools = [];
});

afterEach(async () => {
  mock.restoreAll();
  await Promise.all(pools.map((p) => p.close().catch(() => undefined)));
});

test('initialize warms up minConnections and reports size/idle', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 3, maxConnections: 5 }));
  await pool.initialize();
  assert.equal(pool.size, 3);
  assert.equal(pool.idle, 3);
  assert.equal(pool.waiting, 0);
});

test('acquire lazily initializes then hands out a ready connection', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 3 }));
  const conn = await pool.acquire();
  assert.ok(conn);
  assert.equal(pool.idle, 0, 'acquired connection is no longer idle');
  pool.release(conn);
  assert.equal(pool.idle, 1, 'released connection is idle again');
});

test('acquire reuses a released connection rather than creating new ones', async () => {
  const connect = mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 5 }));
  const a = await pool.acquire();
  pool.release(a);
  const b = await pool.acquire();
  assert.equal(a, b, 'same connection reused');
  // One warm-up + at most no extra creation beyond min.
  assert.ok(connect.mock.callCount() <= 2);
});

test('acquire creates new connections up to maxConnections', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 2 }));
  const a = await pool.acquire();
  const b = await pool.acquire();
  assert.notEqual(a, b);
  assert.equal(pool.size, 2);
});

test('acquire beyond max waits, emits pool:exhausted, and is served on release', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 1 }));

  const exhausted: Array<{ total: number; idle: number; waiting: number }> = [];
  const off = onPoolExhausted(pool, (s) => exhausted.push(s));

  const a = await pool.acquire();
  const pending = pool.acquire(); // must wait — pool at max
  // Give the microtask queue a tick so the waiter is enqueued.
  await new Promise((r) => setImmediate(r));
  assert.equal(pool.waiting, 1);
  assert.equal(exhausted.length, 1, 'pool:exhausted emitted once');

  pool.release(a); // should hand the connection to the waiter
  const b = await pending;
  assert.equal(a, b, 'waiter served the released connection');
  off();
  assert.equal(pool.waiting, 0);
});

test('acquire rejects with a timeout when no connection frees up', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(
    new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 1, acquireTimeoutMs: 20 })
  );
  await pool.acquire(); // exhaust
  await assert.rejects(() => pool.acquire(), /Connection acquire timeout/);
});

test('query runs on an acquired connection and releases it', async () => {
  mock.method(PgConnection, 'connect', async () =>
    makeFakeConn({ onQuery: () => ({ rows: [{ n: '1' }], rowCount: 1, command: 'SELECT' }) })
  );
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 2 }));
  const res = await pool.query('SELECT 1');
  assert.equal(res.rowCount, 1);
  assert.equal(pool.idle, pool.size, 'connection released after query');
});

test('transaction commits on success', async () => {
  const seen: string[] = [];
  mock.method(PgConnection, 'connect', async () =>
    makeFakeConn({ onQuery: (sql) => { seen.push(sql); } })
  );
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 2 }));
  const out = await pool.transaction(async (conn) => {
    await conn.query('INSERT INTO t VALUES (1)');
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.deepEqual(seen, ['BEGIN', 'INSERT INTO t VALUES (1)', 'COMMIT']);
});

test('transaction rolls back on error and rethrows', async () => {
  const seen: string[] = [];
  mock.method(PgConnection, 'connect', async () =>
    makeFakeConn({ onQuery: (sql) => { seen.push(sql); } })
  );
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 2 }));
  await assert.rejects(
    () => pool.transaction(async () => { throw new Error('boom'); }),
    /boom/
  );
  assert.deepEqual(seen, ['BEGIN', 'ROLLBACK']);
});

test('stream acquires, streams, and releases on close', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 2 }));
  const stream = await pool.stream('SELECT * FROM big');
  assert.ok(stream);
  // The fake emits 'close' on next tick, releasing the connection.
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(pool.idle, pool.size, 'connection released after stream close');
});

test('a dead connection encountered on acquire is replaced', async () => {
  let calls = 0;
  mock.method(PgConnection, 'connect', async () => {
    calls++;
    // First connection is born "closed" (simulating a died socket).
    return makeFakeConn({ isClosed: calls === 1 });
  });
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 3 }));
  await pool.initialize(); // creates the dead one
  const conn = await pool.acquire(); // should skip dead, create replacement
  assert.equal(conn.isClosed, false);
});

test('releasing a dead connection removes it from the pool', async () => {
  const conns: PgConnection[] = [];
  mock.method(PgConnection, 'connect', async () => {
    const c = makeFakeConn();
    conns.push(c);
    return c;
  });
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 2 }));
  const conn = await pool.acquire();
  (conn as { isClosed: boolean }).isClosed = true;
  pool.release(conn);
  assert.equal(pool.size, 0, 'dead connection removed on release');
});

test('release ignores a connection the pool does not own', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 2 }));
  // Should be a no-op, not throw.
  pool.release(makeFakeConn());
  assert.equal(pool.size, 0);
});

test('close rejects queued waiters and empties the pool', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 1 });
  await pool.acquire(); // exhaust
  const waiter = pool.acquire();
  await new Promise((r) => setImmediate(r));
  await pool.close();
  await assert.rejects(() => waiter, /Connection pool is closed/);
  assert.equal(pool.size, 0);
});

test('acquire after close throws', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 2 });
  await pool.close();
  await assert.rejects(() => pool.acquire(), /Pool is closed/);
});

test('initialize maps ECONNREFUSED to a DatabaseConnectionError', async () => {
  mock.method(PgConnection, 'connect', async () => {
    const err = new Error('connect ECONNREFUSED') as NodeJS.ErrnoException;
    err.code = 'ECONNREFUSED';
    throw err;
  });
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 2 }));
  await assert.rejects(() => pool.initialize(), (err: unknown) => {
    assert.ok(err instanceof DatabaseConnectionError);
    assert.match((err as Error).message, /connection refused/);
    return true;
  });
});

test('initialize rethrows non-ECONNREFUSED errors unchanged', async () => {
  mock.method(PgConnection, 'connect', async () => {
    throw new Error('auth failed');
  });
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 2 }));
  await assert.rejects(() => pool.initialize(), /auth failed/);
});

test('ensureInitialized is idempotent and retryable after failure', async () => {
  let attempt = 0;
  mock.method(PgConnection, 'connect', async () => {
    attempt++;
    if (attempt === 1) throw new Error('temporary');
    return makeFakeConn();
  });
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 2 }));
  await assert.rejects(() => pool.ensureInitialized(), /temporary/);
  // Second call retries and succeeds.
  await pool.ensureInitialized();
  await pool.ensureInitialized(); // no-op, already initialized
  assert.equal(pool.size, 1);
});

test('idle sweep closes connections above minConnections past the idle timeout', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(
    new PgPool({ ...BASE_OPTS, minConnections: 1, maxConnections: 4, idleTimeoutMs: 0 })
  );
  // Build up several idle connections.
  const a = await pool.acquire();
  const b = await pool.acquire();
  const c = await pool.acquire();
  pool.release(a);
  pool.release(b);
  pool.release(c);
  assert.equal(pool.size, 3);
  // Let a few ms elapse so `now - lastUsed` exceeds the (0ms) idle timeout.
  await new Promise((r) => setTimeout(r, 5));
  // Drive the private sweep directly (the timer fires every 15s in production).
  (pool as unknown as { _sweepIdle(): void })._sweepIdle();
  assert.equal(pool.size, 1, 'sweep trims idle connections down to minConnections');
});

test('a waiter is served by a replacement when an in-use connection dies on release', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 1 }));
  const live = await pool.acquire(); // pool at max
  const waiter = pool.acquire(); // queued
  await new Promise((r) => setImmediate(r));
  assert.equal(pool.waiting, 1);
  // The held connection dies, then is released → pool removes it and creates a
  // replacement, which is handed to the waiter.
  (live as { isClosed: boolean }).isClosed = true;
  pool.release(live);
  const served = await waiter;
  assert.ok(served);
  assert.equal(served.isClosed, false, 'waiter got a fresh, live replacement');
});

test('avgAcquireMs is 0 before any acquire and non-negative after', async () => {
  mock.method(PgConnection, 'connect', async () => makeFakeConn());
  const pool = track(new PgPool({ ...BASE_OPTS, minConnections: 0, maxConnections: 2 }));
  assert.equal(pool.avgAcquireMs, 0);
  const c = await pool.acquire();
  pool.release(c);
  assert.ok(pool.avgAcquireMs >= 0);
});
