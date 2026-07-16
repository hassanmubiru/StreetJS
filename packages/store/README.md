# @streetjs/store

The StreetJS backing-store abstractions: small, pluggable `KeyValueStore`,
`CounterStore`, and `RateLimitStore` interfaces plus deterministic,
clock-injectable in-memory implementations. The sliding-window stores back rate
limiting and abuse counters and are drop-in interchangeable with future shared
(e.g. Redis) implementations. **Zero runtime dependencies**, ESM.

This is the standalone home of the stores that also back the `streetjs`
framework's rate limiter and abuse engine. The framework re-exports this
package, so there is a single source of truth.

## Install

```bash
npm install @streetjs/store
```

## Usage

```ts
import { InMemoryRateLimitStore } from '@streetjs/store';

const store = new InMemoryRateLimitStore();
const now = Date.now();
const hits = await store.hit('ip:1.2.3.4', now, 60_000); // hits in the last 60s
if (hits > 100) reject();
```

All timing is driven by explicit `nowMs` arguments and an optional injected
`clock`, so window behavior is fully deterministic in tests.

## Interfaces

- **`RateLimitStore`** — `hit(key, nowMs, windowMs)` records a hit and returns
  the count in the window; `count(...)` reads without recording.
- **`CounterStore`** — `increment`/`count`/`reset` for abuse-style counters.
- **`KeyValueStore`** — `get`/`set(…, ttlMs?)`/`delete` for small opaque values.
- **`Clock`** — `() => number` now-provider; `systemClock` is the default.

## In-memory implementations

### `InMemoryRateLimitStore`

A bounded sliding window over a `Map<string, number[]>` of timestamps. Options:

| Option | Default | Description |
| ------ | ------- | ----------- |
| `clock` | `systemClock` | Injected now-provider. |
| `maxKeys` | `100000` | Distinct keys before oldest-key eviction. |
| `maxRequestsPerKey` | `1000` | Cap on stored timestamps per key. |
| `sweepIntervalMs` | — | Enables a periodic memory sweep (with `retentionMs`). |
| `retentionMs` | — | Retention horizon for the sweep. |

Also exposes `count`, `reset`, `size`, `now`, and `destroy`. When at
`maxRequestsPerKey`, it stops storing but still reports the capped count so the
limiter rejects correctly.

### `InMemoryCounterStore`

`CounterStore` built on the same window logic — the default for abuse counters.

### `InMemoryKeyValueStore`

`KeyValueStore` with optional per-entry TTL evaluated lazily on read against the
injected clock, plus `clear()`.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/store
```

## License

MIT — see [LICENSE](./LICENSE).
