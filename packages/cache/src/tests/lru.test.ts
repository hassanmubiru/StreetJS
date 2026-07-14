import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LruCache } from '../lru.js';
import { CACHE } from '../index.js';

function fixedClock(start = 1000): { fn: () => number; set: (v: number) => void } {
  let t = start;
  return { fn: () => t, set: (v) => (t = v) };
}

test('stores and retrieves values', () => {
  const c = new LruCache<string, number>({ maxEntries: 3, ttlMs: 1000, autoSweep: false });
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  assert.equal(c.has('a'), true);
  assert.equal(c.size, 1);
});

test('returns undefined for missing keys', () => {
  const c = new LruCache({ maxEntries: 2, ttlMs: 1000, autoSweep: false });
  assert.equal(c.get('nope'), undefined);
  assert.equal(c.has('nope'), false);
});

test('rejects maxEntries < 1', () => {
  assert.throws(() => new LruCache({ maxEntries: 0, ttlMs: 1 }), /maxEntries must be >= 1/);
});

test('evicts the least-recently-used entry when over capacity', () => {
  const c = new LruCache<string, number>({ maxEntries: 2, ttlMs: 10_000, autoSweep: false });
  c.set('a', 1);
  c.set('b', 2);
  c.get('a'); // 'a' now most-recently-used, 'b' is LRU
  c.set('c', 3); // evicts 'b'
  assert.equal(c.has('a'), true);
  assert.equal(c.has('b'), false);
  assert.equal(c.has('c'), true);
  assert.equal(c.size, 2);
});

test('updating an existing key refreshes value, TTL, and recency', () => {
  const clock = fixedClock();
  const c = new LruCache<string, number>({ maxEntries: 2, ttlMs: 100, autoSweep: false, clock: clock.fn });
  c.set('a', 1);
  c.set('b', 2);
  clock.set(1050);
  c.set('a', 10); // refresh 'a'
  c.set('c', 3); // evicts LRU ('b')
  assert.equal(c.get('a'), 10);
  assert.equal(c.has('b'), false);
  assert.equal(c.has('c'), true);
});

test('entries expire after ttl on get and has', () => {
  const clock = fixedClock(0);
  const c = new LruCache<string, number>({ maxEntries: 5, ttlMs: 100, autoSweep: false, clock: clock.fn });
  c.set('a', 1);
  clock.set(50);
  assert.equal(c.get('a'), 1);
  clock.set(201);
  assert.equal(c.get('a'), undefined);
  c.set('b', 2);
  clock.set(400);
  assert.equal(c.has('b'), false);
});

test('delete removes entries', () => {
  const c = new LruCache<string, number>({ maxEntries: 2, ttlMs: 1000, autoSweep: false });
  c.set('a', 1);
  assert.equal(c.delete('a'), true);
  assert.equal(c.delete('a'), false);
  assert.equal(c.has('a'), false);
});

test('clear empties the cache', () => {
  const c = new LruCache<string, number>({ maxEntries: 3, ttlMs: 1000, autoSweep: false });
  c.set('a', 1);
  c.set('b', 2);
  c.clear();
  assert.equal(c.size, 0);
  assert.equal(c.get('a'), undefined);
});

test('non-string keys are coerced consistently', () => {
  const c = new LruCache<number, string>({ maxEntries: 3, ttlMs: 1000, autoSweep: false });
  c.set(1, 'one');
  assert.equal(c.get(1), 'one');
  assert.equal(c.has(1), true);
});

test('background sweep removes expired entries', async () => {
  const clock = fixedClock(0);
  const c = new LruCache<string, number>({ maxEntries: 10, ttlMs: 20, clock: clock.fn });
  c.set('a', 1);
  c.set('b', 2);
  clock.set(1000); // everything expired
  await new Promise((r) => setTimeout(r, 30)); // let the sweep (interval ttl/2=10ms) run
  assert.equal(c.size, 0);
  c.destroy();
});

test('destroy stops the timer and clears entries', () => {
  const c = new LruCache<string, number>({ maxEntries: 3, ttlMs: 1000 });
  c.set('a', 1);
  c.destroy();
  assert.equal(c.size, 0);
});

test('moveToHead is a no-op when getting the current head', () => {
  const c = new LruCache<string, number>({ maxEntries: 3, ttlMs: 1000, autoSweep: false });
  c.set('a', 1);
  c.set('b', 2); // 'b' is head
  assert.equal(c.get('b'), 2); // head stays head
  c.set('c', 3);
  c.get('c'); // head
  assert.equal(c.size, 3);
});

test('DI token is a stable global symbol', () => {
  assert.equal(CACHE, Symbol.for('@streetjs/cache:Cache'));
});
