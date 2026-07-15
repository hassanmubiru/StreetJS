# @streetjs/telemetry — Architecture

## Goals

- A single, generic in-process telemetry tracker for StreetJS.
- Zero runtime dependencies (Node core `process` only).
- Bounded memory: never retain unbounded history.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  tracker.ts  TelemetryTracker + TelemetrySample.
  index.ts    Curated public API + TELEMETRY_TRACKER DI token.
```

## Extraction & single source of truth

Extracted from `streetjs` core (`telemetry/tracker`). The `TelemetrySample` type and
`TelemetryTracker` class now live here; core re-exports both (its `core/types.ts`
re-exports `TelemetrySample`, and `telemetry/tracker.ts` re-exports the class) and keeps
the framework-specific `telemetryMiddleware` (which depends on the request context). So
the package is generic and framework-free, and the `streetjs/telemetry` subpath resolves
to one implementation — dependency inversion, not duplication or a shim.

## Design

- **Ring buffers** — samples are capped at 1440 (24h at 1/min) and latencies at 10 000;
  both evict the oldest on overflow, bounding memory regardless of uptime or traffic.
- **Percentiles** — computed on demand from a sorted copy of the latency window
  (`ceil(pct/100 * n) - 1` indexing).
- **Background collection** — the constructor takes an initial sample and schedules
  periodic collection via an `unref`'d timer, so telemetry never keeps the process alive;
  `destroy()` clears it.
- **Health view** — `health()` derives a coarse `ok`/`degraded` status plus uptime, pid,
  heap, request, and latency summaries for a health endpoint.

## Testing

`node --test`: snapshot fields, request/error counters, percentile computation over a
known distribution, bounded latency ring buffer (10 050 observations), history retrieval,
and the health summary. Coverage: lines/functions/statements ≥ 90, branches ≥ 80 — the two
uncovered branches (the 1440-sample retention eviction and the 900 MB "degraded" heap
threshold) are impractical to force in a unit test without 24h of samples or a 900 MB heap.
