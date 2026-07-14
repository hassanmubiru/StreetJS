# Changelog

All notable changes to `@streetjs/cache` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/cache` — the StreetJS in-memory cache foundation,
  extracted from `streetjs` core as the single source of truth (core now re-exports it
  via dependency inversion; no duplication).
- `LruCache<K, V>` — a bounded LRU cache with per-entry TTL and O(1)
  `get`/`set`/`delete`/`has` via a `Map` + intrusive doubly-linked list.
- Lazy expiry on access plus an optional unref'd background sweep (`autoSweep`).
- Injectable `clock` for deterministic TTL tests; `destroy()` to stop the sweep timer.
- A `CACHE` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (13 tests) with ≥90% enforced coverage.
