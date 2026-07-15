# Changelog

All notable changes to `@streetjs/pool` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS PostgreSQL connection pool,
  extracted verbatim from the `streetjs` core (`src/database/pool.ts`).
- `PgPool` with lazy, idempotent, retryable warm-up; bounded growth to
  `maxConnections`; a backpressure wait queue with `acquireTimeoutMs`; automatic
  dead-connection detection and replacement; and idle sweeping.
- Convenience wrappers `query`, `transaction` (BEGIN/COMMIT, ROLLBACK on throw),
  and `stream` with automatic acquire/release.
- `pool:exhausted` lifecycle event and the `onPoolExhausted` subscription helper.
- Observability getters: `size`, `idle`, `waiting`, `avgAcquireMs`.
- `ECONNREFUSED` translated to a `DatabaseConnectionError` with an operator hint.
- Registered as `@Injectable` for resolution via `@streetjs/container`.
- Runs on `@streetjs/postgres`, `@streetjs/container`, and `@streetjs/exceptions`;
  ESM. 21 tests (no live database required) with a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/pool-v1.0.0
