// src/security/store.ts
// Pluggable backing-store abstraction (R3.8).
//
// The implementation now lives in the standalone, zero-dependency
// `@streetjs/store` package. This module re-exports it verbatim so every
// internal `./store.js` importer (rate limiter, abuse engine) and the public
// `streetjs` API keep working against a single source of truth — no
// duplication, no shim.

export {
  systemClock,
  InMemoryRateLimitStore,
  InMemoryCounterStore,
  InMemoryKeyValueStore,
} from '@streetjs/store';
export type {
  Clock,
  KeyValueStore,
  CounterStore,
  RateLimitStore,
  InMemoryRateLimitStoreOptions,
} from '@streetjs/store';
