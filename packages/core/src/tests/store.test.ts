// tests/store.test.ts
// Example-based unit tests for the pluggable backing-store abstraction
// (Phase 1, R3.8), focused on InMemoryRateLimitStore: hit/count semantics,
// sliding-window roll-off, and deterministic timing under an injected clock.
// The named property tests for sliding-window threshold behavior live in their
// own tasks; these verify the core store behaviors with concrete examples.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryRateLimitStore,
  InMemoryCounterStore,
  systemClock,
  type Clock,
} from '../security/store.js';

const WINDOW = 1000; // 1 second window for all examples below.

/** A controllable clock whose value can be advanced explicitly in tests. */
function fakeClock(start = 0): Clock & { advance(ms: number): void; set(ms: number): void } {
  let nowMs = start;
  const clock = (() => nowMs) as Clock & { advance(ms: number): void; set(ms: number): void };
  clock.advance = (ms: number) => { nowMs += ms; };
  clock.set = (ms: number) => { nowMs = ms; };
  return clock;
}

describe('InMemoryRateLimitStore hit/count semantics', () => {
  it('hit records an event and returns the running count within the window', async () => {
    const store = new InMemoryRateLimitStore();
    assert.equal(await store.hit('k', 0, WINDOW), 1);
    assert.equal(await store.hit('k', 100, WINDOW), 2);
    assert.equal(await store.hit('k', 200, WINDOW), 3);
  });

  it('count reports active hits without recording a new one', async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit('k', 0, WINDOW);
    await store.hit('k', 100, WINDOW);

    // count is read-only: repeated reads do not change the total.
    assert.equal(await store.count('k', 200, WINDOW), 2);
    assert.equal(await store.count('k', 200, WINDOW), 2);

    // A subsequent hit reflects exactly one additional event.
    assert.equal(await store.hit('k', 200, WINDOW), 3);
  });

  it('count returns 0 for an unknown key', async () => {
    const store = new InMemoryRateLimitStore();
    assert.equal(await store.count('missing', 0, WINDOW), 0);
  });

  it('tracks distinct keys independently', async () => {
    const store = new InMemoryRateLimitStore();
    assert.equal(await store.hit('a', 0, WINDOW), 1);
    assert.equal(await store.hit('a', 10, WINDOW), 2);
    assert.equal(await store.hit('b', 10, WINDOW), 1);
    assert.equal(await store.count('a', 10, WINDOW), 2);
    assert.equal(await store.count('b', 10, WINDOW), 1);
  });

  it('reset drops all tracked state for a key', async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit('k', 0, WINDOW);
    await store.hit('k', 10, WINDOW);
    store.reset('k');
    assert.equal(await store.count('k', 10, WINDOW), 0);
    assert.equal(await store.hit('k', 10, WINDOW), 1);
  });
});

describe('InMemoryRateLimitStore sliding-window roll-off', () => {
  it('drops events that fall outside [now - window, now]', async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit('k', 0, WINDOW);
    await store.hit('k', 500, WINDOW);

    // At t=1500 the event at t=0 is older than the window and rolls off.
    assert.equal(await store.count('k', 1500, WINDOW), 1);

    // A hit at t=1500 keeps the t=500 event (>= 500) plus the new one.
    assert.equal(await store.hit('k', 1500, WINDOW), 2);
  });

  it('treats an event exactly at the cutoff boundary as still active', async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit('k', 0, WINDOW);
    // cutoff = 1000 - 1000 = 0; the event at t=0 is inclusive of the window.
    assert.equal(await store.count('k', WINDOW, WINDOW), 1);
    // One millisecond later the event at t=0 is strictly older and rolls off.
    assert.equal(await store.count('k', WINDOW + 1, WINDOW), 0);
  });

  it('resumes from zero after the entire window rolls off', async () => {
    const store = new InMemoryRateLimitStore();
    await store.hit('k', 0, WINDOW);
    await store.hit('k', 100, WINDOW);
    // Far beyond the window: every prior event has expired.
    assert.equal(await store.hit('k', 10_000, WINDOW), 1);
  });
});

describe('InMemoryRateLimitStore clock injection', () => {
  it('now() reflects the injected clock and stays deterministic', () => {
    const clock = fakeClock(0);
    const store = new InMemoryRateLimitStore({ clock });
    assert.equal(store.now(), 0);
    clock.advance(250);
    assert.equal(store.now(), 250);
    clock.set(5000);
    assert.equal(store.now(), 5000);
  });

  it('defaults to the system clock when none is injected', () => {
    const store = new InMemoryRateLimitStore();
    const before = Date.now();
    const observed = store.now();
    const after = Date.now();
    assert.ok(observed >= before && observed <= after);
  });

  it('drives window evaluation off the now arguments, independent of wall clock', async () => {
    const clock = fakeClock(1_000_000);
    const store = new InMemoryRateLimitStore({ clock });
    // Window math uses the explicit nowMs args, so results are reproducible
    // regardless of the injected clock value.
    assert.equal(await store.hit('k', 0, WINDOW), 1);
    assert.equal(await store.hit('k', 999, WINDOW), 2);
    assert.equal(await store.count('k', 1001, WINDOW), 1);
  });
});

describe('InMemoryRateLimitStore bounded storage', () => {
  it('evicts the oldest key when the key ceiling is reached', async () => {
    const store = new InMemoryRateLimitStore({ maxKeys: 2 });
    await store.hit('a', 0, WINDOW);
    await store.hit('b', 0, WINDOW);
    assert.equal(store.size(), 2);
    await store.hit('c', 0, WINDOW); // evicts 'a' (oldest insertion).
    assert.equal(store.size(), 2);
    assert.equal(await store.count('a', 0, WINDOW), 0);
    assert.equal(await store.count('c', 0, WINDOW), 1);
  });

  it('caps stored timestamps per key while still reporting the capped count', async () => {
    const store = new InMemoryRateLimitStore({ maxRequestsPerKey: 3 });
    assert.equal(await store.hit('k', 0, WINDOW), 1);
    assert.equal(await store.hit('k', 1, WINDOW), 2);
    assert.equal(await store.hit('k', 2, WINDOW), 3);
    // Beyond the cap, the count saturates rather than growing unbounded.
    assert.equal(await store.hit('k', 3, WINDOW), 3);
    assert.equal(await store.hit('k', 4, WINDOW), 3);
  });
});

describe('systemClock', () => {
  it('returns a millisecond timestamp close to Date.now()', () => {
    const before = Date.now();
    const t = systemClock();
    const after = Date.now();
    assert.ok(t >= before && t <= after);
  });
});

describe('InMemoryCounterStore (shares the sliding-window logic)', () => {
  it('increment mirrors hit semantics with the injected clock', async () => {
    const counter = new InMemoryCounterStore({ clock: fakeClock(0) });
    assert.equal(await counter.increment('login', 0, WINDOW), 1);
    assert.equal(await counter.increment('login', 100, WINDOW), 2);
    assert.equal(await counter.count('login', 200, WINDOW), 2);

    // Roll-off applies identically to counter events.
    assert.equal(await counter.count('login', 1500, WINDOW), 1);

    await counter.reset('login');
    assert.equal(await counter.count('login', 1500, WINDOW), 0);
  });
});
