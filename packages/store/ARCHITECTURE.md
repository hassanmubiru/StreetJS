# Architecture — @streetjs/store

## Purpose

`@streetjs/store` defines the backing-store contracts that stateful StreetJS
subsystems — the rate limiter and the abuse engine — depend on, plus the default
in-memory implementations. Extracting it lets those subsystems be swapped between
in-process and shared (cross-instance) storage without changing their logic, and
lets each be tested deterministically.

## Dependencies

None. The package is pure TypeScript over `Map` and standard timers (Node core
`NodeJS.Timeout` typing only); it has zero third-party runtime dependencies and
carries a `browser` export condition.

## Design

### Three narrow interfaces

- `RateLimitStore` — sliding-window request counts (`hit`/`count`).
- `CounterStore` — sliding-window event counters (`increment`/`count`/`reset`).
- `KeyValueStore` — opaque values with optional TTL (`get`/`set`/`delete`).

Each is intentionally minimal so a Redis-backed implementation (sorted sets for
the windows, `SET … PX` for the KV store) can be dropped in behind the same
contract. All window operations take explicit `nowMs`/`windowMs` arguments so the
store never reads the clock mid-operation — timing is the caller's (or an
injected clock's) responsibility, which makes concurrency reasoning and testing
straightforward.

### Injected clock

`Clock = () => number` with a `systemClock` default. Passing a controllable clock
makes every window boundary deterministic, which is essential for the
property-based rate-limit tests in the framework.

### Bounded in-memory window

`InMemoryRateLimitStore` keeps an ascending timestamp array per key and prunes
leading entries older than `nowMs - windowMs` on each `hit`. It bounds memory two
ways: `maxKeys` (oldest-key eviction when full) and `maxRequestsPerKey` (stops
storing but still reports the capped count, so the limiter still rejects). An
optional unref'd sweep timer drops stale timestamps for idle keys.
`InMemoryCounterStore` reuses this exact window logic; `InMemoryKeyValueStore`
evaluates TTL lazily on read.

## Testing

The suite is fully deterministic via an injected clock and covers: window
counting and sliding, `count` without recording, the per-key cap, `maxKeys`
eviction, `reset`/`size`/`now`, the retention sweep (driven directly rather than
via the timer), `destroy`, the counter store delegation, and the KV store's
round-trip / TTL expiry / delete / clear paths. Coverage is 100% lines/functions
and ≥97% branches.

## Non-goals

- No shared/Redis implementation here — only the contracts and in-memory
  defaults (the framework ships `RedisRateLimitStore` separately).
- No persistence across process restarts.
- No eviction policy beyond oldest-key / per-key caps.
