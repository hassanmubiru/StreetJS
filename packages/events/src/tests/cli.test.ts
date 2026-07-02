// src/tests/cli.test.ts
// CLI tests including a real `tsc` compile guarantee for the generated scaffolds.
//   - generated event/listener scaffolds compile cleanly under tsc;
//   - invalid names abort generation with no file written (exitCode 1);
//   - existing targets are never overwritten (exitCode 1, content intact);
//   - fresh targets generate without error;
//   - the derived event name mapping (PascalCase → dot.case) is correct.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generateEvent,
  generateListener,
  isValidGeneratorName,
  writeScaffold,
} from '../cli/generators.js';
import { EventsCommands } from '../cli/commands.js';

const HERE = dirname(fileURLToPath(import.meta.url)); // dist/tests
const PACKAGE_ROOT = join(HERE, '..', '..');
const DIST_DIR = join(PACKAGE_ROOT, 'dist');

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'streetjs-events-cli-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function withIsolatedExitCode(
  body: () => void | Promise<void>,
): Promise<number | string | undefined> {
  const previous = process.exitCode;
  process.exitCode = undefined;
  try {
    await body();
    return process.exitCode;
  } finally {
    process.exitCode = previous;
  }
}

// ── tsc compile guarantee ──────────────────────────────────────────────────────

test('generated event and listener scaffolds compile cleanly under tsc', async () => {
  assert.ok(existsSync(join(DIST_DIR, 'index.d.ts')), 'build the package before running the CLI tsc test');

  await withTempDir((dir) => {
    const event = generateEvent('UserCreated', dir);
    const listener = generateListener('UserCreated', dir);
    writeScaffold(event);
    writeScaffold(listener);

    const distFromTmp = relative(dir, DIST_DIR).split('\\').join('/');
    const tsconfig = {
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        lib: ['ES2022'],
        types: [],
        paths: {
          '@streetjs/events': [`${distFromTmp}/index`],
          '@streetjs/events/*': [`${distFromTmp}/*`],
        },
      },
      include: ['*.ts'],
    };
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2), 'utf8');

    try {
      execFileSync('npx', ['--no-install', 'tsc', '--noEmit', '-p', join(dir, 'tsconfig.json')], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      assert.fail(
        `generated scaffolds failed to compile under tsc:\n${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`,
      );
    }
  });
});

// ── Name validation ─────────────────────────────────────────────────────────

test('isValidGeneratorName accepts identifiers and rejects unsafe names', () => {
  for (const ok of ['UserCreated', 'A', 'Order1', 'fooBar']) {
    assert.equal(isValidGeneratorName(ok), true, `"${ok}" should be valid`);
  }
  for (const bad of ['', ' ', '1abc', 'has-dash', 'a/b', 'a.b', 'has space']) {
    assert.equal(isValidGeneratorName(bad), false, `"${bad}" should be invalid`);
  }
});

test('the PascalCase → dot.case event name mapping is correct', () => {
  assert.match(generateEvent('UserCreated', '.').contents, /readonly type = 'user\.created'/);
  assert.match(generateEvent('OrderShipped', '.').contents, /readonly type = 'order\.shipped'/);
  assert.match(generateEvent('Ping', '.').contents, /readonly type = 'ping'/);
});

test('make:event with an invalid name writes no file and sets exitCode 1', async () => {
  await withTempDir(async (dir) => {
    const commands = new EventsCommands();
    const code = await withIsolatedExitCode(() => {
      commands.makeEvent({ command: 'make:event', positional: ['bad name!'], flags: { dir } });
    });
    assert.equal(code, 1);
    assert.ok(!existsSync(join(dir, 'Badname!.ts')));
  });
});

// ── No overwrite / fresh target ─────────────────────────────────────────────

test('make:event refuses to overwrite an existing target and leaves it intact', async () => {
  await withTempDir(async (dir) => {
    const commands = new EventsCommands();
    const target = generateEvent('UserCreated', dir).path;
    const sentinel = '// PRE-EXISTING — do not overwrite\n';
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, sentinel, 'utf8');

    const code = await withIsolatedExitCode(() => {
      commands.makeEvent({ command: 'make:event', positional: ['UserCreated'], flags: { dir } });
    });
    assert.equal(code, 1);
    assert.equal(readFileSync(target, 'utf8'), sentinel, 'existing content must be intact');
  });
});

test('make:listener generates a fresh target without error', async () => {
  await withTempDir(async (dir) => {
    const commands = new EventsCommands();
    const expected = generateListener('UserCreated', dir);
    const code = await withIsolatedExitCode(() => {
      commands.makeListener({ command: 'make:listener', positional: ['UserCreated'], flags: { dir } });
    });
    assert.ok(code === undefined || code === 0);
    assert.ok(existsSync(expected.path));
    assert.equal(readFileSync(expected.path, 'utf8'), expected.contents);
  });
});
