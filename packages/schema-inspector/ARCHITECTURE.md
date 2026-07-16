# Architecture — @streetjs/schema-inspector

## Purpose

`@streetjs/schema-inspector` turns a live database connection into a normalized,
engine-agnostic `DatabaseSchema`. It is the introspection layer the migration
differ and dev tooling build on. It is deliberately decoupled from any concrete
connection pool: it speaks only the structural `QueryablePool` interface and
routes by the pool's constructor name.

## Dependencies

```
@streetjs/postgres   (the shared DbResult result type only)
```

That is the sole dependency, and it is used purely for the `DbResult` type that
`QueryablePool.query` resolves to. No cyclic dependencies; no coupling to
`@streetjs/pool`, the wasm SQLite module, or any MySQL driver.

## Design

### Structural pool interface

```ts
interface QueryablePool { query(sql: string, params?: unknown[]): Promise<DbResult> }
```

`PgPool`, `MysqlPool`, and `SqlitePool` all satisfy this structurally, so the
inspector never imports a concrete class. Dialect selection is by
`pool.constructor.name`:

- `SqlitePool` → PRAGMA-based introspection;
- `PgPool` → `information_schema` + `pg_indexes`;
- anything else → MySQL/MariaDB `information_schema`.

This name-based routing is what lets the package stay dependency-light: the
concrete pools live in other packages/core, but the inspector only needs their
runtime `query` method.

### Normalization

Each engine path issues a small, fixed set of catalogue queries and folds the
rows into a `Map<tableName, TableSchema>`:

- **Postgres** parses index column lists out of the `indexdef` DDL string and
  treats `is_pk` values of `'t'`/`'true'` as primary-key membership.
- **MySQL** groups the one-row-per-column `STATISTICS` output into composite
  `IndexMeta` and reads `NON_UNIQUE = '0'` as unique.
- **SQLite** reads `PRAGMA table_info` for columns/PK (sorted by the `pk`
  position for composite keys), `foreign_key_list` for FKs, and
  `index_list` + `index_info` for indexes.

All values arrive as strings (matching the text-protocol/affinity semantics of
`DbResult`), so parsing is uniform and every field access is defended with a
fallback (`?? ''` / `?? null`).

### Caching

`inspect` caches the resulting `DatabaseSchema` per pool object (a
`Map<object, { schema, expiresAt }>`) for a configurable TTL (default 60s).
`invalidateCache(pool)` drops the entry to force a fresh read. The cache is keyed
by object identity, so distinct pools never collide.

## Testing

The suite runs with **no live database** by supplying fake `QueryablePool`
objects whose `constructor.name` is `PgPool`/`SqlitePool`/`MysqlPool`, driving
each dialect path with canned catalogue rows. It covers primary keys (including
composite and the `'t'`/`'true'` encodings), foreign keys, unique/non-unique and
multi-column index parsing, quoted-identifier stripping, empty databases,
per-field fallbacks for sparse rows, and the full cache/TTL/invalidation
lifecycle. Coverage is 100% lines/functions and ≥98% branches.

## Non-goals

- No DDL generation or migration diffing (that is the migration layer).
- No connection management (that is `@streetjs/pool` / the SQLite pool).
- No data reads beyond catalogue introspection.
