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
    // ── Pluralisation edge cases (toPlural) ───────────────────────────────
    void it('pluralizes name ending in x with -es for route path', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'box']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const content = readFileSync(join(tmpDir, 'src', 'controllers', 'box.controller.ts'), 'utf8');
            // toPlural('box') -> 'boxes'
            assert.ok(content.includes("@Controller('/api/boxes')"), `Expected route /api/boxes, got: ${content.slice(content.indexOf('@Controller'), content.indexOf('@Controller') + 40)}`);
        });
    });
    void it('pluralizes name ending in ch with -es for route path', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'bench']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const content = readFileSync(join(tmpDir, 'src', 'controllers', 'bench.controller.ts'), 'utf8');
            assert.ok(content.includes("@Controller('/api/benches')"), 'Expected route /api/benches for name ending in ch');
        });
    });
    void it('pluralizes name ending in sh with -es for route path', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'flash']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const content = readFileSync(join(tmpDir, 'src', 'controllers', 'flash.controller.ts'), 'utf8');
            assert.ok(content.includes("@Controller('/api/flashes')"), 'Expected route /api/flashes for name ending in sh');
        });
    });
    void it('pluralizes name ending in z with -es for route path', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'buzz']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const content = readFileSync(join(tmpDir, 'src', 'controllers', 'buzz.controller.ts'), 'utf8');
            assert.ok(content.includes("@Controller('/api/buzzes')"), 'Expected route /api/buzzes for name ending in z');
        });
    });
    void it('pluralizes consonant+y name by replacing y with ies', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'category']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const content = readFileSync(join(tmpDir, 'src', 'controllers', 'category.controller.ts'), 'utf8');
            // toPlural('category') -> 'categories'
            assert.ok(content.includes("@Controller('/api/categories')"), `Expected route /api/categories for consonant+y name, got content`);
        });
    });
    void it('pluralizes vowel+y name by adding s (not ies)', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'day']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const content = readFileSync(join(tmpDir, 'src', 'controllers', 'day.controller.ts'), 'utf8');
            // toPlural('day') -> 'days' (vowel+y, not 'dies')
            assert.ok(content.includes("@Controller('/api/days')"), 'Expected route /api/days for vowel+y name');
            // Should NOT use 'dies'
            assert.ok(!content.includes('dies'), 'Should not use dies for vowel+y name');
        });
    });
    // ── Name conversion edge cases (toKebabCase, toPascalCase, toSnakeCase) ──
    void it('converts camelCase name to kebab-case filename with PascalCase class', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'helloWorld']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            // toKebabCase('helloWorld') -> 'hello-world'
            const filePath = join(tmpDir, 'src', 'controllers', 'hello-world.controller.ts');
            assert.ok(existsSync(filePath), 'Filename should be kebab-case: hello-world.controller.ts');
            const content = readFileSync(filePath, 'utf8');
            // toPascalCase('helloWorld') -> 'Helloworld' (toPascalCase splits on hyphens/underscores only)
            assert.ok(content.includes('HelloworldController'), 'Class name should be PascalCase: HelloworldController');
        });
    });
    void it('converts camelCase name to snake_case TABLE_NAME in repository', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['repository', 'blogPost']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            const content = readFileSync(join(tmpDir, 'src', 'repositories', 'blog-post.repository.ts'), 'utf8');
            // toKebabCase('blogPost') -> 'blog-post'
            // Then in the template: toSnakeCase(toPlural('blog-post'))
            // toPlural('blog-post') -> 'blog-posts'
            // toSnakeCase('blog-posts') -> 'blog_posts'
            assert.ok(content.includes("TABLE_NAME = 'blog_posts'"), `Expected TABLE_NAME = 'blog_posts' for camelCase repository`);
        });
    });
    void it('handles mixed underscore and digits in name', async () => {
        await withTempDir(async (tmpDir) => {
            process.exitCode = 0;
            const ctx = makeContext(tmpDir, ['controller', 'v2_api']);
            const { restore } = captureConsole();
            const cmd = new GenerateCommand();
            await cmd.execute(ctx);
            restore();
            // toKebabCase('v2_api') -> 'v2-api'
            const filePath = join(tmpDir, 'src', 'controllers', 'v2-api.controller.ts');
            assert.ok(existsSync(filePath), 'Filename should be v2-api.controller.ts');
            const content = readFileSync(filePath, 'utf8');
            // toPascalCase('v2_api') -> 'V2Api'
            assert.ok(content.includes('V2ApiController'), 'Class name should be V2ApiController');
            // pluralName = toPlural('v2_api') -> 'v2_apis' (no kebab conversion on route)
            assert.ok(content.includes("@Controller('/api/v2_apis')"), 'Expected route /api/v2_apis (pluralName preserves underscores)');
        });
    });
});
//# sourceMappingURL=generate.test.js.map