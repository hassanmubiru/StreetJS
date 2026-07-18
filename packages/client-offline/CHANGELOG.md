# Changelog

All notable changes to `@streetjs/client-offline` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial release of the StreetJS offline-first client primitives.
- `OfflineCache` — read-through cache with per-entry TTL and stale-on-error
  (`get`/`peek`/`set`/`invalidate`), backed by a pluggable `OfflineStore`.
- `MutationQueue` — durable, FIFO, ordering-safe mutation outbox with
  de-duplication, retry, `maxAttempts` drop, `onDrop`, and a re-entrancy guard;
  `enqueue`/`flush`/`list`/`size`/`clear`.
- `OfflineStore` contract + `MemoryOfflineStore` default (wrap
  localStorage/IndexedDB/AsyncStorage for persistence).
- Transport-agnostic (injected `fetcher`/`sender`) and deterministic under an
  injected clock; zero runtime dependencies; ESM; `browser` export condition.
- 14 tests, ≥98% line coverage, and a runnable offline→online example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/client-offline-v1.0.0
