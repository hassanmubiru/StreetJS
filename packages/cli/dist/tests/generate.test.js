// packages/cli/src/tests/generate.test.ts
// Unit tests for the `street generate` command — helper methods and scaffolding.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// We import the class itself so we can exercise the private helpers
// via the execute method which produces observable output files.
import { GenerateCommand } from '../commands/generate.js';
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
            command: 'generate',
            positional: positionals,
            flags,
        },
    };
}
function withTempDir(fn) {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-gen-test-'));
    return fn(tmpDir).finally(() => {
        rmSync(tmpDir, { recursive: true, force: true });
    });
}
void describe('GenerateCommand', () => {
    // ── Validation tests ──────────────────────────────────────────────────
    void it('rejects when no type is given', async () => {
        process.exitCode = 0;
        const ctx = makeContext('/tmp', []);
        const { restore } = captureConsole();
        const cmd = new GenerateCommand();
        await cmd.execute(ctx);
        restore();
        assert.notEqual(process.exitCode, 0);
    });
    void it('rejects when no name is given', async () => {
        process.exitCode = 0;
        const ctx = makeContext('/tmp', ['controller']);
        const { restore } = captureConsole();
        const cmd = new GenerateCommand();
        await cmd.execute(ctx);
        restore();
        assert.notEqual(process.exitCode, 0);
    });
    void it('rejects invalid generate type', async () => {
        process.exitCode = 0;
        const ctx = makeContext('/tmp', ['invalid', 'foo']);
        const { output, restore } = captureConsole();
        const cmd = new GenerateCommand();
        await cmd.execute(ctx);
        restore();
        assert.notEqual(process.exitCode, 0);
        assert.ok(output.errors.some((e) => e.includes('Valid types')));
    });
    // ── Controller generation ─────────────────────────────────────────────
    void it('generates a controller file with correct content', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'users']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const filePath = join(tmpDir, 'src', 'controllers', 'users.controller.ts');
            assert.ok(existsSync(filePath));
            const content = readFileSync(filePath, 'utf8');
            assert.ok(content.includes('UsersController'));
            assert.ok(content.includes('@Controller(\'/api/users\''));
            assert.ok(content.includes('UsersService'));
            assert.ok(content.includes('container.resolve'));
            assert.ok(content.includes('@Get'));
            assert.ok(content.includes('@Post'));
            assert.ok(content.includes('@Put'));
            assert.ok(content.includes('@Delete'));
        });
    });
    void it('generates controller for hyphenated name', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'blog-post']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const filePath = join(tmpDir, 'src', 'controllers', 'blog-post.controller.ts');
            assert.ok(existsSync(filePath));
            const content = readFileSync(filePath, 'utf8');
            // PascalCase conversion: blog-post -> BlogPost
            assert.ok(content.includes('BlogPostController'));
        });
    });
    void it('generates controller for snake_case name', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'user_profile']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const filePath = join(tmpDir, 'src', 'controllers', 'user-profile.controller.ts');
            assert.ok(existsSync(filePath));
            const content = readFileSync(filePath, 'utf8');
            assert.ok(content.includes('UserProfileController'));
        });
    });
    // ── Service generation ────────────────────────────────────────────────
    void it('generates a service file with correct content', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['service', 'teams']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const filePath = join(tmpDir, 'src', 'services', 'teams.service.ts');
            assert.ok(existsSync(filePath));
            const content = readFileSync(filePath, 'utf8');
            assert.ok(content.includes('TeamsService'));
            assert.ok(content.includes('TeamsRepository'));
            assert.ok(content.includes('@Injectable'));
            assert.ok(content.includes('findAll'));
            assert.ok(content.includes('findById'));
            assert.ok(content.includes('create'));
            assert.ok(content.includes('update'));
            assert.ok(content.includes('delete'));
            assert.ok(content.includes('crypto.randomUUID'));
        });
    });
    // ── Repository generation ─────────────────────────────────────────────
    void it('generates a repository file with correct content', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['repository', 'products']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const filePath = join(tmpDir, 'src', 'repositories', 'products.repository.ts');
            assert.ok(existsSync(filePath));
            const content = readFileSync(filePath, 'utf8');
            assert.ok(content.includes('ProductsRepository'));
            assert.ok(content.includes('PgPool'));
            assert.ok(content.includes('TABLE_NAME'));
            assert.ok(content.includes('findAll'));
            assert.ok(content.includes('findById'));
            assert.ok(content.includes('INSERT INTO'));
            assert.ok(content.includes('UPDATE'));
            assert.ok(content.includes('DELETE FROM'));
        });
    });
    // ── File output messages ──────────────────────────────────────────────
    void it('prints success message after generation', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'items']);
            const { output, restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            assert.ok(output.logs.some((l) => l.includes('Generated controller')));
            assert.ok(output.logs.some((l) => l.includes('items.controller.ts')));
        });
    });
    // ── Edge cases ────────────────────────────────────────────────────────
    void it('handles single-letter name', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['service', 'x']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            assert.ok(existsSync(join(tmpDir, 'src', 'services', 'x.service.ts')));
        });
    });
    void it('handles numeric prefix in name gracefully', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', '2fa']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            // 2fa -> kebab: 2fa, pascal: 2fa
            assert.ok(existsSync(join(tmpDir, 'src', 'controllers', '2fa.controller.ts')));
        });
    });
});
//# sourceMappingURL=generate.test.js.map