# @streetjs/telemetry

The in-process telemetry foundation for StreetJS: a **metrics tracker with bounded
ring-buffer retention** — heap/RSS sampling, request counters, and p50/p99 latency
percentiles, plus a health snapshot.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS minimal,
carefully curated dependency footprint.

```bash
npm install @streetjs/telemetry
```

> This is the standalone home of the tracker that also backs the `streetjs/telemetry`
> subpath; the `streetjs` framework re-exports it (and adds a request-timing middleware),
> so there is a single implementation.

## Usage

```ts
import { TelemetryTracker } from '@streetjs/telemetry';

const telemetry = new TelemetryTracker(); // collects a sample every 60s (unref'd)

// On each completed request:
telemetry.recordRequest(elapsedNs, isError); // elapsedNs: bigint (e.g. process.hrtime.bigint diff)

telemetry.snapshot();
// { ts, heapUsedMb, rss, latencyP50, latencyP99, requestCount, errorCount }

telemetry.getHistory(60); // recent samples (bounded to the 24h/1-min window)
telemetry.health();       // { status: 'ok'|'degraded', uptime, pid, heap, requests, latency }
telemetry.destroy();      // stop the background collector on shutdown
```

## Behavior

- **Bounded retention** — samples are kept in a ring buffer (1440 = 24h at 1/min);
  latencies in a bounded circular buffer (10 000). History never grows unbounded.
- **Percentiles** — p50/p99 computed from the recorded latency window.
- **Background collection** — a sample is taken on construction and then every
  `collectIntervalMs` (default 60 000) via an `unref`'d timer, so it never keeps the
  process alive. `destroy()` stops it.

## Dependency injection

Exports a `TELEMETRY_TRACKER` token (a global `Symbol`):

```ts
import { TELEMETRY_TRACKER, TelemetryTracker } from '@streetjs/telemetry';
container.register(TELEMETRY_TRACKER, new TelemetryTracker());
```

## Public API

`TelemetryTracker` · `TelemetrySample` · `TELEMETRY_TRACKER` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable example.

## License

MIT © street contributors
