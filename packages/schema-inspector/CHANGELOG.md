# Changelog

All notable changes to `@streetjs/schema-inspector` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS database schema introspector,
  extracted from the `streetjs` core (`src/database/schema-inspector.ts`).
- `SchemaInspector.inspect(pool, opts?)` returning a unified `DatabaseSchema`
  (tables, columns, primary keys, foreign keys, indexes) for PostgreSQL,
  MySQL/MariaDB, and SQLite, with per-pool TTL caching (default 60s).
- `SchemaInspector.invalidateCache(pool)`.
- Public types: `DatabaseSchema`, `TableSchema`, `ColumnMeta`, `FkMeta`,
  `IndexMeta`, and the structural `QueryablePool` interface.
- Decoupled from concrete pools: routes by `constructor.name` and depends only on
  `@streetjs/postgres` for the shared `DbResult` type. ESM.
- 14 tests (no live database required), 100% line coverage, and a runnable
  example. During extraction the public signature was generalized from
  `PgPool | SqlitePool | QueryablePool` to `QueryablePool`; both `PgPool` and
  `SqlitePool` satisfy it structurally, so existing callers are unaffected.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/schema-inspector-v1.0.0
