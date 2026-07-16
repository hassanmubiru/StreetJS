// src/database/migrations.ts
// Ordered, idempotent SQL migration runner with tracking table + schema differ.
//
// The implementation now lives in the standalone `@streetjs/migrations` package
// (built on @streetjs/pool + @streetjs/schema-inspector + @streetjs/container).
// This module re-exports it verbatim so every internal `../database/migrations.js`
// importer and the public `streetjs` API keep working against a single source of
// truth — no duplication, no shim.

export { StreetMigrationRunner, MigrationDiffer } from '@streetjs/migrations';
export type {
  MigrationDiff,
  EntityColumnMeta,
  EntityIndexMeta,
} from '@streetjs/migrations';
