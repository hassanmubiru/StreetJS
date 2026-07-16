/**
 * @streetjs/schema-inspector — the StreetJS database schema introspector.
 *
 * Produces a unified {@link DatabaseSchema} — tables, columns, primary keys,
 * foreign keys, and indexes — from a live PostgreSQL, MySQL/MariaDB, or SQLite
 * database, with per-pool TTL caching. It routes by the pool's constructor name
 * and talks only through the structural {@link QueryablePool} interface, so it
 * has no dependency on any concrete pool implementation. Public API only.
 *
 * ```ts
 * import { SchemaInspector } from '@streetjs/schema-inspector';
 *
 * const schema = await SchemaInspector.inspect(pool); // any queryable pool
 * for (const table of schema.tables) console.log(table.name, table.columns.length);
 * ```
 *
 * > This is the standalone home of the inspector that also backs the `streetjs`
 * > framework; the framework re-exports it, so there is a single implementation.
 */

export { SchemaInspector } from './schema-inspector.js';
export type {
  ColumnMeta,
  IndexMeta,
  FkMeta,
  TableSchema,
  DatabaseSchema,
  QueryablePool,
} from './schema-inspector.js';
