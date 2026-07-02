// src/tests/postgres-store.integration.test.ts
// Integration test for PostgresEventStore against a REAL PostgreSQL database,
// with an honest BLOCKED-when-unavailable outcome. When no database is reachable
// (the common case here) every test is SKIPPED with an explicit unreachable
// message rather than failing or fabricating a pass. The probe is bounded so it
// never hangs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PgPool } from 'streetjs';
import { PostgresEventStore } from '../store/postgres.js';
import { createEvents } from '../facade.js';

interface AppEvents {
  'user.created': { id: string };
  'order.shipped': { id: string };
}

interface PgConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  url: string;
}

function resolveConfig(): PgConfig {
  const url = process.env['DATABASE_URL'] ?? process.env['PG_URL'] ?? '';
  if (url) {
    try {
      const u = new URL(url);
      return {
        url,
        host: u.hostname || '127.0.0.1',
        port: u.port ? Number(u.port) : 5432,
        user: decodeURIComponent(u.username || 'postgres'),
        password: decodeURIComponent(u.password || ''),
        database: (u.pathname || '/postgres').slice(1) || 'postgres',
      };
    } catch {
      /* fall through to env vars */
    }
  }
  const host = process.env['PGHOST'] ?? '127.0.0.1';
  const port = Number(process.env['PGPORT'] ?? '5432');
  return {
    url: `postgres://${host}:${port}`,
    host,
    port,
    user: process.env['PGUSER'] ?? 'postgres',
    password: process.env['PGPASSWORD'] ?? '',
    database: process.env['PGDATABASE'] ?? 'postgres',
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(label)), ms);
    (t as unknown as { unref?: () => void }).unref?.();
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

const CONFIG = resolveConfig();
const RUN_TOKEN = Math.random().toString(36).slice(2, 8);
const TABLE = `street_events_test_${RUN_TOKEN}`;

function makePool(): PgPool {
  return new PgPool({
    host: CONFIG.host,
    port: CONFIG.port,
    user: CONFIG.user,
    password: CONFIG.password,
    database: CONFIG.database,
    minConnections: 1,
    maxConnections: 2,
    connectTimeoutMs: 1500,
    acquireTimeoutMs: 2000,
  });
}

async function probe(): Promise<{ available: boolean; reason: string }> {
  const pool = makePool();
  try {
    await withTimeout(pool.initialize(), 2000, `connect to ${CONFIG.host}:${CONFIG.port} timed out`);
    await withTimeout(pool.query('SELECT 1'), 2000, 'SELECT 1 timed out');
    return { available: true, reason: 'connected' };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      await pool.close();
    } catch {
      /* best-effort */
    }
  }
}

const AVAIL = await probe();
const RUN: { skip?: string } = AVAIL.available
  ? {}
  : {
      skip: `PostgreSQL unavailable: ${AVAIL.reason} (BLOCKED: unreachable dependency; set DATABASE_URL or PG* env to run)`,
    };

if (!AVAIL.available) {
  // eslint-disable-next-line no-console
  console.log(
    `[events][postgres-store.integration] BLOCKED — real PostgreSQL unreachable at ${CONFIG.url}: ${AVAIL.reason}. Tests skipped (not failed).`,
  );
}

test('facade persistence + ordered replay against a real PostgreSQL database', RUN, async () => {
  const pool = makePool();
  await pool.initialize();
  const store = new PostgresEventStore({ pool, table: TABLE });
  const events = createEvents<AppEvents>({ store });
  try {
    await store.init();
    await store.clear(); // isolate from any prior run on this table

    await events.publish('user.created', { id: 'u1' });
    await events.publish('order.shipped', { id: 'o1' });
    await events.publish('user.created', { id: 'u2' });

    assert.equal(await store.count(), 3);
    assert.equal(await store.count({ pattern: 'user.*' }), 2);

    const replayed: string[] = [];
    events.on('**', (_p, ctx) => {
      replayed.push(ctx.event);
    });
    const count = await events.replay();
    assert.equal(count, 3);
    assert.deepEqual(replayed, ['user.created', 'order.shipped', 'user.created']);
    assert.equal(store.health().status, 'up');
  } finally {
    try {
      await pool.query(`DROP TABLE IF EXISTS ${TABLE}`);
    } catch {
      /* best-effort cleanup */
    }
    await events.close();
    await pool.close();
  }
});
