# Changelog

All notable changes to `@streetjs/ratelimit` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS rate limiter, extracted verbatim
  from the `streetjs` core (`src/security/ratelimit.ts`).
- `RateLimiter` class: hrtime-precise sliding window, bounded per-key log,
  half-window sweep, proxy-aware key resolution, and `X-RateLimit-*` headers.
- `rateLimit` scoped middleware factory: `global`/`ip`/`user` scopes over a
  pluggable `RateLimitStore`, injectable clock, and window recovery.
- `@RateLimit` method decorator + `getRateLimitMeta`.
- `parseWindow` human-readable duration parser (ReDoS-safe).
- `RateLimitException` (HTTP 429) and `RedisRateLimitStore` for cross-instance
  enforcement via a sorted set per key.
- Runs on `@streetjs/context` (^1.1.0, for `StreetContext` + `MiddlewareFn`),
  `@streetjs/exceptions`, `@streetjs/store`, and `reflect-metadata`; ESM.
- 20 tests (no server/Redis required) and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/ratelimit-v1.0.0
