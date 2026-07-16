# Changelog

All notable changes to `@streetjs/router` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS router, extracted verbatim from the
  `streetjs` core (`src/router/router.ts`).
- `Router` with compiled-regex matching, path-param extraction/decoding, wildcard
  paths and methods, a recursive middleware pipeline, and `listRoutes`.
- Registration-time baking of `@Roles`/`@Permissions` (onto `ctx.state`) and
  `@RateLimit` (per-route limiter keyed by IP / user / API key).
- Request validation over `body`/`query`/`params` via `ValidationSchema` /
  `FieldRule` (now owned by this package; the framework core re-exports them).
- Optional latency profiling through a structural `RouteProfiler` interface.
- `notFoundHandler` and a leak-safe `errorHandler` (StreetException → status +
  JSON; unknown → reported via `@streetjs/diagnostics` + generic 500).
- Runs on `@streetjs/context` (^1.1.0), `@streetjs/exceptions`,
  `@streetjs/diagnostics`, `@streetjs/ratelimit`, and `reflect-metadata`; ESM.
- 21 tests (no server required) and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/router-v1.0.0
