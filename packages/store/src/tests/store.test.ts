import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  systemClock,
  InMemoryRateLimitStore,
  InMemoryCounterStore,
  InMemoryKeyValueStore,
} from '../index.js';

/** A controllable clock for deterministic window timing. */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

// ── systemClock ────────────────────────────────────────────────────────────────

test('systemClock returns wall-clock milliseconds', () => {
  const before = Date.now();
  const v = systemClock();
  assert.ok(v >= before && v <= Date.now() + 5);
});

// ── InMemoryRateLimitStore ───────────────────────────────────────────────────────

test('hit counts events within the window and slides as time advances', async () => {
  const clock = fakeClock();
  const store = new InMemoryRateLimitStore({ clock: clock.now });
  const win = 1000;
  assert.equal(await store.hit('k', clock.now(), win), 1);
  clock.advance(400);
  assert.equal(await store.hit('k', clock.now(), win), 2);
  clock.advance(400);
  assert.equal(await store.hit('k', clock.now(), win), 3);
  // Advance past the window relative to the first two hits — they fall out.
  clock.advance(700); // now +1500 from start; only the hit at +800 is within 1000
  assert.equal(await store.hit('k', clock.now(), win), 2);
});

test('count reports the active window without recording a hit', async () => {
  const clock = fakeClock();
  const store = new InMemoryRateLimitStore({ clock: clock.now });
  await store.hit('k', clock.now(), 1000);
  assert.equal(await store.count('k', clock.now(), 1000), 1);
  assert.equal(await store.count('k', clock.now(), 1000), 1, 'count does not add hits');
  assert.equal(await store.count('missing', clock.now(), 1000), 0);
});

test('per-key storage is capped but still reports the capped count', async () => {
  const store = new InMemoryRateLimitStore({ maxRequestsPerKey: 3 });
  for (let i = 0; i < 10; i++) await store.hit('k', 1000, 10_000);
  // Never exceeds the cap of 3 stored timestamps.
  assert.equal(await store.count('k', 1000, 10_000), 3);
});

test('reaching maxKeys evicts the oldest key', async () => {
  const store = new InMemoryRateLimitStore({ maxKeys: 2 });
  await store.hit('a', 1000, 10_000);
  await store.hit('b', 1000, 10_000);
  await store.hit('c', 1000, 10_000); // evicts 'a'
  assert.equal(store.size(), 2);
  assert.equal(await store.count('a', 1000, 10_000), 0, 'oldest key evicted');
  assert.equal(await store.count('c', 1000, 10_000), 1);
});

test('reset removes a key and now() reflects the injected clock', async () => {
  const clock = fakeClock(555);
  const store = new InMemoryRateLimitStore({ clock: clock.now });
  await store.hit('k', clock.now(), 1000);
  store.reset('k');
  assert.equal(store.size(), 0);
  assert.equal(store.now(), 555);
});

test('the periodic sweep drops timestamps older than the retention horizon', async () => {
  const clock = fakeClock();
  const store = new InMemoryRateLimitStore({
    clock: clock.now,
    sweepIntervalMs: 10_000,
    retentionMs: 1000,
  });
  await store.hit('k', clock.now(), 5000);
  assert.equal(store.size(), 1);
  clock.advance(2000); // older than retentionMs
  // Drive the sweep deterministically rather than waiting on the timer.
  (store as unknown as { _sweep(): void })._sweep();
  assert.equal(store.size(), 0, 'idle key swept away');
  store.destroy();
});

test('destroy clears all state', async () => {
  const store = new InMemoryRateLimitStore();
  await store.hit('k', 1000, 1000);
  store.destroy();
  assert.equal(store.size(), 0);
});

// ── InMemoryCounterStore ─────────────────────────────────────────────────────────

test('counter store increments, counts, resets, and destroys', async () => {
  const clock = fakeClock();
  const counter = new InMemoryCounterStore({ clock: clock.now });
  assert.equal(await counter.increment('login:ada', clock.now(), 60_000), 1);
  assert.equal(await counter.increment('login:ada', clock.now(), 60_000), 2);
  assert.equal(await counter.count('login:ada', clock.now(), 60_000), 2);
  await counter.reset('login:ada');
  assert.equal(await counter.count('login:ada', clock.now(), 60_000), 0);
  counter.destroy();
});

// ── InMemoryKeyValueStore ────────────────────────────────────────────────────────

test('kv store round-trips values and honors TTL', async () => {
  const clock = fakeClock();
  const kv = new InMemoryKeyValueStore({ clock: clock.now });
  await kv.set('a', '1');
  assert.equal(await kv.get('a'), '1');

  await kv.set('temp', 'x', 500);
  assert.equal(await kv.get('temp'), 'x');
  clock.advance(600);
  assert.equal(await kv.get('temp'), undefined, 'expired entry is gone');
  // A non-expiring entry survives.
  assert.equal(await kv.get('a'), '1');
});

test('kv store get returns undefined for a missing key', async () => {
  const kv = new InMemoryKeyValueStore();
  assert.equal(await kv.get('nope'), undefined);
});

test('kv store delete and clear remove entries', async () => {
  const kv = new InMemoryKeyValueStore();
  await kv.set('a', '1');
  await kv.set('b', '2');
  await kv.delete('a');
  assert.equal(await kv.get('a'), undefined);
  assert.equal(await kv.get('b'), '2');
  kv.clear();
  assert.equal(await kv.get('b'), undefined);
});
