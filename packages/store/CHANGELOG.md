# Changelog

All notable changes to `@streetjs/store` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS backing-store abstractions,
  extracted verbatim from the `streetjs` core (`src/security/store.ts`).
- Interfaces: `KeyValueStore`, `CounterStore`, `RateLimitStore`, and the `Clock`
  now-provider type with a `systemClock` default.
- In-memory implementations: `InMemoryRateLimitStore` (bounded sliding window
  with `maxKeys`/`maxRequestsPerKey` caps and an optional retention sweep),
  `InMemoryCounterStore`, and `InMemoryKeyValueStore` (lazy TTL).
- Fully deterministic under an injected clock; zero runtime dependencies; ESM;
  `browser` export condition.
- 12 tests, 100% line coverage, and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/store-v1.0.0
