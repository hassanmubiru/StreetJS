/**
 * @streetjs/store — runnable integration example.
 *
 * Uses an injected clock to demonstrate deterministic sliding-window rate
 * limiting, abuse counters, and a TTL key/value store — the exact primitives the
 * framework's rate limiter and abuse engine build on.
 *
 * Run with: `npm run example -w packages/store`
 */

import {
  InMemoryRateLimitStore,
  InMemoryCounterStore,
  InMemoryKeyValueStore,
} from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

// A controllable clock so the example is fully deterministic.
let t = 0;
const clock = () => t;

// 1. Rate limiting: 3 hits allowed per 1000ms window.
const limiter = new InMemoryRateLimitStore({ clock });
const key = 'ip:203.0.113.7';
const limit = 3;
const window = 1000;
const results: number[] = [];
for (let i = 0; i < 4; i++) {
  const count = await limiter.hit(key, clock(), window);
  results.push(count);
  t += 100;
}
console.log('hit counts:', results); // [1,2,3,4]
assert(results[3]! > limit, '4th hit exceeds the limit of 3');

// Advance past the window — the allowance recovers.
t += 1000;
assert((await limiter.count(key, clock(), window)) === 0, 'window slid clean');
console.log('after window: allowance recovered');

// 2. Abuse counter: failed logins in a 60s window.
const counter = new InMemoryCounterStore({ clock });
await counter.increment('login:ada', clock(), 60_000);
const fails = await counter.increment('login:ada', clock(), 60_000);
console.log('failed logins:', fails);
assert(fails === 2, 'two failures counted');

// 3. Key/value store with TTL (e.g. a short-lived lockout marker).
const kv = new InMemoryKeyValueStore({ clock });
await kv.set('lockout:ada', '1', 5_000);
assert((await kv.get('lockout:ada')) === '1', 'lockout active');
t += 6_000;
assert((await kv.get('lockout:ada')) === undefined, 'lockout expired');
console.log('lockout expired after TTL');

console.log('\nAll @streetjs/store example assertions passed.');
