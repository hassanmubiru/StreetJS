# Changelog

All notable changes to `@streetjs/metrics` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/metrics` — the StreetJS metrics foundation.
- Prometheus-compatible metric types: `Counter` (monotonic), `Gauge`
  (up/down, `setToCurrentTime`, `startTimer`), and `Histogram` (cumulative
  buckets with `_sum`/`_count`, configurable buckets, `startTimer`).
- Labels with strict validation (exact declared set, name rules, reserved-name
  and reserved `le` checks), value coercion, and deterministic, order-independent
  series keys.
- `MetricsRegistry` with `register`/`unregister`/`get`/`collect`/`render`/`clear`,
  a `defaultRegistry`, and the standard `text/plain; version=0.0.4` content type.
- Prometheus text exposition rendering with correct HELP/label escaping, numeric
  formatting (`+Inf`/`-Inf`/`NaN`), and histogram expansion.
- Optional default process metrics (`collectDefaultMetrics`): resident/heap/external
  memory, CPU seconds, start time, and uptime — pull-based with an injectable source.
- Injectable clock for gauges/histograms and a `METRICS_REGISTRY` dependency-injection
  token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (49 tests) with ≥90% enforced coverage.
