# Changelog

All notable changes to `@streetjs/diagnostics` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS diagnostics reporter, extracted
  verbatim from the `streetjs` core (`src/diagnostics/reporter.ts`).
- `DiagnosticsReporter` (an `EventEmitter`) with `report(err, correlationId?)`
  that classifies Error/string/unknown values, cleans stack traces (stripping
  Node-internal frames), emits a `'diagnostic'` event, and writes a JSON line to
  stderr.
- Shared `diagnosticsReporter` singleton and the `DiagnosticEvent` type.
- Zero runtime dependencies (Node core only); ESM; `browser` export condition.
- 9 tests, 100% line coverage, and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/diagnostics-v1.0.0
