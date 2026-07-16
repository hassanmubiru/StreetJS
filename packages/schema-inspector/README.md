# @streetjs/schema-inspector

The StreetJS database schema introspector: produces a unified
`DatabaseSchema` — tables, columns, primary keys, foreign keys, and indexes —
from a live **PostgreSQL**, **MySQL/MariaDB**, or **SQLite** database, with
per-pool TTL caching. ESM, strict-TypeScript.

It talks only through a structural `QueryablePool` interface and routes by the
pool's constructor name, so it has **no dependency on any concrete pool
implementation** — the only dependency is `@streetjs/postgres` for the shared
`DbResult` type.

This is the standalone home of the inspector that also backs the `streetjs`
framework. The framework re-exports this package, so there is a single source of
truth.

## Install

```bash
npm install @streetjs/schema-inspector
```

## Usage

```ts
import { SchemaInspector } from '@streetjs/schema-inspector';

// `pool` can be any object with `query(sql, params?): Promise<DbResult>`
// — PgPool, MysqlPool, and SqlitePool all qualify.
const schema = await SchemaInspector.inspect(pool);

for (const table of schema.tables) {
  console.log(table.name, table.primaryKey, table.columns.length);
}
```

## API

### `SchemaInspector.inspect(pool, opts?): Promise<DatabaseSchema>`

Introspects the database and returns its schema. Results are cached per pool for
`opts.ttlMs` milliseconds (default `60000`). The dialect is detected from the
pool's constructor name (`PgPool` → PostgreSQL, `SqlitePool` → SQLite, anything
else → MySQL/MariaDB).

### `SchemaInspector.invalidateCache(pool): void`

Drops the cached schema for `pool` so the next `inspect` re-fetches.

### Types

```ts
interface DatabaseSchema { tables: TableSchema[]; inspectedAt: Date }
interface TableSchema {
  name: string;
  columns: ColumnMeta[];
  primaryKey: string[];
  foreignKeys: FkMeta[];
  indexes: IndexMeta[];
}
interface ColumnMeta { name: string; type: string; nullable: boolean; default: string | null }
interface FkMeta { column: string; refTable: string; refColumn: string }
interface IndexMeta { name: string; columns: string[]; unique: boolean }
interface QueryablePool { query(sql: string, params?: unknown[]): Promise<DbResult> }
```

## How it works

- **PostgreSQL** — three round-trips against `information_schema` (columns +
  primary keys), `referential_constraints` (foreign keys), and `pg_indexes`
  (indexes, with the column list parsed from `indexdef`).
- **MySQL/MariaDB** — `information_schema.COLUMNS`/`KEY_COLUMN_USAGE`/`STATISTICS`,
  grouping the per-column `STATISTICS` rows into composite indexes.
- **SQLite** — `sqlite_master` for the table list, then `PRAGMA table_info`,
  `index_list`/`index_info`, and `foreign_key_list` per table.

All engines normalize into the same `DatabaseSchema` shape.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/schema-inspector
```

## License

MIT — see [LICENSE](./LICENSE).
