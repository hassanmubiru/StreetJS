// src/tests/redis-store.test.ts
// Unit + property tests for RedisEventStore, driven by an in-memory simulated
// Redis (no real broker). Also verifies facade persistence + replay over the
// Redis-backed store and behavioral parity with MemoryEventStore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { RedisEventStore } from '../store/redis.js';
import { MemoryEventStore } from '../store/memory.js';
import { buildEnvelope } from '../event.js';
import { createEvents } from '../facade.js';
import { SimRedis } from './sim-redis.js';

interface AppEvents {
  'user.created': { id: string };
  'user.updated': { id: string };
  'order.shipped': { id: string };
}

function env(name: string, seq: number, timestamp = seq) {
  return buildEnvelope(name, { seq }, timestamp, seq);
}

function newStore(): RedisEventStore {
  return new RedisEventStore({ client: new SimRedis(), keyPrefix: 'test:events' });
}

// ── Unit ────────────────────────────────────────────────────────────────────

test('append then read returns events ordered by seq; health is up after use', async () => {
  const store = newStore();
  await store.append(env('user.created', 2));
  await store.append(env('user.created', 0));
  await store.append(env('user.created', 1));

  const all = await store.read();
  assert.deepEqual(all.map((e) => e.seq), [0, 1, 2]);
  assert.equal(await store.count(), 3);
  assert.equal(store.health().status, 'up');
  await store.close();
});

test('read honors name/pattern/seq/time filters and limit', async () => {
  const store = newStore();
  await store.append(env('user.created', 0, 100));
  await store.append(env('user.updated', 1, 200));
  await store.append(env('order.shipped', 2, 300));

  assert.deepEqual((await store.read({ name: 'user.created' })).map((e) => e.seq), [0]);
  assert.deepEqual((await store.read({ pattern: 'user.*' })).map((e) => e.seq), [0, 1]);
  assert.deepEqual((await store.read({ fromSeq: 1 })).map((e) => e.seq), [1, 2]);
  assert.deepEqual((await store.read({ since: 200 })).map((e) => e.seq), [1, 2]);
  assert.deepEqual((await store.read({ until: 200 })).map((e) => e.seq), [0, 1]);
  assert.deepEqual((await store.read({ limit: 2 })).map((e) => e.seq), [0, 1]);
  assert.equal(await store.count({ pattern: 'user.*' }), 2);
  await store.close();
});

test('clear empties the store', async () => {
  const store = newStore();
  await store.append(env('e', 0));
  await store.clear();
  assert.equal(await store.count(), 0);
  await store.close();
});

test('health reports down before any connection and up after init', async () => {
  const store = newStore();
  assert.equal(store.health().status, 'down');
  await store.init();
  assert.equal(store.health().status, 'up');
  await store.close();
});

// ── Facade persistence + replay over Redis ─────────────────────────────────────

test('the facade persists to and replays from the Redis-backed store', async () => {
  const store = newStore();
  const events = createEvents<AppEvents>({ store });

  await events.publish('user.created', { id: 'u1' });
  await events.publish('order.shipped', { id: 'o1' });
  await events.publish('user.updated', { id: 'u1' });

  const replayed: string[] = [];
  events.on('**', (_p, ctx) => {
    replayed.push(ctx.event);
  });

  const count = await events.replay();
  assert.equal(count, 3);
  assert.deepEqual(replayed, ['user.created', 'order.shipped', 'user.updated']);

  const onlyUsers: string[] = [];
  events.on('user.*', (_p, ctx) => {
    onlyUsers.push(ctx.event);
  });
  // Re-run isolates filtering on the store side.
  const userReplayed = await events.replay({ pattern: 'user.*' });
  assert.equal(userReplayed, 2);

  await events.close();
  await store.close();
});

// ── Property: Redis store is behaviorally equivalent to the Memory store ────────

test('property: RedisEventStore.read matches MemoryEventStore.read for the same appends+filter', async () => {
  const nameArb = fc.constantFrom('user.created', 'user.updated', 'order.shipped');
  await fc.assert(
    fc.asyncProperty(
      fc.array(nameArb, { minLength: 0, maxLength: 20 }),
      fc.option(fc.constantFrom('user.*', 'order.*', '**', 'user.created'), { nil: undefined }),
      async (names, pattern) => {
        const redis = newStore();
        const mem = new MemoryEventStore();

        for (let i = 0; i < names.length; i += 1) {
          const e = env(names[i]!, i, i);
          // eslint-disable-next-line no-await-in-loop -- deterministic sequential append
          await redis.append(e);
          // eslint-disable-next-line no-await-in-loop -- deterministic sequential append
          await mem.append(e);
        }

        const filter = pattern === undefined ? undefined : { pattern };
        const redisRead = (await redis.read(filter)).map((e) => `${e.name}#${e.seq}`);
        const memRead = (await mem.read(filter)).map((e) => `${e.name}#${e.seq}`);
        assert.deepEqual(redisRead, memRead);
        assert.equal(await redis.count(filter), await mem.count(filter));

        await redis.close();
      },
    ),
    { numRuns: 100 },
  );
});
