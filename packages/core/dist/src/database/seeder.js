// src/database/seeder.ts
// StreetSeeder — idempotent seed runner that tracks applied seeds by content hash.
//
// Seeds are tracked in `street_seed_runs`:
//   CREATE TABLE IF NOT EXISTS street_seed_runs (
//     id         TEXT PRIMARY KEY,
//     hash       TEXT NOT NULL,
//     applied_at TIMESTAMPTZ DEFAULT NOW()
//   )
//
// A seed is only executed once; re-running the same file is a no-op if the
// SHA-256 hash of its content is already recorded.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
/** DDL for the seed tracking table */
const SEED_RUNS_DDL = `
  CREATE TABLE IF NOT EXISTS street_seed_runs (
    id         TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )
`.trim();
// SQLite does not have TIMESTAMPTZ; use a variant that works on both.
const SEED_RUNS_DDL_SQLITE = `
  CREATE TABLE IF NOT EXISTS street_seed_runs (
    id         TEXT PRIMARY KEY,
    hash       TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )
`.trim();
export class StreetSeeder {
    /**
     * Run a seed file against `pool`.
     *
     * - Reads the file at `seedFile` path.
     * - Computes a SHA-256 hash of the file content.
     * - If the hash is already in `street_seed_runs`, the seed is skipped.
     * - Otherwise, executes the SQL inside a transaction and records the hash.
     *
     * @param pool     Any pool that satisfies SeedablePool.
     * @param seedFile Absolute (or relative-to-cwd) path to the .sql seed file.
     * @returns        `{ skipped: boolean, hash: string }` describing what happened.
     */
    static async run(pool, seedFile) {
        const content = await readFile(seedFile, 'utf8');
        const hash = createHash('sha256').update(content, 'utf8').digest('hex');
        const id = `seed:${hash}`;
        // Detect SQLite pool by constructor name to use compatible DDL
        const isSqlite = pool !== null &&
            typeof pool === 'object' &&
            pool.constructor.name === 'SqlitePool';
        const ddl = isSqlite ? SEED_RUNS_DDL_SQLITE : SEED_RUNS_DDL;
        // Ensure the tracking table exists
        await pool.query(ddl);
        // Check if this seed has already been applied
        const check = await pool.query('SELECT id FROM street_seed_runs WHERE hash = ?', [hash]).catch(async () => {
            // PostgreSQL uses $1 placeholders; retry with pg-style param
            return pool.query('SELECT id FROM street_seed_runs WHERE hash = $1', [hash]);
        });
        if (check.rows.length > 0) {
            return { skipped: true, hash };
        }
        // Execute seed inside a transaction and record the hash
        await pool.transaction(async (conn) => {
            const exec = typeof conn === 'function'
                ? conn
                : (sql, params) => conn.query(sql, params);
            // Execute the seed SQL (may contain multiple statements separated by ;)
            await exec(content);
            // Record the run — try SQLite placeholder first, fall back to PG style
            await exec('INSERT INTO street_seed_runs (id, hash) VALUES (?, ?)', [id, hash]).catch(async () => {
                await exec('INSERT INTO street_seed_runs (id, hash) VALUES ($1, $2)', [id, hash]);
            });
        });
        return { skipped: false, hash };
    }
}
//# sourceMappingURL=seeder.js.map