# @streetjs/metrics — Architecture

## Goals

- A single, generic metrics foundation every StreetJS package can build on.
- Zero runtime dependencies (Node.js core only), matching the framework's minimal,
  carefully curated footprint.
- Prometheus-compatible: exact naming rules, label semantics, and text exposition.
- Strongly typed, interface-first public API; strict TypeScript; no circular deps.

## Module layout

```
src/
  types.ts       Public interfaces: metric options, Sample, MetricSnapshot, Registry.
  validation.ts  Prometheus name rules + label normalization + deterministic keys.
  render.ts      Exposition-format value formatting and escaping.
  metric.ts      BaseMetric: name/label validation, series resolution, arg parsing.
  counter.ts     Counter (monotonic).
  gauge.ts       Gauge (up/down, timers, setToCurrentTime).
  histogram.ts   Histogram (cumulative buckets, sum/count, timers).
  registry.ts    MetricsRegistry + defaultRegistry.
  process.ts     Optional default process metrics (pull-based, injectable source).
  index.ts       Curated public API. Internals are not exported.
```

## Dependency graph (acyclic)

```
types      ← validation, render, metric, counter, gauge, histogram, registry, process
validation ← metric
render     ← registry
metric     ← counter, gauge, histogram
counter/gauge/histogram ← index
registry   ← index
process    ← index
index      → everything public
```

One direction only. Metric classes share `BaseMetric` (label validation + series
resolution); the registry depends only on `render` and `types`, so rendering can be
tested and reused independently of the metric classes.

## Series model

Each metric holds a `Map` from a **deterministic series key** to the series' state.
The key is built from the normalized (string-coerced) label map with keys sorted, so
`{a,b}` and `{b,a}` map to the same series. Label sets are validated on every call:
exactly the declared `labelNames`, no more, no fewer.

- **Counter** — one number per series; rejects negative increments.
- **Gauge** — one number per series; `set`/`inc`/`dec`, `setToCurrentTime`, and a
  `startTimer` that records elapsed seconds. Time comes from an injectable clock.
- **Histogram** — per series: a cumulative `counts[]` aligned to the configured
  buckets, plus `sum` and `count`. `observe(v)` increments every bucket whose bound is
  `≥ v`. Buckets are validated strictly increasing and finite (`+Inf` is implicit and
  emitted from `count`). `le` is a reserved label.

## Exposition format

`registry.render()` emits, per metric, a `# HELP`/`# TYPE` header followed by sample
lines, newline-delimited with a trailing newline. `render.ts` owns the escaping rules
(HELP: backslash/newline; label values: backslash/quote/newline) and numeric
formatting (`+Inf`/`-Inf`/`NaN`). The content type is the standard
`text/plain; version=0.0.4; charset=utf-8`. Histograms expand into `_bucket{le=…}` (one
per bucket plus `+Inf`), `_sum`, and `_count` samples. Label output order follows the
declared label order (insertion order of the normalized map), so output is stable.

## Design boundaries (honest)

- **No Summary type.** Following Prometheus guidance, histograms (server-aggregatable)
  are provided instead of summaries with client-computed quantiles. Applications that
  truly need quantiles can compute them from histogram buckets.
- **No exemplars / native histograms.** The classic text exposition format is targeted;
  OpenMetrics-only features are out of scope for this foundation package.
- **Pull-based collection.** There is no background sampling timer; every metric's
  current state (including process metrics) is read when the registry renders.

## Extension points

- **Custom collectables** implement `Collectable` (`{ name; collect() }`) and register
  directly — this is exactly how `collectDefaultMetrics` exposes live process values,
  and how a package could expose derived or externally-sourced series.
- **Deterministic time** via the injectable clock on `Gauge`/`Histogram` and the
  injectable `ProcessSource` for default metrics (used throughout the test suite).
- **Downstream StreetJS packages** accept a `Registry` by interface and receive one via
  the `METRICS_REGISTRY` DI token; they depend on `@streetjs/metrics`, never the reverse.

## Testing

`node --test` over real behavior: counter/gauge/histogram arithmetic and series
isolation, label validation (missing/extra/reserved/coercion), deterministic keys,
histogram bucketing/sum/count and timers, bucket validation errors, registry
register/unregister/duplicate/clear, full exposition rendering (headers, escaping,
histogram expansion, empty registry), and default process metrics via an injected
source. Coverage is enforced at ≥90% (`c8 check-coverage`); the declaration-only
`types.ts` is excluded as it emits no executable code.
