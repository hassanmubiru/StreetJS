# Changelog

All notable changes to `@streetjs/migrations` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS migration tooling, extracted
  verbatim from the `streetjs` core (`src/database/migrations.ts`).
- `StreetMigrationRunner`: ordered, idempotent, transactional `.sql` migrations
  tracked in a `street_migrations` table, with `run` and `rollback`, strict
  filename validation, and path-traversal protection.
- `MigrationDiffer`: safe/destructive DDL diff of entity metadata against the
  live schema (via `@streetjs/schema-inspector`), with SQL-identifier/type/default
  validation, cross-dialect type-synonym normalization, and framework-table
  (`street_*`/`sqlite_*`) drop protection.
- Public types: `MigrationDiff`, `EntityColumnMeta`, `EntityIndexMeta`.
- Runs on `@streetjs/pool`, `@streetjs/schema-inspector`, `@streetjs/container`,
  and `reflect-metadata`; ESM. 16 tests (no live database) and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/migrations-v1.0.0
