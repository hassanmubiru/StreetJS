/**
 * @streetjs/store — the StreetJS backing-store abstractions.
 *
 * Small, pluggable store interfaces — `KeyValueStore`, `CounterStore`, and
 * `RateLimitStore` — plus deterministic, clock-injectable in-memory
 * implementations of each. The sliding-window stores back rate limiting and
 * abuse counters and are drop-in interchangeable with future shared (e.g.
 * Redis) implementations. Zero runtime dependencies. Public API only.
 *
 * ```ts
 * import { InMemoryRateLimitStore } from '@streetjs/store';
 *
 * const store = new InMemoryRateLimitStore();
 * const hits = await store.hit('ip:1.2.3.4', Date.now(), 60_000);
 * ```
 *
 * > This is the standalone home of the stores that also back the `streetjs`
 * > framework; the framework re-exports them, so there is a single implementation.
 */

export {
  systemClock,
  InMemoryRateLimitStore,
  InMemoryCounterStore,
  InMemoryKeyValueStore,
} from './store.js';
export type {
  Clock,
  KeyValueStore,
  CounterStore,
  RateLimitStore,
  InMemoryRateLimitStoreOptions,
} from './store.js';
