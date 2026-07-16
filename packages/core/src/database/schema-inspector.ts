// src/database/schema-inspector.ts
// Database schema introspection for PostgreSQL, MySQL, and SQLite.
//
// The implementation now lives in the standalone `@streetjs/schema-inspector`
// package (dependency-light: routes by pool constructor name via the structural
// QueryablePool interface). This module re-exports it verbatim so every internal
// importer and the public `streetjs` API keep working against a single source of
// truth — no duplication, no shim.

export { SchemaInspector } from '@streetjs/schema-inspector';
export type {
  ColumnMeta,
  IndexMeta,
  FkMeta,
  TableSchema,
  DatabaseSchema,
  QueryablePool,
} from '@streetjs/schema-inspector';
