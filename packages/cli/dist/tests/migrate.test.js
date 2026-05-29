// packages/cli/src/tests/migrate.test.ts
// Unit tests for the `street migrate:create` and `street migrate:run` commands.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
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
});
//# sourceMappingURL=migrate.test.js.map