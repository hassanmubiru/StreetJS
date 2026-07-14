y# Changelog

All notable changes to `@streetjs/tracing` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/tracing` — the StreetJS tracing foundation.
- Spans with attributes, timed events, status, `recordException`, `updateName`, and an
  idempotent `end`; non-recording (unsampled) spans are cheap no-ops that still carry a
  valid context.
- `createTracer` with `startSpan` and `startActiveSpan` (async-context active spans via
  `AsyncLocalStorage`; automatic end + error recording, sync and async).
- W3C Trace Context propagation: `parseTraceParent`/`formatTraceParent`, `extractContext`/
  `injectContext`, and sampled-flag helpers.
- Samplers: `alwaysOnSampler`, `alwaysOffSampler`, `parentBasedSampler`,
  `traceIdRatioSampler` (deterministic by trace id).
- Exporters/processors: `InMemorySpanExporter`, `ConsoleSpanExporter`,
  `SimpleSpanProcessor`, and `noopSpanProcessor` (the default).
- Cryptographically-random id generation with validation; injectable id generator and
  clock for deterministic tests; a `TRACER` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (27 tests) with ≥90% enforced coverage.
