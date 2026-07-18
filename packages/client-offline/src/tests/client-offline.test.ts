import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  OfflineCache,
  MutationQueue,
  MemoryOfflineStore,
  type Mutation,
  type SendOutcome,
} from '../index.js';

function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

// ── MemoryOfflineStore ──────────────────────────────────────────────────────────

test('MemoryOfflineStore get/set/delete/keys', async () => {
  const s = new MemoryOfflineStore();
  assert.equal(await s.get('a'), undefined);
  await s.set('a', '1');
  await s.set('b', '2');
  assert.equal(await s.get('a'), '1');
  assert.deepEqual((await s.keys()).sort(), ['a', 'b']);
  await s.delete('a');
  assert.equal(await s.get('a'), undefined);
});

// ── OfflineCache ────────────────────────────────────────────────────────────────

test('cache.get fetches on miss, then serves from cache within TTL', async () => {
  const clock = fakeClock();
  const cache = new OfflineCache({ clock: clock.now, defaultTtlMs: 1000 });
  let calls = 0;
  const fetcher = async () => { calls++; return { n: 42 }; };

  assert.deepEqual(await cache.get('k', fetcher), { n: 42 });
  assert.equal(calls, 1);
  assert.deepEqual(await cache.get('k', fetcher), { n: 42 });
  assert.equal(calls, 1, 'served from cache, no second fetch');
});

test('cache refetches after the TTL expires', async () => {
  const clock = fakeClock();
  const cache = new OfflineCache({ clock: clock.now, defaultTtlMs: 1000 });
  let calls = 0;
  const fetcher = async () => { calls++; return calls; };
  assert.equal(await cache.get('k', fetcher), 1);
  clock.advance(1500);
  assert.equal(await cache.get('k', fetcher), 2, 'stale → refetched');
});

test('cache returns a stale value when the fetch fails (offline-first)', async () => {
  const clock = fakeClock();
  const cache = new OfflineCache({ clock: clock.now, defaultTtlMs: 1000 });
  await cache.get('k', async () => 'first');
  clock.advance(2000); // expire it
  const value = await cache.get('k', async () => { throw new Error('offline'); });
  assert.equal(value, 'first', 'stale value served on fetch failure');
});

test('cache propagates the error when nothing is cached and the fetch fails', async () => {
  const cache = new OfflineCache();
  await assert.rejects(() => cache.get('k', async () => { throw new Error('offline'); }), /offline/);
});

test('cache peek respects expiry; set/invalidate work; never-expiring entries persist', async () => {
  const clock = fakeClock();
  const cache = new OfflineCache({ clock: clock.now });
  await cache.set('forever', 'x'); // no ttl
  clock.advance(10_000_000);
  assert.equal(await cache.peek('forever'), 'x', 'no-ttl entry never expires');

  await cache.set('temp', 'y', 100);
  assert.equal(await cache.peek('temp'), 'y');
  clock.advance(200);
  assert.equal(await cache.peek('temp'), undefined, 'expired');

  await cache.set('z', '1');
  await cache.invalidate('z');
  assert.equal(await cache.peek('z'), undefined);
});

// ── MutationQueue ────────────────────────────────────────────────────────────────

const okSender = async (): Promise<SendOutcome> => ({ status: 'ok' });

test('enqueue persists, de-duplicates by id, and preserves order', async () => {
  const clock = fakeClock();
  const q = new MutationQueue({ clock: clock.now });
  await q.enqueue({ id: 'm1', op: 'a', payload: 1 });
  await q.enqueue({ id: 'm2', op: 'b', payload: 2 });
  await q.enqueue({ id: 'm1', op: 'a', payload: 999 }); // dup ignored
  const list = await q.list();
  assert.deepEqual(list.map((m) => m.id), ['m1', 'm2']);
  assert.equal(list[0]!.payload, 1, 'first enqueue wins');
  assert.equal(await q.size(), 2);
});

test('flush sends all mutations in order and empties the outbox', async () => {
  const q = new MutationQueue();
  await q.enqueue({ id: 'm1', op: 'a', payload: 1 });
  await q.enqueue({ id: 'm2', op: 'b', payload: 2 });
  const seen: string[] = [];
  const res = await q.flush(async (m: Mutation) => { seen.push(m.id); return { status: 'ok' }; });
  assert.deepEqual(seen, ['m1', 'm2']);
  assert.deepEqual(res, { sent: 2, dropped: 0, remaining: 0 });
  assert.equal(await q.size(), 0);
});

test('flush stops at the first transient failure, preserving order', async () => {
  const q = new MutationQueue();
  await q.enqueue({ id: 'm1', op: 'a', payload: 1 });
  await q.enqueue({ id: 'm2', op: 'b', payload: 2 });
  // m1 fails transiently → the pass stops; m2 is never attempted.
  const attempted: string[] = [];
  const res = await q.flush(async (m) => {
    attempted.push(m.id);
    return m.id === 'm1' ? { status: 'retry', error: 'net' } : { status: 'ok' };
  });
  assert.deepEqual(attempted, ['m1']);
  assert.equal(res.sent, 0);
  assert.equal(res.remaining, 2, 'both remain, order intact');
  assert.equal((await q.list())[0]!.attempts, 1, 'attempt counter incremented + persisted');
});

test('a sender throwing is treated as a transient retry', async () => {
  const q = new MutationQueue();
  await q.enqueue({ id: 'm1', op: 'a', payload: 1 });
  const res = await q.flush(async () => { throw new Error('boom'); });
  assert.equal(res.remaining, 1);
  assert.equal((await q.list())[0]!.attempts, 1);
});

test('a permanent drop removes the mutation and fires onDrop', async () => {
  const dropped: Array<{ id: string; reason: string }> = [];
  const q = new MutationQueue({ onDrop: (m, reason) => dropped.push({ id: m.id, reason }) });
  await q.enqueue({ id: 'm1', op: 'a', payload: 1 });
  await q.enqueue({ id: 'm2', op: 'b', payload: 2 });
  const res = await q.flush(async (m) => (m.id === 'm1' ? { status: 'drop', error: '400 bad request' } : { status: 'ok' }));
  assert.equal(res.sent, 1);
  assert.equal(res.dropped, 1);
  assert.equal(await q.size(), 0);
  assert.deepEqual(dropped, [{ id: 'm1', reason: '400 bad request' }]);
});

test('a mutation is dropped after exceeding maxAttempts', async () => {
  const dropped: string[] = [];
  const q = new MutationQueue({ maxAttempts: 3, onDrop: (m) => dropped.push(m.id) });
  await q.enqueue({ id: 'm1', op: 'a', payload: 1 });
  // Each flush attempts once and stops (retry); after 3 attempts it drops.
  await q.flush(async () => ({ status: 'retry' }));
  await q.flush(async () => ({ status: 'retry' }));
  assert.equal(await q.size(), 1, 'still queued after 2 attempts');
  const res = await q.flush(async () => ({ status: 'retry' }));
  assert.equal(res.dropped, 1);
  assert.equal(await q.size(), 0, 'dropped on the 3rd attempt');
  assert.deepEqual(dropped, ['m1']);
});

test('flush is re-entrancy guarded and clear empties the outbox', async () => {
  const q = new MutationQueue();
  await q.enqueue({ id: 'm1', op: 'a', payload: 1 });
  // Kick off a slow flush and a concurrent one; the second returns immediately.
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const slow = q.flush(async () => { await gate; return { status: 'ok' }; });
  const concurrent = await q.flush(okSender);
  assert.equal(concurrent.sent, 0, 'concurrent flush is a no-op while one is in flight');
  release();
  await slow;

  await q.enqueue({ id: 'm2', op: 'b', payload: 2 });
  await q.clear();
  assert.equal(await q.size(), 0);
});

test('flushing an empty outbox is a no-op', async () => {
  const q = new MutationQueue();
  assert.deepEqual(await q.flush(okSender), { sent: 0, dropped: 0, remaining: 0 });
});
