// src/tests/redis-store.integration.test.ts
// Integration test for RedisEventStore against a REAL Redis broker, with an
// honest BLOCKED-when-unavailable outcome. When no broker is reachable (the
// common case here) every test is SKIPPED with an explicit unreachable message
// rather than failing or fabricating a pass. It never hangs (bounded probe).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RedisClient } from 'streetjs';
import { RedisEventStore } from '../store/redis.js';
import { createEvents } from '../facade.js';
import { buildEnvelope } from '../event.js';

interface AppEvents {
  'user.created': { id: string };
  'order.shipped': { id: string };
}

function resolveConfig(): { host: string; port: number; password?: string; url: string } {
  const url = process.env['REDIS_URL'] ?? 'redis://127.0.0.1:6379';
  try {
    const u = new URL(url);
    return {
      url,
      host: u.hostname || '127.0.0.1',
      port: u.port ? Number(u.port) : 6379,
      password: u.password ? decodeURIComponent(u.password) : undefined,
    };
  } catch {
    return { url, host: '127.0.0.1', port: 6379 };
  }
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
const RUN_TOKEN = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function makeClient(): RedisClient {
  return new RedisClient({ host: CONFIG.host, port: CONFIG.port, password: CONFIG.password });
}

async function probe(): Promise<{ available: boolean; reason: string }> {
  const client = makeClient();
  try {
    await withTimeout(client.connect(), 1500, `connect to ${CONFIG.host}:${CONFIG.port} timed out`);
    const pong = await withTimeout(client.command(['PING']), 1500, 'PING timed out');
    if (typeof pong === 'string' && pong.startsWith('ERR:')) {
      return { available: false, reason: `PING rejected: ${pong.slice(4)}` };
    }
    return { available: true, reason: 'connected' };
  } catch (err) {
    return { available: false, reason: err instanceof Error ? err.message : String(err) };
  } finally {
    try {
      client.close();
    } catch {
      /* best-effort */
    }
  }
}

const AVAIL = await probe();
const RUN: { skip?: string } = AVAIL.available
  ? {}
  : {
      skip: `Redis unavailable: ${AVAIL.reason} (BLOCKED: unreachable dependency; set REDIS_URL or start a broker to run)`,
    };

if (!AVAIL.available) {
  // eslint-disable-next-line no-console
  console.log(
    `[events][redis-store.integration] BLOCKED — real Redis unreachable at ${CONFIG.url}: ${AVAIL.reason}. Tests skipped (not failed).`,
  );
}

let n = 0;
function freshStore(): { store: RedisEventStore } {
  const store = new RedisEventStore({
    client: makeClient(),
    keyPrefix: `test:events:${RUN_TOKEN}:${n++}`,
  });
  return { store };
}

test('append + read + count + clear against a real broker', RUN, async () => {
  const { store } = freshStore();
  try {
    await store.append(buildEnvelope('user.created', { id: 'u1' }, 100, 0));
    await store.append(buildEnvelope('order.shipped', { id: 'o1' }, 200, 1));
    const all = await store.read();
    assert.equal(all.length, 2);
    assert.deepEqual(all.map((e) => e.name), ['user.created', 'order.shipped']);
    assert.equal(await store.count({ pattern: 'user.*' }), 1);
    await store.clear();
    assert.equal(await store.count(), 0);
  } finally {
    await store.close();
  }
});

test('facade persistence + replay against a real broker', RUN, async () => {
  const { store } = freshStore();
  const events = createEvents<AppEvents>({ store });
  try {
    await events.publish('user.created', { id: 'u1' });
    await events.publish('order.shipped', { id: 'o1' });

    const replayed: string[] = [];
    events.on('**', (_p, ctx) => replayed.push(ctx.event));
    const count = await events.replay();
    assert.equal(count, 2);
    assert.deepEqual(replayed, ['user.created', 'order.shipped']);
  } finally {
    await store.clear();
    await events.close();
    await store.close();
  }
});
