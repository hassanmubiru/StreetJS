# Changelog

All notable changes to `@streetjs/telemetry` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-15

### Added

- Initial release of `@streetjs/telemetry` — the StreetJS in-process telemetry foundation,
  extracted from `streetjs` core as the single source of truth (core re-exports the
  `TelemetryTracker` and `TelemetrySample`, and keeps the framework-coupled
  `telemetryMiddleware`).
- `TelemetryTracker`: bounded ring-buffer retention (1440 samples / 10 000 latencies),
  `recordRequest` counters, `snapshot()` with heap/RSS and p50/p99 latency, `getHistory()`,
  and a `health()` summary; `unref`'d background collector with `destroy()`.
- `TelemetrySample` type; `TELEMETRY_TRACKER` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Test suite (8 tests); enforced coverage (lines/functions/statements ≥ 90, branches ≥ 80).
