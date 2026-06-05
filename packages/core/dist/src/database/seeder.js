// src/database/seeder.ts
// StreetSeeder — idempotent seed runner that tracks applied seeds by content hash.
//
// Seeds are tracked in `street_seed_runs`:
//   CREATE TABLE IF NOT EXISTS street_seed_runs (
//     name       TEXT NOT NULL,
//     hash       TEXT PRIMARY KEY,
//     applied_at TIMESTAMPTZ DEFAULT NOW()
//   )
//
// A seed is only executed once; re-running a file whose content SHA-256 hash is
// already recorded is a no-op (idempotent). Execution and recording both happen
// inside a single `pool.transaction()` so a failed seed leaves no tracking row.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve, sep } from 'node:path';
// Safe seed filename pattern — consistent with SAFE_MIGRATION_FILENAME in
// migrations.ts: must start alphanumeric, contain no path separators or `..`,
// and end in `.sql`.
const SAFE_SEED_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9_\-.]*\.sql$/;
/**
 * Validate a seed file path for safety (consistent with migrations.ts):
 *  - the basename must match the safe filename pattern (no separators, no `..`)
 *  - the resolved path must stay within its parent directory (no traversal)
 *
 * @returns the validated absolute path and the bare filename to record.
 */
function assertSafeSeedFile(seedFile) {
    const name = basename(seedFile);
    if (!SAFE_SEED_FILENAME.test(name)) {
        throw new Error(`Unsafe seed filename rejected: ${name}`);
    }
    const dir = resolve(dirname(seedFile));
    const fullPath = resolve(join(dir, name));
    // Double-check the resolved path is still inside its parent directory.
    if (!fullPath.startsWith(dir + sep) && fullPath !== dir) {
        throw new Error(`Seed file escapes its directory: ${name}`);
    }
    return { path: fullPath, name };
}
/** DDL for the seed tracking table (PostgreSQL / generic). */
const SEED_RUNS_DDL = `
  CREATE TABLE IF NOT EXISTS street_seed_runs (
    name       TEXT NOT NULL,
    hash       TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )
`.trim();
// SQLite does not have TIMESTAMPTZ; use a variant that works on SQLite.
const SEED_RUNS_DDL_SQLITE = `
  CREATE TABLE IF NOT EXISTS street_seed_runs (
    name       TEXT NOT NULL,
    hash       TEXT PRIMARY KEY,
    applied_at TEXT DEFAULT (datetime('now'))
  )
`.trim();
export class StreetSeeder {
    /**
     * Run a seed file against `pool`.
     *
     * - Validates the seed filename (rejecting path traversal / unsafe names).
     * - Reads the file content and computes a SHA-256 hash of it.
     * - If the hash is already recorded in `street_seed_runs`, the seed is skipped.
     * - Otherwise executes the SQL inside `pool.transaction()` and records the
     *   filename + hash in the same transaction (so a failed seed records nothing).
     *
     * @param pool     Any pool that satisfies SeedablePool.
     * @param seedFile Absolute (or relative-to-cwd) path to the `.sql` seed file.
     * @returns        `{ skipped, hash, name }` describing what happened.
     */
    static async run(pool, seedFile) {
        const { path, name } = assertSafeSeedFile(seedFile);
        const content = await readFile(path, 'utf8');
        const hash = createHash('sha256').update(content, 'utf8').digest('hex');
        // Detect SQLite pool by constructor name to pick compatible DDL and
        // parameter-placeholder syntax (SQLite uses `?`, PostgreSQL uses `$n`).
        const isSqlite = pool !== null &&
            typeof pool === 'object' &&
            pool.constructor.name === 'SqlitePool';
        // Ensure the tracking table exists.
        await pool.query(isSqlite ? SEED_RUNS_DDL_SQLITE : SEED_RUNS_DDL);
        // Skip if this content hash has already been applied (idempotent).
        const selectSql = isSqlite
            ? 'SELECT name FROM street_seed_runs WHERE hash = ?'
            : 'SELECT name FROM street_seed_runs WHERE hash = $1';
        const check = await pool.query(selectSql, [hash]);
        if (check.rows.length > 0) {
            return { skipped: true, hash, name };
        }
        // Execute the seed and record the run atomically.
        const insertSql = isSqlite
            ? 'INSERT INTO street_seed_runs (name, hash) VALUES (?, ?)'
            : 'INSERT INTO street_seed_runs (name, hash) VALUES ($1, $2)';
        await pool.transaction(async (conn) => {
            const exec = typeof conn === 'function'
                ? conn
                : (sql, params) => conn.query(sql, params);
            // Execute the seed SQL (may contain multiple statements separated by `;`).
            await exec(content);
            // Record the run (filename + hash) within the same transaction.
            await exec(insertSql, [name, hash]);
        });
        return { skipped: false, hash, name };
    }
}
//# sourceMappingURL=seeder.js.map