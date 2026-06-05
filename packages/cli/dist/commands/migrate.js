// packages/cli/src/commands/migrate.ts
// `street migrate:create <name>`, `street migrate:run`, and `street migrate:diff`
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export class MigrateCommand {
    /**
     * `street migrate:create <name>` — creates a new timestamped SQL migration file pair.
     */
    async executeCreate(ctx) {
        const name = ctx.args.positional[0];
        if (!name) {
            console.error('[street] Usage: street migrate:create <migration-name>');
            console.error('  Example: street migrate:create create_users_table');
            process.exitCode = 1;
            return;
        }
        const migrationsDir = resolve(ctx.cwd, 'migrations');
        await mkdir(migrationsDir, { recursive: true });
        const timestamp = this.generateTimestamp();
        const baseName = `${timestamp}_${name}`;
        // Up migration
        const upPath = join(migrationsDir, `${baseName}.sql`);
        const upContent = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}
-- Description: 

-- Write your SQL migration here.
-- Example:
--   CREATE TABLE ${this.toSnakeCase(name)} (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   );

`;
        // Down (rollback) migration
        const downPath = join(migrationsDir, `${baseName}.rollback.sql`);
        const downContent = `-- Rollback: ${name}
-- Created: ${new Date().toISOString()}
-- Description: Rollback ${name}

-- Write your rollback SQL here.
-- Example:
--   DROP TABLE IF EXISTS ${this.toSnakeCase(name)};

`;
        await writeFile(upPath, upContent, 'utf8');
        await writeFile(downPath, downContent, 'utf8');
        console.log(`[street] Created migration: ${baseName}.sql`);
        console.log(`[street] Created rollback:  ${baseName}.rollback.sql`);
    }
    /**
     * `street migrate:run` — runs all pending migrations using Street's migration runner.
     */
    async executeRun(ctx) {
        const migrationsDir = resolve(ctx.cwd, 'migrations');
        const mainEntry = resolve(ctx.cwd, 'dist', 'main.js');
        // Check if dist/main.js exists (must build first)
        try {
            await import('node:fs/promises').then((fs) => fs.stat(mainEntry));
        }
        catch {
            console.error('[street] Build not found. Run "street build" before migrating.');
            process.exitCode = 1;
            return;
        }
        // Discover migration files
        await mkdir(migrationsDir, { recursive: true });
        let files;
        try {
            files = await readdir(migrationsDir);
        }
        catch {
            console.log('[street] No migrations directory found.');
            return;
        }
        const migrationFiles = files
            .filter((f) => f.endsWith('.sql') && !f.endsWith('.rollback.sql'))
            .sort();
        if (migrationFiles.length === 0) {
            console.log('[street] No migration files found.');
            return;
        }
        console.log(`[street] Found ${migrationFiles.length} migration file(s).`);
        // We need to run migrations via the application's PgPool.
        // Since the application has its own bootstrap, we create a minimal runner here.
        const { PgPool, StreetMigrationRunner } = await import('@streetjs/core');
        const pool = new PgPool({
            host: process.env['PG_HOST'] ?? 'localhost',
            port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
            user: process.env['PG_USER'] ?? 'postgres',
            password: process.env['PG_PASSWORD'] ?? '',
            database: process.env['PG_DATABASE'] ?? 'street',
            minConnections: 1,
            maxConnections: 2,
            idleTimeoutMs: 10_000,
            acquireTimeoutMs: 5_000,
        });
        try {
            await pool.initialize();
            const runner = new StreetMigrationRunner(pool);
            await runner.run(migrationsDir);
        }
        finally {
            await pool.close();
        }
    }
    generateTimestamp() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}${hours}${minutes}${seconds}`;
    }
    toSnakeCase(str) {
        return str
            .replace(/([a-z])([A-Z])/g, '$1_$2')
            .replace(/[-\s]+/g, '_')
            .toLowerCase();
    }
    /**
     * `street migrate:diff [--confirm-destructive]`
     *
     * Compares the live database schema against entity decorator metadata and
     * writes the generated SQL to a timestamped file.  Destructive statements
     * (DROP COLUMN) are only written when `--confirm-destructive` is passed.
     */
    async executeDiff(ctx) {
        const confirmDestructive = Boolean(ctx.args.flags['confirm-destructive']);
        const migrationsDir = resolve(ctx.cwd, 'migrations');
        await mkdir(migrationsDir, { recursive: true });
        const { PgPool, MigrationDiffer } = await import('@streetjs/core');
        const pool = new PgPool({
            host: process.env['PG_HOST'] ?? 'localhost',
            port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
            user: process.env['PG_USER'] ?? 'postgres',
            password: process.env['PG_PASSWORD'] ?? '',
            database: process.env['PG_DATABASE'] ?? 'street',
            minConnections: 1,
            maxConnections: 2,
            idleTimeoutMs: 10_000,
            acquireTimeoutMs: 5_000,
        });
        // Attempt to load user entities from the built project
        let entities = [];
        const entryPoint = resolve(ctx.cwd, 'dist', 'main.js');
        try {
            const app = await import(entryPoint);
            if (Array.isArray(app['entities'])) {
                entities = app['entities'];
            }
        }
        catch {
            console.warn('[street] Could not load entities from dist/main.js — diff will compare against empty entity list.');
        }
        let diff;
        try {
            await pool.initialize();
            diff = await MigrationDiffer.diff(pool, entities);
        }
        finally {
            await pool.close();
        }
        const hasSafe = diff.safe.length > 0;
        const hasDestructive = diff.destructive.length > 0;
        if (!hasSafe && !hasDestructive) {
            console.log('[street] No schema differences detected.');
            return;
        }
        if (hasDestructive && !confirmDestructive) {
            console.warn('[street] Destructive changes detected (DROP COLUMN). Re-run with --confirm-destructive to include them.');
            console.warn('[street] Destructive statements:');
            for (const stmt of diff.destructive) {
                console.warn(`  ${stmt}`);
            }
        }
        // Build SQL output. Returns null when there is nothing worth writing —
        // i.e. the only changes are destructive and were not confirmed. In that
        // case we must not write a spurious file containing only a header comment.
        const sql = buildDiffSql(diff, confirmDestructive);
        if (sql === null) {
            console.log('[street] No statements written. Re-run with --confirm-destructive to generate the destructive migration.');
            return;
        }
        const timestamp = this.generateTimestamp();
        const fileName = `${timestamp}_diff.sql`;
        const filePath = join(migrationsDir, fileName);
        await writeFile(filePath, sql, 'utf8');
        console.log(`[street] Diff written to: ${filePath}`);
        if (diff.safe.length > 0) {
            console.log(`  ${diff.safe.length} safe statement(s)`);
        }
        if (diff.destructive.length > 0) {
            const written = confirmDestructive ? diff.destructive.length : 0;
            console.log(`  ${diff.destructive.length} destructive statement(s) (${written} written — pass --confirm-destructive to include)`);
        }
    }
}
/**
 * Build the SQL file body for a schema diff and decide whether a file should
 * be written at all.
 *
 * Returns `null` when there is nothing worth writing: no safe (additive)
 * statements and destructive statements were not confirmed. Otherwise returns
 * the full file contents. Destructive statements are only included when
 * `confirmDestructive` is true.
 */
export function buildDiffSql(diff, confirmDestructive, generatedAt = new Date().toISOString()) {
    const hasSafe = diff.safe.length > 0;
    const includeDestructive = diff.destructive.length > 0 && confirmDestructive;
    if (!hasSafe && !includeDestructive) {
        return null;
    }
    const lines = [
        `-- Generated by street migrate:diff at ${generatedAt}`,
        '',
    ];
    if (hasSafe) {
        lines.push('-- Safe changes (additive)');
        for (const stmt of diff.safe) {
            lines.push(stmt);
        }
        lines.push('');
    }
    if (includeDestructive) {
        lines.push('-- Destructive changes (column removal)');
        for (const stmt of diff.destructive) {
            lines.push(stmt);
        }
        lines.push('');
    }
    return lines.join('\n');
}
//# sourceMappingURL=migrate.js.map