// src/tests/postgres-store.test.ts
// Unit + property tests for PostgresEventStore driven by an in-memory fake SQL
// executor (no real database). Covers append/read/filters/clear/health, facade
// persistence + replay, JSON round-tripping over the text protocol, and
// behavioral parity with MemoryEventStore.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { PostgresEventStore } from '../store/postgres.js';
import { MemoryEventStore } from '../store/memory.js';
import { buildEnvelope } from '../event.js';
import { createEvents } from '../facade.js';
import { FakeSql } from './fake-sql.js';

interface AppEvents {
  'user.created': { id: string };
  'user.updated': { id: string };
  'order.shipped': { id: string };
}

function env(name: string, seq: number, timestamp = seq, payload: unknown = { seq }) {
  return buildEnvelope(name, payload, timestamp, seq);
}

function newStore(sql = new FakeSql()): { store: PostgresEventStore; sql: FakeSql } {
  return { store: new PostgresEventStore({ pool: sql }), sql };
}

// ── Unit ────────────────────────────────────────────────────────────────────

test('init runs the migration and marks health up', async () => {
  const { store } = newStore();
  assert.equal(store.health().status, 'down');
  await store.init();
  assert.equal(store.health().status, 'up');
});

test('append then read returns events ordered by seq, round-tripping JSON payloads', async () => {
  const { store } = newStore();
  await store.append(env('user.created', 2, 2, { id: 'c', nested: { a: 1 } }));
  await store.append(env('user.created', 0, 0, { id: 'a' }));
  await store.append(env('user.created', 1, 1, { id: 'b' }));

  const all = await store.read();
  assert.deepEqual(all.map((e) => e.seq), [0, 1, 2]);
  // Payload survived the JSON round-trip through the (text-protocol) column.
  assert.deepEqual(all[2]!.payload, { id: 'c', nested: { a: 1 } });
  assert.equal(await store.count(), 3);
});

test('read honors name/pattern/seq/time filters and limit', async () => {
  const { store } = newStore();
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

test('clear empties the table', async () => {
  const { store } = newStore();
  await store.append(env('e', 0));
  await store.clear();
  assert.equal(await store.count(), 0);
});

test('a query error flips health to down', async () => {
  const { store, sql } = newStore();
  await store.init();
  assert.equal(store.health().status, 'up');
  sql.failNext = true;
  await assert.rejects(() => store.read());
  assert.equal(store.health().status, 'down');
});

test('an invalid table name is rejected at construction', () => {
  assert.throws(() => new PostgresEventStore({ pool: new FakeSql(), table: 'bad name;' }), /invalid table/);
});

// ── Facade persistence + replay over Postgres ──────────────────────────────────

test('the facade persists to and replays from the Postgres-backed store', async () => {
  const { store } = newStore();
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
  await events.close();
});

// ── Property: parity with the Memory store ─────────────────────────────────────

test('property: PostgresEventStore.read matches MemoryEventStore.read for the same appends+filter', async () => {
  const nameArb = fc.constantFrom('user.created', 'user.updated', 'order.shipped');
  await fc.assert(
    fc.asyncProperty(
      fc.array(nameArb, { minLength: 0, maxLength: 20 }),
      fc.option(fc.constantFrom('user.*', 'order.*', '**', 'user.created'), { nil: undefined }),
      async (names, pattern) => {
        const { store: pg } = newStore();
        const mem = new MemoryEventStore();
        for (let i = 0; i < names.length; i += 1) {
          const e = env(names[i]!, i, i);
          // eslint-disable-next-line no-await-in-loop -- deterministic sequential append
          await pg.append(e);
          // eslint-disable-next-line no-await-in-loop -- deterministic sequential append
          await mem.append(e);
        }
        const filter = pattern === undefined ? undefined : { pattern };
        const pgRead = (await pg.read(filter)).map((e) => `${e.name}#${e.seq}`);
        const memRead = (await mem.read(filter)).map((e) => `${e.name}#${e.seq}`);
        assert.deepEqual(pgRead, memRead);
        assert.equal(await pg.count(filter), await mem.count(filter));
      },
    ),
    { numRuns: 100 },
  );
});
