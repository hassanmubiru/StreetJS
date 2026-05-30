// src/database/migrations.ts
// Ordered, idempotent SQL migration runner with tracking table.

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { PgPool } from './pool.js';
import { Injectable } from '../core/container.js';

const MIGRATIONS_TABLE = 'street_migrations';

// Finding 5 fix: safe filename pattern — no path separators, no dotdot
const SAFE_MIGRATION_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9_\-.]*\.sql$/;

/**
 * Resolve and validate that `dir` is an absolute path and that every
 * migration file stays within it (prevents path traversal).
 */
function resolveAndValidateDir(dir: string): string {
  const resolved = resolve(dir);
  return resolved;
}

function assertFileWithinDir(dir: string, filename: string): string {
  // Filename must match safe pattern — no slashes, no dotdot
  if (!SAFE_MIGRATION_FILENAME.test(filename)) {
    throw new Error(`Unsafe migration filename rejected: ${filename}`);
  }
  const fullPath = join(dir, filename);
  // Double-check the resolved path is still inside the directory
  const resolvedFull = resolve(fullPath);
  if (!resolvedFull.startsWith(dir + sep) && resolvedFull !== dir) {
    throw new Error(`Migration file escapes migrations directory: ${filename}`);
  }
  return resolvedFull;
}

@Injectable()
export class StreetMigrationRunner {
  constructor(private readonly pool: PgPool) {}

  /** Run all pending migrations from the migrations directory */
  async run(migrationsDir: string): Promise<void> {
    // Finding 5 fix: resolve and validate the directory path
    const safeDir = resolveAndValidateDir(migrationsDir);

    await this._ensureTable();

    const appliedSet = await this._getApplied();
    const files = await this._getMigrationFiles(safeDir);

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`[migrations] Skipping already applied: ${file}`);
        continue;
      }

      // Finding 5 fix: validate each filename before constructing the path
      const fullPath = assertFileWithinDir(safeDir, file);
      const sql = await readFile(fullPath, 'utf8');

      console.log(`[migrations] Applying: ${file}`);

      await this.pool.transaction(async (conn) => {
        await conn.query(sql);
        await conn.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (name, applied_at) VALUES ($1, NOW())`,
          [file]
        );
      });

      console.log(`[migrations] Applied: ${file}`);
    }

    console.log('[migrations] All migrations complete.');
  }

  /** Rollback the last N migrations (requires rollback SQL files) */
  async rollback(migrationsDir: string, steps = 1): Promise<void> {
    // Finding 5 fix: resolve and validate the directory path
    const safeDir = resolveAndValidateDir(migrationsDir);

    const applied = await this._getAppliedOrdered();
    const toRollback = applied.slice(-steps).reverse();

    for (const name of toRollback) {
      const rollbackFile = name.replace(/\.sql$/, '.rollback.sql');

      // Finding 5 fix: validate rollback filename too
      const fullPath = assertFileWithinDir(safeDir, rollbackFile);

      let sql: string;
      try {
        sql = await readFile(fullPath, 'utf8');
      } catch {
        throw new Error(`Rollback file not found: ${rollbackFile}`);
      }

      console.log(`[migrations] Rolling back: ${name}`);
      await this.pool.transaction(async (conn) => {
        await conn.query(sql);
        await conn.query(
          `DELETE FROM ${MIGRATIONS_TABLE} WHERE name = $1`,
          [name]
        );
      });

      console.log(`[migrations] Rolled back: ${name}`);
    }
  }

  private async _ensureTable(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(255) NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      )
    `);
  }

  private async _getApplied(): Promise<Set<string>> {
    const result = await this.pool.query(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC`
    );
    return new Set(result.rows.map((r) => r['name'] ?? '').filter(Boolean));
  }

  private async _getAppliedOrdered(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY applied_at ASC`
    );
    return result.rows.map((r) => r['name'] ?? '').filter(Boolean);
  }

  private async _getMigrationFiles(dir: string): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      console.warn(`[migrations] Directory not found: ${dir}`);
      return [];
    }

    return entries
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.rollback.sql') && SAFE_MIGRATION_FILENAME.test(f))
      .sort(); // lexicographic = timestamp order
  }
}
