# Changelog

All notable changes to `@streetjs/postgres` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-15

### Added

- Initial release of `@streetjs/postgres` — the StreetJS PostgreSQL driver, extracted
  from `streetjs` core as the single source of truth (core re-exports the wire driver,
  the streaming reader, the HA client, and the `DbResult` type; the pool/repository/
  migrations and SQLite/wasm engine stay in core and consume this driver).
- `PgConnection`: dependency-free PostgreSQL wire-protocol client — SCRAM-SHA-256 auth,
  extended query protocol with server-side parameter binding, and a `DbResult` shape.
- `StreetPostgresWireStream`: object-mode streaming result reader with backpressure.
- `PgHaClient`: high-availability client — multi-host `pg_is_in_recovery()` discovery,
  role-targeted routing (`primary`/`prefer-replica`/`any`), per-attempt query timeout,
  and transparent failover (re-discover + retry) that picks up a promoted primary.
- `POSTGRES` dependency-injection token; full type surface (`PgRow`, `PgResult`,
  `DbResult`, `PgConnectOptions`, `PgHaOptions`, `PgHaHost`, `PgTarget`).
- Zero runtime dependencies (Node core only). Strict TypeScript, ESM, tree-shakeable.
- Server-free test suite (100 tests: mock-socket wire protocol, streaming, mocked HA
  discovery/routing/failover). Coverage floors (lines/statements ≥ 75, functions ≥ 75,
  branches ≥ 72) reflect that live-TCP connect/auth paths are validated by core's live
  integration test and dogfooding rather than the CI-safe unit suite.
