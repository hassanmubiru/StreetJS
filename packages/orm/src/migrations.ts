// packages/orm/src/migrations.ts
// Model-driven migrations: diff entity metadata against the live database schema
// and emit up/down SQL. The diff/SQL emitter (`planMigration`) is a pure function
// — fully offline-verifiable. Identifiers and SQL types come only from validated
// decorator metadata; no user input reaches the generated SQL.

import { type EntityMeta, OrmError, isSafeIdentifier, isSafeSqlType } from './metadata.js';
import type { QueryablePool } from './repository.js';

export interface ExistingSchema {
  tableExists: boolean;
  columns: string[]; // existing column names (when the table exists)
}

export interface MigrationPlan {
  up: string[];
  down: string[];
}

export interface MigrationOptions {
  /** When true, columns present in the DB but absent from the model are dropped. Default false (additive). */
  dropColumns?: boolean;
}

function q(ident: string): string {
  if (!isSafeIdentifier(ident)) throw new OrmError(`unsafe identifier: ${JSON.stringify(ident)}`);
  return `"${ident}"`;
}
function typ(t: string): string {
  if (!isSafeSqlType(t)) throw new OrmError(`unsafe SQL type: ${JSON.stringify(t)}`);
  return t;
}

/**
 * Compute the migration to bring `existing` in line with `meta`. Pure.
 * - Table missing → CREATE TABLE (down: DROP TABLE).
 * - Table present → ADD COLUMN for model columns missing in the DB (down: DROP).
 *   With `dropColumns`, also DROP columns in the DB that the model no longer has.
 */
export function planMigration(meta: EntityMeta, existing: ExistingSchema, opts: MigrationOptions = {}): MigrationPlan {
  if (!existing.tableExists) {
    const cols = meta.columns
      .map((c) => `${q(c.column)} ${typ(c.sqlType)}${c.primary ? ' PRIMARY KEY' : ''}`)
      .join(', ');
    return { up: [`CREATE TABLE ${q(meta.table)} (${cols})`], down: [`DROP TABLE ${q(meta.table)}`] };
  }

  const existingSet = new Set(existing.columns);
  const modelSet = new Set(meta.columns.map((c) => c.column));
  const up: string[] = [];
  const down: string[] = [];

  for (const c of meta.columns) {
    if (!existingSet.has(c.column)) {
      up.push(`ALTER TABLE ${q(meta.table)} ADD COLUMN ${q(c.column)} ${typ(c.sqlType)}`);
      down.push(`ALTER TABLE ${q(meta.table)} DROP COLUMN ${q(c.column)}`);
    }
  }

  if (opts.dropColumns) {
    for (const col of existing.columns) {
      if (!modelSet.has(col)) {
        up.push(`ALTER TABLE ${q(meta.table)} DROP COLUMN ${q(col)}`);
        // The dropped column's type is unknown from the model, so `down` is a
        // documented manual step rather than a silently-wrong reversal.
        down.push(`-- manual: re-add dropped column ${q(col)} to ${q(meta.table)} (type unknown to the model)`);
      }
    }
  }

  return { up, down };
}

/** Introspect a table's existence and columns from information_schema (PostgreSQL). */
export async function introspectSchema(pool: QueryablePool, table: string): Promise<ExistingSchema> {
  if (!isSafeIdentifier(table)) throw new OrmError(`unsafe table name: ${JSON.stringify(table)}`);
  const t = await pool.query(
    'SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1 LIMIT 1',
    [table],
  );
  if (t.rows.length === 0) return { tableExists: false, columns: [] };
  const c = await pool.query(
    'SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1',
    [table],
  );
  return { tableExists: true, columns: c.rows.map((r) => String(r['column_name'])) };
}
