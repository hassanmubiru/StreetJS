# Architecture — @streetjs/migrations

## Purpose

`@streetjs/migrations` provides the two halves of StreetJS schema management: a
file-based **migration runner** and a metadata-driven **schema differ**. It sits
above the connection pool and the schema introspector and is consumed by core's
CLI and bootstrap.

## Dependencies

```
@streetjs/pool             (PgPool — the transactional data source for the runner)
@streetjs/schema-inspector (live schema introspection for the differ + QueryablePool)
@streetjs/container        (@Injectable so the runner is DI-resolvable)
reflect-metadata           (reads the street:* entity metadata keys)
```

No cyclic dependencies — every dependency is lower in the graph.

## Design

### StreetMigrationRunner

An `@Injectable` class constructed with a `PgPool`. `run(dir)`:

1. Ensures the `street_migrations` tracking table exists.
2. Reads applied migration names from the table.
3. Lists `*.sql` files (excluding `*.rollback.sql`), filtered by a strict
   filename pattern, sorted lexicographically (= timestamp order).
4. For each not-yet-applied file, executes the SQL and inserts the tracking row
   **inside a single transaction**, so a failed migration rolls back cleanly.

`rollback(dir, steps)` reverses the most recent `steps` migrations by running the
corresponding `*.rollback.sql` and deleting the tracking row, again per
transaction.

**Path-traversal safety** is enforced twice: filenames must match
`^[A-Za-z0-9][A-Za-z0-9_\-.]*\.sql$`, and the joined path is re-resolved and
checked to still live inside the migrations directory.

### MigrationDiffer

A pure static differ. `diff(pool, entities)`:

1. Invalidates the inspector cache and reads the **live schema** (`ttlMs: 0`).
2. For each entity, resolves its table name (from `street:table`, a static
   `tableName`, or the lowercased class name) and reads its columns, indexes, and
   primary key from the `street:*` Reflect metadata.
3. Emits DDL into **safe** and **destructive** buckets by comparing entity intent
   to the live schema (see the README table).

**Injection defense:** every identifier (`SAFE_IDENTIFIER`), SQL type
(`SAFE_SQL_TYPE`), and default expression (`SAFE_DEFAULT`) coming from metadata is
validated before it is rendered into DDL. **Type churn** is suppressed via
`canonicalType` (uppercasing, stripping size specifiers, and mapping synonyms
like `INT`↔`INTEGER`), so cross-dialect equivalents don't produce spurious
`ALTER COLUMN` statements. **Framework tables** (`street_*`, `sqlite_*`) are never
proposed for `DROP`.

## Testing

The suite runs with **no live database**:

- The differ is driven by a fake `QueryablePool` named `PgPool` (so the inspector
  routes down the Postgres path) plus entity classes carrying `Reflect`
  metadata — covering CREATE/ADD/ALTER/DROP classification, synonym suppression,
  framework-table protection, name fallback, and metadata-injection rejection.
- The runner is exercised against a fake transactional pool and **real `.sql`
  files written to an OS temp directory** (`mkdtemp`), covering ordered
  application, idempotent skipping, a missing directory, rollback, and a missing
  rollback file.

Coverage is ≥98% lines/functions and ≥90% branches (declared floor 88%; a few
defensive path-escape branches are hard to reach and documented rather than
force-covered).

## Non-goals

- No DDL for altering primary keys or foreign keys in place (proposes table-level
  changes only).
- No data migrations — SQL files own any data transforms.
- No engine detection beyond what `@streetjs/schema-inspector` provides.
