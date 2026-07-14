# Changelog

All notable changes to `@streetjs/health` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/health` — the StreetJS health foundation.
- `HealthRegistry` with `register`/`unregister`/`get`/`list`/`clear`, `run(kind?)`, and
  `liveness()`/`readiness()`/`startup()` shortcuts.
- Checks as sync or async functions: return nothing (pass), return a `CheckResult`
  (status/output/observedValue/observedUnit + extra details), or throw (fail).
- Per-check timeouts (default 5s) via an unref'd timer, criticality (default true), and
  a `kind` (liveness/readiness/startup, default readiness).
- Status aggregation where a non-critical failure degrades to `warn` while a critical
  failure is `fail`; HTTP mapping (`fail → 503`, otherwise `200`).
- IETF `health+json` reporting (`buildReport`) and a transport-agnostic
  `endpoint(kind?)` / `toEndpointResponse` returning `{ statusCode, contentType, body, report }`.
- Injectable clock and a `HEALTH_REGISTRY` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (23 tests) with ≥90% enforced coverage.
