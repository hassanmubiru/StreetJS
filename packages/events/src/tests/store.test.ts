// src/tests/store.test.ts
// Unit + property tests for MemoryEventStore and facade replay:
//   - append/read/count/clear, filter predicates, ring-buffer bound, health;
//   - persistence of published events, ordered replay to current listeners,
//     replay-not-re-persisted, filtered replay;
//   - property: read() returns events in seq order and replay delivers each once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { MemoryEventStore } from '../store/memory.js';
import { buildEnvelope } from '../event.js';
import { createEvents } from '../facade.js';

interface AppEvents {
  'user.created': { id: string };
  'user.updated': { id: string };
  'order.shipped': { id: string };
}

function env(name: string, seq: number, timestamp = seq) {
  return buildEnvelope(name, { seq }, timestamp, seq);
}

// ── MemoryEventStore unit ──────────────────────────────────────────────────────

test('append then read returns events in seq order', async () => {
  const store = new MemoryEventStore();
  await store.append(env('user.created', 2));
  await store.append(env('user.created', 0));
  await store.append(env('user.created', 1));

  const all = await store.read();
  assert.deepEqual(all.map((e) => e.seq), [0, 1, 2]);
  assert.equal(await store.count(), 3);
});

test('read filters by exact name, wildcard pattern, seq range, and time range', async () => {
  const store = new MemoryEventStore();
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
});

test('the ring buffer bound drops the oldest events beyond maxEvents', async () => {
  const store = new MemoryEventStore({ maxEvents: 3 });
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- sequential append
    await store.append(env('e', i));
  }
  const all = await store.read();
  assert.deepEqual(all.map((e) => e.seq), [3, 4, 5]); // oldest 0,1,2 dropped
});

test('clear empties the store and health reports up', async () => {
  const store = new MemoryEventStore();
  await store.append(env('e', 0));
  await store.clear();
  assert.equal(await store.count(), 0);
  assert.equal(store.health().status, 'up');
});

// ── Facade persistence + replay ─────────────────────────────────────────────────

test('published events are persisted to the store in order', async () => {
  const store = new MemoryEventStore();
  const events = createEvents<AppEvents>({ store });

  await events.publish('user.created', { id: 'u1' });
  await events.publish('order.shipped', { id: 'o1' });

  const stored = await store.read();
  assert.deepEqual(stored.map((e) => e.name), ['user.created', 'order.shipped']);
  await events.close();
});

test('replay re-dispatches stored events to current listeners in order, once each', async () => {
  const store = new MemoryEventStore();
  const events = createEvents<AppEvents>({ store });

  // Publish BEFORE subscribing — the listener misses the live events.
  await events.publish('user.created', { id: 'u1' });
  await events.publish('user.updated', { id: 'u1' });
  await events.publish('order.shipped', { id: 'o1' });

  const received: string[] = [];
  events.on('**', (_p, ctx) => {
    received.push(ctx.event);
  });

  const count = await events.replay();
  assert.equal(count, 3);
  assert.deepEqual(received, ['user.created', 'user.updated', 'order.shipped']);
  await events.close();
});

test('replay does not re-persist events (store size is unchanged)', async () => {
  const store = new MemoryEventStore();
  const events = createEvents<AppEvents>({ store });
  await events.publish('user.created', { id: 'u1' });
  events.on('user.created', () => {});

  const before = await store.count();
  await events.replay();
  const after = await store.count();
  assert.equal(after, before, 'replay must not append new events to the store');
  await events.close();
});

test('replay honors a filter (pattern) and only delivers matching events', async () => {
  const store = new MemoryEventStore();
  const events = createEvents<AppEvents>({ store });
  await events.publish('user.created', { id: 'u1' });
  await events.publish('order.shipped', { id: 'o1' });
  await events.publish('user.updated', { id: 'u1' });

  const received: string[] = [];
  events.on('**', (_p, ctx) => {
    received.push(ctx.event);
  });

  const count = await events.replay({ pattern: 'user.*' });
  assert.equal(count, 2);
  assert.deepEqual(received, ['user.created', 'user.updated']);
  await events.close();
});

test('replay throws when no store is configured', async () => {
  const events = createEvents<AppEvents>();
  await assert.rejects(() => events.replay(), /requires a configured event store/);
  await events.close();
});

// ── Property: store preserves publish order and replay delivers each once ───────

test('property: read() is seq-ordered and replay delivers every stored event exactly once', async () => {
  const nameArb = fc.constantFrom('user.created', 'user.updated', 'order.shipped');
  await fc.assert(
    fc.asyncProperty(fc.array(nameArb, { minLength: 0, maxLength: 30 }), async (names) => {
      const store = new MemoryEventStore();
      const events = createEvents<AppEvents>({ store });

      for (const name of names) {
        // eslint-disable-next-line no-await-in-loop -- deterministic sequential publish
        await events.publish(name as keyof AppEvents, { id: 'x' });
      }

      // read() must be strictly ascending by seq.
      const stored = await store.read();
      for (let i = 1; i < stored.length; i += 1) {
        assert.ok(stored[i]!.seq > stored[i - 1]!.seq, 'seq must be strictly increasing');
      }
      assert.equal(stored.length, names.length);

      // replay delivers each stored event exactly once, in the same order.
      const replayed: string[] = [];
      events.on('**', (_p, ctx) => {
        replayed.push(ctx.event);
      });
      const count = await events.replay();
      assert.equal(count, names.length);
      assert.deepEqual(replayed, names);

      await events.close();
    }),
    { numRuns: 100 },
  );
});
