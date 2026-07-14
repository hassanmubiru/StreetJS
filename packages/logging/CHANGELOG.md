# Changelog

All notable changes to `@streetjs/logging` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/logging` — the StreetJS logging foundation.
- Structured, level-based logging (`trace`/`debug`/`info`/`warn`/`error`/`fatal`,
  plus `silent`) with runtime `setLevel` and `isLevelEnabled`.
- Ergonomic call styles: message-only, fields + message, fields-only, and
  error-first (`Error` → serialized `{ err }` with a default message).
- Child loggers with shallow-merged bound context; children are isolated from the
  parent (bindings and level).
- Automatic secret redaction before any transport sees a record: a built-in
  case-insensitive key set, user-supplied keys, and exact dotted paths with `*`
  wildcards; a custom censor string; or a fully custom `Redactor`.
- Safe serialization: errors (with `cause` chains and own properties), circular
  references (`[Circular]`), depth bounding, `Date`/`BigInt`/typed arrays/`toJSON`.
- Pluggable transports: `ConsoleTransport` (JSON or pretty, optional colors, optional
  stderr routing), `StreamTransport`, `MemoryTransport` (for tests), and
  `MultiTransport` fan-out. Transport failures are isolated via an `onError` handler.
- Timers (`startTimer().done()/elapsed()`) that log `durationMs`.
- Injectable `Clock` for deterministic tests and a `LOGGER` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (68 tests) with ≥90% enforced coverage.
