// packages/cli/src/tests/migrate.test.ts
// Unit tests for the `street migrate:create` and `street migrate:run` commands.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MigrateCommand } from '../commands/migrate.js';
function captureConsole() {
    const output = { logs: [], errors: [] };
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => { output.logs.push(args.join(' ')); };
    console.error = (...args) => { output.errors.push(args.join(' ')); };
    return {
        output,
        restore: () => {
            console.log = origLog;
            console.error = origErr;
        },
    };
}
function makeContext(cwd, positionals, flags = {}) {
    return {
        cwd,
        args: {
            command: 'migrate:create',
            positional: positionals,
            flags,
        },
    };
}
function withTempDir(fn) {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-migrate-test-'));
    return fn(tmpDir).finally(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
}
void describe('MigrateCommand', () => {
    // ── Validation ────────────────────────────────────────────────────────
    void it('rejects migrate:create when no name is given', async () => {
        process.exitCode = 0;
        const ctx = makeContext('/tmp', []);
        const { restore } = captureConsole();
        const cmd = new MigrateCommand();
        await cmd.executeCreate(ctx);
        restore();
        assert.notEqual(process.exitCode, 0);
    });
    // ── Migration file creation ───────────────────────────────────────────
    void it('creates up and rollback migration files', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['create_users_table']);
            const { restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            // Should have created migrations/ directory
            assert.ok(existsSync(join(tmpDir, 'migrations')));
            // List files in migrations/
            const files = readdirSync(join(tmpDir, 'migrations'));
            assert.equal(files.length, 2);
            // One .sql and one .rollback.sql
            const upFiles = files.filter((f) => f.endsWith('.sql') && !f.endsWith('.rollback.sql'));
            const rollbackFiles = files.filter((f) => f.endsWith('.rollback.sql'));
            assert.equal(upFiles.length, 1);
            assert.equal(rollbackFiles.length, 1);
        });
    });
    void it('generates timestamped migration filenames', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['add_index']);
            const { restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            const files = readdirSync(join(tmpDir, 'migrations'));
            for (const file of files) {
                // Filename should start with 14 digits (YYYYMMDDHHmmss)
                assert.ok(/^\d{14}_/.test(file), `Expected timestamp prefix in ${file}`);
            }
        });
    });
    void it('generates consistent filenames (same base for up and down)', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['my_migration']);
            const { restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            const files = readdirSync(join(tmpDir, 'migrations')).sort();
            // Both files should share the same timestamp prefix
            const upBase = files.find((f) => !f.endsWith('.rollback.sql')).replace(/\.sql$/, '');
            const downBase = files.find((f) => f.endsWith('.rollback.sql')).replace(/\.rollback\.sql$/, '');
            assert.equal(upBase, downBase);
        });
    });
    void it('includes migration name in the filename', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['add_email_column']);
            const { restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            const files = readdirSync(join(tmpDir, 'migrations'));
            assert.ok(files.some((f) => f.includes('add_email_column')));
        });
    });
    void it('generates SQL content with comments and description placeholder', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['create_table']);
            const { restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            const files = readdirSync(join(tmpDir, 'migrations'));
            const upFile = files.find((f) => !f.endsWith('.rollback.sql'));
            const downFile = files.find((f) => f.endsWith('.rollback.sql'));
            const upContent = readFileSync(join(tmpDir, 'migrations', upFile), 'utf8');
            const downContent = readFileSync(join(tmpDir, 'migrations', downFile), 'utf8');
            // Up migration
            assert.ok(upContent.includes('-- Migration: create_table'));
            assert.ok(upContent.includes('-- Description:'));
            assert.ok(upContent.includes('CREATE TABLE'));
            assert.ok(upContent.includes('gen_random_uuid()'));
            // Down (rollback) migration
            assert.ok(downContent.includes('-- Rollback: create_table'));
            assert.ok(downContent.includes('DROP TABLE IF EXISTS'));
        });
    });
    // ── Output messages ───────────────────────────────────────────────────
    void it('prints creation messages for both files', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['test_mig']);
            const { output, restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            assert.ok(output.logs.some((l) => l.includes('Created migration')));
            assert.ok(output.logs.some((l) => l.includes('Created rollback')));
        });
    });
    // ── migrate:run validation ────────────────────────────────────────────
    void it('migrate:run fails if dist/main.js does not exist', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, []);
            const { output, restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeRun(ctx);
            restore();
            assert.notEqual(process.exitCode, 0);
            assert.ok(output.errors.some((e) => e.includes('Build not found') || e.includes('migrate')));
        });
    });
    void it('migrate:run reports no migrations when directory is empty', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            // Create dist/main.js so the build check passes
            const fs = await import('node:fs/promises');
            await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
            await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
            const ctx = makeContext(tmpDir, []);
            const { output, restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeRun(ctx);
            restore();
            assert.ok(output.logs.some((l) => l.includes('No migration')));
        });
    });
    void it('migrate:run reports count when migration files exist', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const fs = await import('node:fs/promises');
            // Create dist/main.js so the build check passes
            await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
            await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
            // Create migration files
            await fs.mkdir(join(tmpDir, 'migrations'), { recursive: true });
            await fs.writeFile(join(tmpDir, 'migrations', '20250101000000_test.sql'), '-- test up', 'utf8');
            await fs.writeFile(join(tmpDir, 'migrations', '20250101000001_add_column.sql'), '-- add column', 'utf8');
            await fs.writeFile(join(tmpDir, 'migrations', '20250101000002_create_table.sql'), '-- create table', 'utf8');
            const ctx = makeContext(tmpDir, []);
            const { output, restore } = captureConsole();
            const cmd = new MigrateCommand();
            // This will print "Found X migration file(s)" and then attempt to connect
            // to Postgres (which will fail). We catch the PG error — we're only
            // verifying the discovery message was printed before the connection attempt.
            try {
                await cmd.executeRun(ctx);
            }
            catch {
                // Expected — Postgres is not available in unit tests
            }
            restore();
            assert.ok(output.logs.some((l) => l.includes('Found 3 migration file(s)')), `Expected "Found 3 migration file(s)" in output: ${JSON.stringify(output.logs)}`);
        });
    });
    void it('migrate:run filters out rollback files from migration count', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const fs = await import('node:fs/promises');
            // Create dist/main.js so the build check passes
            await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
            await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
            // Create migration files — mix of .sql, .rollback.sql, and unrelated files
            await fs.mkdir(join(tmpDir, 'migrations'), { recursive: true });
            await fs.writeFile(join(tmpDir, 'migrations', '20250101000000_test.sql'), '-- test up', 'utf8');
            await fs.writeFile(join(tmpDir, 'migrations', '20250101000000_test.rollback.sql'), '-- test down', 'utf8');
            await fs.writeFile(join(tmpDir, 'migrations', 'README.md'), '# migrations', 'utf8');
            const ctx = makeContext(tmpDir, []);
            const { output, restore } = captureConsole();
            const cmd = new MigrateCommand();
            try {
                await cmd.executeRun(ctx);
            }
            catch {
                // Expected — Postgres is not available in unit tests
            }
            restore();
            // Only the .sql file (not .rollback.sql or README.md) should count
            assert.ok(output.logs.some((l) => l.includes('Found 1 migration file(s)')), `Expected "Found 1 migration file(s)" in output: ${JSON.stringify(output.logs)}`);
        });
    });
    void it('migrate:run reports no migrations when only rollback files exist', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const fs = await import('node:fs/promises');
            // Create dist/main.js so the build check passes
            await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
            await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
            // Only rollback files (no .sql up files) — should report "No migration files"
            await fs.mkdir(join(tmpDir, 'migrations'), { recursive: true });
            await fs.writeFile(join(tmpDir, 'migrations', '20250101000000_test.rollback.sql'), '-- test down', 'utf8');
            const ctx = makeContext(tmpDir, []);
            const { output, restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeRun(ctx);
            restore();
            assert.ok(output.logs.some((l) => l.includes('No migration files found')), `Expected "No migration files found" in output: ${JSON.stringify(output.logs)}`);
        });
    });
    // ── migrate:run integration tests (require Postgres) ──────────────────
    void describe('MigrateCommand migrate:run (integration, requires Postgres)', () => {
        let pgAvailable = false;
        before(async () => {
            try {
                const { PgPool } = await import('@streetjs/core');
                const checkPool = new PgPool({
                    host: process.env['PG_HOST'] ?? 'localhost',
                    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
                    user: process.env['PG_USER'] ?? 'street',
                    password: process.env['PG_PASSWORD'] ?? 'street_secret',
                    database: process.env['PG_DATABASE'] ?? 'street_test',
                    minConnections: 1,
                    maxConnections: 1,
                    acquireTimeoutMs: 3000,
                    idleTimeoutMs: 5000,
                });
                await checkPool.initialize();
                await checkPool.close();
                pgAvailable = true;
            }
            catch {
                console.log('[street] Skipping migrate:run integration tests — Postgres not available (start with: docker compose up -d postgres)');
            }
        });
        void it('runs a migration and records it in street_migrations tracking table', async () => {
            if (!pgAvailable)
                return;
            const tableName = 'mig_integ_' + randomBytes(4).toString('hex');
            await withTempDir(async (tmpDir) => {
                process.exitCode = 0;
                const fs = await import('node:fs/promises');
                // Create dist/main.js so the build check passes
                await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
                // Create a migration file that creates a unique test table
                await fs.mkdir(join(tmpDir, 'migrations'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'migrations', '20250101000000_create_' + tableName + '.sql'), `CREATE TABLE IF NOT EXISTS ${tableName} (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          name VARCHAR(100) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`, 'utf8');
                const ctx = makeContext(tmpDir, []);
                const { output, restore } = captureConsole();
                const cmd = new MigrateCommand();
                // This exercises the full executeRun try/finally block with real Postgres
                await cmd.executeRun(ctx);
                restore();
                // Verify discovery message
                assert.ok(output.logs.some((l) => l.includes('Found 1 migration file(s)')), `Expected "Found 1 migration file(s)" — got: ${JSON.stringify(output.logs)}`);
                // Verify the runner applied the migration
                assert.ok(output.logs.some((l) => l.includes('[migrations] Applying:')), `Expected migration "Applying" message — got: ${JSON.stringify(output.logs)}`);
                assert.ok(output.logs.some((l) => l.includes('[migrations] All migrations complete.')), `Expected "All migrations complete" — got: ${JSON.stringify(output.logs)}`);
                // Verify no errors
                assert.equal(output.errors.length, 0, `Expected no errors — got: ${JSON.stringify(output.errors)}`);
                assert.equal(process.exitCode, 0, 'Expected exit code 0');
                // Verify the tracking table recorded this migration
                const { PgPool } = await import('@streetjs/core');
                const verifyPool = new PgPool({
                    host: process.env['PG_HOST'] ?? 'localhost',
                    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
                    user: process.env['PG_USER'] ?? 'street',
                    password: process.env['PG_PASSWORD'] ?? 'street_secret',
                    database: process.env['PG_DATABASE'] ?? 'street_test',
                    minConnections: 1,
                    maxConnections: 1,
                });
                await verifyPool.initialize();
                try {
                    const result = await verifyPool.query(`SELECT name FROM street_migrations WHERE name LIKE $1`, [`20250101000000_create_${tableName}%`]);
                    assert.equal(result.rows.length, 1, `Migration should be recorded in street_migrations — got ${result.rows.length} rows`);
                    assert.ok(result.rows[0]['name'].includes(tableName), `Expected migration name to contain table: ${result.rows[0]['name']}`);
                }
                finally {
                    // Clean up test table and tracking entry
                    await verifyPool.query(`DROP TABLE IF EXISTS ${tableName}`);
                    await verifyPool.query(`DELETE FROM street_migrations WHERE name LIKE $1`, [`20250101000000_create_${tableName}%`]);
                    await verifyPool.close();
                }
            });
        });
        void it('applies multiple migration files in order', async () => {
            if (!pgAvailable)
                return;
            const table1 = 'mig_multi1_' + randomBytes(4).toString('hex');
            const table2 = 'mig_multi2_' + randomBytes(4).toString('hex');
            await withTempDir(async (tmpDir) => {
                process.exitCode = 0;
                const fs = await import('node:fs/promises');
                await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
                await fs.mkdir(join(tmpDir, 'migrations'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'migrations', '001_create_' + table1 + '.sql'), `CREATE TABLE IF NOT EXISTS ${table1} (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`, 'utf8');
                await fs.writeFile(join(tmpDir, 'migrations', '002_create_' + table2 + '.sql'), `CREATE TABLE IF NOT EXISTS ${table2} (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`, 'utf8');
                const ctx = makeContext(tmpDir, []);
                const { output, restore } = captureConsole();
                const cmd = new MigrateCommand();
                await cmd.executeRun(ctx);
                restore();
                assert.ok(output.logs.some((l) => l.includes('Found 2 migration file(s)')), `Expected "Found 2 migration file(s)" — got: ${JSON.stringify(output.logs)}`);
                assert.ok(output.logs.some((l) => l.includes('[migrations] All migrations complete.')), `Expected "All migrations complete" — got: ${JSON.stringify(output.logs)}`);
                // Both tables should exist
                const { PgPool } = await import('@streetjs/core');
                const cleanPool = new PgPool({
                    host: process.env['PG_HOST'] ?? 'localhost',
                    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
                    user: process.env['PG_USER'] ?? 'street',
                    password: process.env['PG_PASSWORD'] ?? 'street_secret',
                    database: process.env['PG_DATABASE'] ?? 'street_test',
                    minConnections: 1,
                    maxConnections: 1,
                });
                await cleanPool.initialize();
                try {
                    const r1 = await cleanPool.query(`SELECT to_regclass($1) AS tbl`, [table1]);
                    assert.ok(r1.rows[0]?.['tbl'] !== null, `Table ${table1} should exist`);
                    const r2 = await cleanPool.query(`SELECT to_regclass($1) AS tbl`, [table2]);
                    assert.ok(r2.rows[0]?.['tbl'] !== null, `Table ${table2} should exist`);
                }
                finally {
                    await cleanPool.query(`DROP TABLE IF EXISTS ${table1}`);
                    await cleanPool.query(`DROP TABLE IF EXISTS ${table2}`);
                    await cleanPool.query(`DELETE FROM street_migrations WHERE name LIKE '001_create_${table1}%' OR name LIKE '002_create_${table2}%'`);
                    await cleanPool.close();
                }
            });
        });
        void it('skips already-applied migrations (idempotent)', async () => {
            if (!pgAvailable)
                return;
            const tableName = 'mig_idem_' + randomBytes(4).toString('hex');
            await withTempDir(async (tmpDir) => {
                process.exitCode = 0;
                const fs = await import('node:fs/promises');
                await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
                await fs.mkdir(join(tmpDir, 'migrations'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'migrations', '001_create_' + tableName + '.sql'), `CREATE TABLE IF NOT EXISTS ${tableName} (id UUID PRIMARY KEY DEFAULT gen_random_uuid())`, 'utf8');
                const cmd = new MigrateCommand();
                // First run — applies the migration
                {
                    const ctx = makeContext(tmpDir, []);
                    const { output, restore } = captureConsole();
                    await cmd.executeRun(ctx);
                    restore();
                    assert.ok(output.logs.some((l) => l.includes('[migrations] Applying:')), 'First run should apply the migration');
                }
                // Second run — should skip since already applied
                {
                    const ctx = makeContext(tmpDir, []);
                    const { output, restore } = captureConsole();
                    await cmd.executeRun(ctx);
                    restore();
                    assert.ok(output.logs.some((l) => l.includes('[migrations] Skipping already applied:')), `Second run should skip — got: ${JSON.stringify(output.logs)}`);
                    assert.ok(output.logs.some((l) => l.includes('[migrations] All migrations complete.')), 'Second run should still complete');
                }
                // Clean up
                const { PgPool } = await import('@streetjs/core');
                const cleanPool = new PgPool({
                    host: process.env['PG_HOST'] ?? 'localhost',
                    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
                    user: process.env['PG_USER'] ?? 'street',
                    password: process.env['PG_PASSWORD'] ?? 'street_secret',
                    database: process.env['PG_DATABASE'] ?? 'street_test',
                    minConnections: 1,
                    maxConnections: 1,
                });
                await cleanPool.initialize();
                try {
                    await cleanPool.query(`DROP TABLE IF EXISTS ${tableName}`);
                    await cleanPool.query(`DELETE FROM street_migrations WHERE name LIKE '001_create_${tableName}%'`);
                }
                finally {
                    await cleanPool.close();
                }
            });
        });
        void it('propagates SQL error from invalid migration (pool.close() still runs)', async () => {
            if (!pgAvailable)
                return;
            await withTempDir(async (tmpDir) => {
                process.exitCode = 0;
                const fs = await import('node:fs/promises');
                await fs.mkdir(join(tmpDir, 'dist'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'dist', 'main.js'), '// placeholder', 'utf8');
                await fs.mkdir(join(tmpDir, 'migrations'), { recursive: true });
                await fs.writeFile(join(tmpDir, 'migrations', '001_bad_syntax.sql'), 'CREATE TABLE this is invalid sql !!!!', 'utf8');
                const ctx = makeContext(tmpDir, []);
                const cmd = new MigrateCommand();
                // The invalid SQL will cause the transaction to fail,
                // but the finally block should still close the pool.
                await assert.rejects(() => cmd.executeRun(ctx), /PostgreSQL/, 'Should reject with a PostgreSQL error');
                // The pool should have been closed in the finally block.
                // Verify by checking the runner error is about bad SQL, not pool issues.
                assert.equal(process.exitCode, 0, 'exitCode should remain unchanged by runner errors');
                // Verify no entry was recorded in street_migrations for the failed migration
                const { PgPool } = await import('@streetjs/core');
                const verifyPool = new PgPool({
                    host: process.env['PG_HOST'] ?? 'localhost',
                    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
                    user: process.env['PG_USER'] ?? 'street',
                    password: process.env['PG_PASSWORD'] ?? 'street_secret',
                    database: process.env['PG_DATABASE'] ?? 'street_test',
                    minConnections: 1,
                    maxConnections: 1,
                });
                await verifyPool.initialize();
                try {
                    const result = await verifyPool.query(`SELECT COUNT(*) AS cnt FROM street_migrations WHERE name LIKE '001_bad_syntax%'`);
                    assert.equal(result.rows[0]['cnt'], '0', 'Failed migration should not be recorded in street_migrations');
                }
                finally {
                    await verifyPool.close();
                }
            });
        });
    });
    // ── toSnakeCase in template generation ────────────────────────────────
    void it('generates SQL template with snake_case table name for camelCase migration names', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['addEmailColumn']);
            const { restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            const files = readdirSync(join(tmpDir, 'migrations'));
            const upFile = files.find((f) => !f.endsWith('.rollback.sql'));
            const upContent = readFileSync(join(tmpDir, 'migrations', upFile), 'utf8');
            // The template converts camelCase to snake_case for the table name
            assert.ok(upContent.includes('CREATE TABLE add_email_column'), `Expected snake_case table name in template: ${upContent}`);
        });
    });
    void it('generates SQL template with snake_case table name for kebab-case migration names', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['add-email-column']);
            const { restore } = captureConsole();
            const cmd = new MigrateCommand();
            await cmd.executeCreate(ctx);
            restore();
            const files = readdirSync(join(tmpDir, 'migrations'));
            const upFile = files.find((f) => !f.endsWith('.rollback.sql'));
            const upContent = readFileSync(join(tmpDir, 'migrations', upFile), 'utf8');
            // Kebab-case is converted to snake_case
            assert.ok(upContent.includes('CREATE TABLE add_email_column'), `Expected snake_case table name from kebab input: ${upContent}`);
        });
    });
});
//# sourceMappingURL=migrate.test.js.map