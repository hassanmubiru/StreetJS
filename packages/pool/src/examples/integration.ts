/**
 * @streetjs/pool — runnable integration example.
 *
 * Demonstrates the pool's lifecycle — warm-up, acquire/release, query,
 * transaction, backpressure, and shutdown — without a live PostgreSQL server by
 * substituting an in-memory fake for `PgConnection.connect`. In a real app you
 * omit this substitution and point the pool at your database.
 *
 * Run with: `npm run example -w packages/pool`
 */

import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { PgConnection } from '@streetjs/postgres';
import { PgPool, onPoolExhausted } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

// --- In-memory fake connection (demo only; not part of the public API) ------
function makeFakeConn(): PgConnection {
  const fake = {
    isClosed: false,
    isReady: true,
    async query(sql: string) {
      return { rows: [{ sql }], rowCount: 1, command: sql.split(' ')[0] };
    },
    queryStream() {
      const s = new EventEmitter();
      setImmediate(() => s.emit('close'));
      return s as unknown as ReturnType<PgConnection['queryStream']>;
    },
    async close() {
      (fake as { isClosed: boolean }).isClosed = true;
    },
  };
  return fake as unknown as PgConnection;
}
(PgConnection as unknown as { connect: () => Promise<PgConnection> }).connect = async () =>
  makeFakeConn();

// --- 1. Warm-up -------------------------------------------------------------
const pool = new PgPool({
  host: 'localhost',
  port: 5432,
  user: 'demo',
  password: 'demo',
  database: 'demo',
  minConnections: 2,
  maxConnections: 3,
  acquireTimeoutMs: 50,
});
await pool.initialize();
assert(pool.size === 2, 'warmed up to minConnections');
console.log(`warmed up: size=${pool.size} idle=${pool.idle}`);

// --- 2. Query (auto acquire/release) ---------------------------------------
const res = await pool.query('SELECT now()');
assert(res.rowCount === 1, 'query returned a row');
assert(pool.idle === pool.size, 'connection released after query');
console.log('query ok ->', JSON.stringify(res.rows[0]));

// --- 3. Transaction --------------------------------------------------------
const txOut = await pool.transaction(async (conn) => {
  await conn.query('INSERT INTO demo VALUES (1)');
  return 'committed';
});
assert(txOut === 'committed', 'transaction committed');
console.log('transaction ->', txOut);

// --- 4. Backpressure: exhaust the pool and observe pool:exhausted ----------
let exhaustedFired = false;
const off = onPoolExhausted(pool, () => {
  exhaustedFired = true;
});
const held = [await pool.acquire(), await pool.acquire(), await pool.acquire()];
const waiter = pool.acquire(); // must wait — at max
await new Promise((r) => setImmediate(r));
assert(pool.waiting === 1, 'one caller waiting');
assert(exhaustedFired, 'pool:exhausted fired');
console.log(`backpressure: waiting=${pool.waiting}, exhausted event fired`);

// Release one → the waiter is served.
pool.release(held[0]);
const served = await waiter;
assert(served != null, 'waiter served after release');
off();
held.slice(1).forEach((c) => pool.release(c));

// --- 5. Shutdown -----------------------------------------------------------
await pool.close();
assert(pool.size === 0, 'pool drained on close');
console.log('closed: size=0');

console.log('\nAll @streetjs/pool example assertions passed.');
