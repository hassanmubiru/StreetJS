// packages/cli/src/tests/create.test.ts
// Unit tests for the `street create` scaffolding command.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCommand } from '../commands/create.js';

interface CapturedOutput {
  logs: string[];
  errors: string[];
}

/** Run a test in an isolated temp directory */
function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'street-create-test-'));
  return fn(tmpDir).finally(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
}

/** Capture console output */
function captureCallbacks(): {
  output: CapturedOutput;
  restore: () => void;
} {
  const output: CapturedOutput = { logs: [], errors: [] };
  const origLog = console.log;
  const origErr = console.error;

  console.log = (...args: string[]) => {
    output.logs.push(args.join(' '));
  };
  console.error = (...args: string[]) => {
    output.errors.push(args.join(' '));
  };

  return {
    output,
    restore: () => {
      console.log = origLog;
      console.error = origErr;
    },
  };
}

/** Build a minimal CliContext for a given cwd */
function makeContext(cwd: string, positionals: string[], flags: Record<string, string | boolean> = {}) {
  return {
    cwd,
    args: {
      command: 'create',
      positional: positionals,
      // Default to --no-lockfile so unit tests don't spawn a network `npm
      // install --package-lock-only`. Tests can override per-call.
      flags: { 'no-lockfile': true, ...flags },
    },
  };
}

void describe('CreateCommand', () => {
  void it('rejects when no project name is given', async () => {
    const ctx = makeContext('/tmp', []);
    const { restore } = captureCallbacks();
    const cmd = new CreateCommand();
    await cmd.execute(ctx);
    restore();
    assert.notEqual(process.exitCode, 0);
  });

  void it('rejects project name starting with special characters', async () => {
    process.exitCode = 0;
    const ctx = makeContext('/tmp', ['-bad-name']);
    const { restore } = captureCallbacks();
    const cmd = new CreateCommand();
    await cmd.execute(ctx);
    restore();
    assert.notEqual(process.exitCode, 0);
  });

  void it('accepts valid project names', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['valid-name']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();
      assert.equal(process.exitCode, 0);
    });
  });

  void it('accepts project names with uppercase, numbers, underscores', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['MyApp_2']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();
      assert.equal(process.exitCode, 0);
    });
  });

  void it('rejects when target directory already exists', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      // Pre-create the directory
      mkdirSync(join(tmpDir, 'existing-app'), { recursive: true });

      const ctx = makeContext(tmpDir, ['existing-app']);
      const { output, restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();
      assert.notEqual(process.exitCode, 0);
      assert.ok(output.errors.some((e) => e.includes('already exists')));
    });
  });

  void it('scaffolds all expected files', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const projectDir = join(tmpDir, 'test-app');
      assert.ok(existsSync(join(projectDir, 'package.json')));
      assert.ok(existsSync(join(projectDir, 'street.config.ts')));
      assert.ok(existsSync(join(projectDir, 'tsconfig.json')));
      assert.ok(existsSync(join(projectDir, 'Dockerfile')));
      assert.ok(existsSync(join(projectDir, 'docker-compose.yml')));
      assert.ok(existsSync(join(projectDir, '.env.example')));
      assert.ok(existsSync(join(projectDir, '.gitignore')));
      assert.ok(existsSync(join(projectDir, 'README.md')));
    });
  });

  void it('scaffolds src/ directory structure', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const projectDir = join(tmpDir, 'test-app');
      // Controller files
      assert.ok(existsSync(join(projectDir, 'src', 'controllers', 'example.controller.ts')));
      assert.ok(existsSync(join(projectDir, 'src', 'controllers', 'health.controller.ts')));
      // Service
      assert.ok(existsSync(join(projectDir, 'src', 'services', 'example.service.ts')));
      // Repository
      assert.ok(existsSync(join(projectDir, 'src', 'repositories', 'example.repository.ts')));
      // Middleware
      assert.ok(existsSync(join(projectDir, 'src', 'middleware', 'auth.ts')));
      // Gateway
      assert.ok(existsSync(join(projectDir, 'src', 'gateways', 'chat.gateway.ts')));
      // Test file
      assert.ok(existsSync(join(projectDir, 'tests', 'integration.test.ts')));
    });
  });

  void it('scaffolds migrations, uploads, docker-init directories', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const projectDir = join(tmpDir, 'test-app');
      assert.ok(existsSync(join(projectDir, 'migrations')));
      assert.ok(existsSync(join(projectDir, 'uploads', '.gitkeep')));
      assert.ok(existsSync(join(projectDir, 'docker-init', '001_enable_pgcrypto.sql')));
    });
  });

  void it('generates valid package.json with correct name', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['my-project']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const pkg = JSON.parse(
        readFileSync(join(tmpDir, 'my-project', 'package.json'), 'utf8'),
      );
      assert.equal(pkg.name, 'my-project');
      assert.equal(pkg.version, '0.1.0');
      assert.equal(pkg.private, true);
      assert.equal(pkg.type, 'module');
      assert.ok(pkg.dependencies['streetjs']);
      assert.ok(pkg.dependencies['reflect-metadata']);
    });
  });

  void it('generates valid tsconfig.json with strict mode', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const tsconfig = JSON.parse(
        readFileSync(join(tmpDir, 'test-app', 'tsconfig.json'), 'utf8'),
      );
      assert.equal(tsconfig.compilerOptions.strict, true);
      assert.equal(tsconfig.compilerOptions.target, 'ES2022');
      assert.equal(tsconfig.compilerOptions.module, 'NodeNext');
      assert.equal(tsconfig.compilerOptions.rootDir, './src');
    });
  });

  void it('generates README.md with project name', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['my-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const readme = readFileSync(join(tmpDir, 'my-app', 'README.md'), 'utf8');
      assert.ok(readme.includes('# my-app'));
      assert.ok(readme.includes('Street'));
    });
  });

  void it('generates Dockerfile with proper stages', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const dockerfile = readFileSync(join(tmpDir, 'test-app', 'Dockerfile'), 'utf8');
      assert.ok(dockerfile.includes('FROM node:20-alpine AS builder'));
      assert.ok(dockerfile.includes('FROM node:20-alpine AS runner'));
      assert.ok(dockerfile.includes('CMD ["node", "dist/main.js"]'));
    });
  });

  void it('generates main.ts with server bootstrap logic', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const main = readFileSync(join(tmpDir, 'test-app', 'src', 'main.ts'), 'utf8');
      assert.ok(main.includes('streetApp'));
      assert.ok(main.includes('StreetWebSocketServer'));
      assert.ok(main.includes('bootstrap'));
      assert.ok(main.includes('registerController'));
    });
  });

  void it('generates .gitignore with dist/ and node_modules/', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      const gitignore = readFileSync(join(tmpDir, 'test-app', '.gitignore'), 'utf8');
      assert.ok(gitignore.includes('dist/'));
      assert.ok(gitignore.includes('node_modules/'));
      assert.ok(gitignore.includes('uploads/*'));
    });
  });

  void it('creates 16+ files in total', async () => {
    await withTempDir(async (tmpDir) => {
      process.exitCode = 0;
      const ctx = makeContext(tmpDir, ['test-app']);
      const { restore } = captureCallbacks();
      const cmd = new CreateCommand();
      await cmd.execute(ctx);
      restore();

      // Count files recursively
      const projectDir = join(tmpDir, 'test-app');
      const count = countFilesRecursive(projectDir);
      // Should have at least 16 files (package.json, tsconfig.json, Dockerfile,
      // docker-compose.yml, .env.example, .gitignore, README.md,
      // street.config.ts, main.ts, example.controller.ts, health.controller.ts,
      // example.service.ts, example.repository.ts, auth.ts, chat.gateway.ts,
      // integration.test.ts, .gitkeep, 001_enable_pgcrypto.sql)
      assert.ok(count >= 16, `Expected >= 16 files, got ${count}`);
    });
  });
});

/** Recursively count files in a directory */
function countFilesRecursive(dir: string): number {
  let count = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      count += countFilesRecursive(full);
    } else {
      count++;
    }
  }
  return count;
}
