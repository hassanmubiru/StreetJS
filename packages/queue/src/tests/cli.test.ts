// src/tests/cli.test.ts
// Task 16.2 — CLI tests, including a real `tsc` compile guarantee for the
// generated scaffolds.
//
// Coverage:
//   - Req 15.4: `make:job`/`make:worker` scaffolds compile cleanly under `tsc`.
//     Proven honestly by generating the scaffolds into an OS temp dir and
//     invoking the real TypeScript compiler (`tsc --noEmit`) over them with a
//     tsconfig whose `paths` resolve the scaffolds' `@streetjs/queue` import to
//     the built package `dist` — so the compile is against the real public
//     `.d.ts` surface, not a stub.
//   - Req 15.2 / 15.7: an invalid generator name aborts generation with NO file
//     written and sets `process.exitCode = 1`.
//   - Req 15.3: a generator refuses to overwrite an existing target, reports an
//     error (exit code 1), and leaves the existing content intact.
//   - Req 15.6: a non-existent target is generated without any overwrite error.
//   - Req 15.5: `queue:failed`/`queue:retry`/`queue:flush` invoke the matching
//     `DeadLetterApi` operations with the expected arguments.
//
// All filesystem work happens in OS temp directories that are removed in a
// `finally`; nothing is written into the repository tree. `process.exitCode` is
// saved and restored around assertions so a command that sets it does not fail
// the whole test process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';

import {
  generateJob,
  generateWorker,
  isValidGeneratorName,
  writeScaffold,
} from '../cli/generators.js';
import { QueueCommands } from '../cli/commands.js';
import type { Queue, DeadLetterApi } from '../facade.js';
import type { DeadLetterRecord } from '../job.js';

// ── Path helpers ─────────────────────────────────────────────────────────────

// From `dist/tests/cli.test.js`, the package root is two directories up.
const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..', '..');
const DIST_DIR = join(PACKAGE_ROOT, 'dist');

/** Make a fresh OS temp dir for a test and hand it to `fn`, cleaning up after. */
function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'streetjs-queue-cli-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Run `body` with `process.exitCode` reset to `undefined`, then restore whatever
 * it was before — so a command that sets `exitCode = 1` cannot fail the whole
 * `node --test` process.
 */
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

// ── Req 15.4: the generated scaffolds compile cleanly under `tsc` ─────────────

test('make:job and make:worker scaffolds compile cleanly under tsc (Req 15.4)', () => {
  // Skip honestly (rather than fake a pass) if the built package surface the
  // scaffolds import against is missing — the scaffolds import '@streetjs/queue'
  // and we resolve that specifier to the package's built `.d.ts`.
  if (!existsSync(join(DIST_DIR, 'index.d.ts'))) {
    assert.fail(
      'dist/index.d.ts is missing — build the package (npm run build) before running the CLI tsc guarantee',
    );
  }

  withTempDir((dir) => {
    // 1) Generate the scaffolds and write them into the temp dir.
    const job = generateJob('SendEmail', dir);
    const worker = generateWorker('EmailWorker', dir);
    writeScaffold(job);
    writeScaffold(worker);
    assert.ok(existsSync(job.path), 'generated job file exists');
    assert.ok(existsSync(worker.path), 'generated worker file exists');

    // 2) Write a tsconfig that mirrors the package (NodeNext + strict) and maps
    //    the scaffolds' '@streetjs/queue' import to the built package surface,
    //    so the compile is against the REAL public `.d.ts` (Req 15.4).
    //    `paths` are resolved relative to `baseUrl`; use a relative path from
    //    the temp dir to the package `dist` so the config is location-agnostic.
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
        baseUrl: '.',
        lib: ['ES2022'],
        types: [],
        paths: {
          '@streetjs/queue': [`${distFromTmp}/index`],
          '@streetjs/queue/*': [`${distFromTmp}/*`],
        },
      },
      include: ['*.ts'],
    };
    const tsconfigPath = join(dir, 'tsconfig.json');
    writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');

    // 3) Invoke the real compiler. A clean compile (exit 0) proves Req 15.4.
    try {
      execFileSync('npx', ['--no-install', 'tsc', '--noEmit', '-p', tsconfigPath], {
        cwd: PACKAGE_ROOT,
        encoding: 'utf8',
        stdio: 'pipe',
        timeout: 120_000,
      });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      assert.fail(
        'generated scaffolds failed to compile under tsc (Req 15.4):\n' +
          `${e.stdout ?? ''}${e.stderr ?? ''}${e.message ?? ''}`,
      );
    }
  });
});

// ── Req 15.2 / 15.7: name validation aborts generation, writing no file ───────

test('isValidGeneratorName accepts identifiers and rejects unsafe names (Req 15.2, 15.7)', () => {
  for (const valid of ['SendEmail', 'A', 'a', 'Job1', 'fooBar123', 'X0']) {
    assert.equal(isValidGeneratorName(valid), true, `"${valid}" should be valid`);
  }
  for (const invalid of ['', ' ', '1abc', 'has-dash', 'a/b', 'a\\b', 'has space', 'a.b', '.', 'foo!']) {
    assert.equal(isValidGeneratorName(invalid), false, `"${invalid}" should be invalid`);
  }
});

test('make:job with an invalid name writes no file and sets exitCode 1 (Req 15.2, 15.7)', async () => {
  await withTempDir(async (dir) => {
    const commands = new QueueCommands();

    for (const badName of ['bad name!', '1abc', 'has-dash', 'a/b']) {
      const exitCode = await withIsolatedExitCode(() => {
        commands.makeJob({ command: 'make:job', positional: [badName], flags: { dir } });
      });
      assert.equal(exitCode, 1, `invalid name "${badName}" must set exitCode 1`);
    }

    // No file was written anywhere under the target dir (Req 15.7). The dir may
    // not even exist since generation aborted before any write.
    const targetJob = join(dir, 'Badname!.ts');
    assert.ok(!existsSync(targetJob), 'no scaffold file should be written for an invalid name');
  });
});

test('make:worker with an invalid name writes no file and sets exitCode 1 (Req 15.2, 15.7)', async () => {
  await withTempDir(async (dir) => {
    const commands = new QueueCommands();
    const exitCode = await withIsolatedExitCode(() => {
      commands.makeWorker({ command: 'make:worker', positional: ['not valid'], flags: { dir } });
    });
    assert.equal(exitCode, 1, 'invalid worker name must set exitCode 1');
    assert.ok(!existsSync(join(dir, 'Notvalid.ts')), 'no worker scaffold should be written');
  });
});

// ── Req 15.3: refuse to overwrite an existing target, leaving it intact ───────

test('make:job refuses to overwrite an existing target and leaves it intact (Req 15.3)', async () => {
  await withTempDir(async (dir) => {
    const commands = new QueueCommands();

    // Pre-create the exact target file the generator would produce.
    const target = generateJob('SendEmail', dir).path;
    const sentinel = '// PRE-EXISTING CONTENT — must not be overwritten\n';
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, sentinel, 'utf8');

    const exitCode = await withIsolatedExitCode(() => {
      commands.makeJob({ command: 'make:job', positional: ['SendEmail'], flags: { dir } });
    });

    assert.equal(exitCode, 1, 'overwrite refusal must report an error via exitCode 1');
    assert.equal(
      readFileSync(target, 'utf8'),
      sentinel,
      'the pre-existing file content must be left intact',
    );
  });
});

// ── Req 15.6: a non-existent target is generated with no overwrite error ──────

test('make:job generates a non-existent target without an overwrite error (Req 15.6)', async () => {
  await withTempDir(async (dir) => {
    const commands = new QueueCommands();
    const expected = generateJob('FreshJob', dir);

    assert.ok(!existsSync(expected.path), 'precondition: the target does not yet exist');

    const exitCode = await withIsolatedExitCode(() => {
      commands.makeJob({ command: 'make:job', positional: ['FreshJob'], flags: { dir } });
    });

    // No error reported (Req 15.6): exitCode remains unset (undefined) or 0.
    assert.ok(
      exitCode === undefined || exitCode === 0,
      `generation of a fresh target must not report an error (got exitCode ${String(exitCode)})`,
    );
    assert.ok(existsSync(expected.path), 'the target file was generated');
    assert.equal(
      readFileSync(expected.path, 'utf8'),
      expected.contents,
      'the generated file carries the scaffold contents',
    );
  });
});

// ── Req 15.5: queue:failed / queue:retry / queue:flush drive the DeadLetterApi ─

/** Records every DeadLetterApi call so the CLI wiring can be asserted. */
interface DeadLetterCalls {
  list: Array<{ queue?: string; limit?: number }>;
  retry: string[];
  retryAll: Array<string | undefined>;
  flush: Array<string | undefined>;
}

/**
 * Build a probe queue whose `deadLetters` records every call. Only the
 * `deadLetters` surface is exercised by these commands, so the rest of the
 * `Queue` shape is intentionally absent and the value is cast for injection.
 */
function makeProbeQueue(): { queue: Queue; calls: DeadLetterCalls } {
  const calls: DeadLetterCalls = { list: [], retry: [], retryAll: [], flush: [] };
  const deadLetters: DeadLetterApi = {
    async list(queue?: string, limit?: number): Promise<DeadLetterRecord[]> {
      calls.list.push({ queue, limit });
      return [];
    },
    async retry(jobId: string): Promise<void> {
      calls.retry.push(jobId);
    },
    async retryAll(queue?: string): Promise<number> {
      calls.retryAll.push(queue);
      return 0;
    },
    async flush(queue?: string): Promise<number> {
      calls.flush.push(queue);
      return 0;
    },
  };
  const queue = { deadLetters } as unknown as Queue;
  return { queue, calls };
}

test('queue:failed invokes DeadLetterApi.list, honoring an optional --queue scope (Req 15.5)', async () => {
  const { queue, calls } = makeProbeQueue();
  const commands = new QueueCommands({ queue });

  await commands.queueFailed({ command: 'queue:failed', positional: [], flags: {} });
  await commands.queueFailed({ command: 'queue:failed', positional: [], flags: { queue: 'emails' } });

  assert.equal(calls.list.length, 2, 'list called once per invocation');
  assert.deepEqual(calls.list[0], { queue: undefined, limit: undefined }, 'no --queue lists all queues');
  assert.deepEqual(calls.list[1], { queue: 'emails', limit: undefined }, '--queue scopes the listing');
});

test('queue:retry invokes DeadLetterApi.retry for a single job id (positional or --id) (Req 15.5)', async () => {
  const { queue, calls } = makeProbeQueue();
  const commands = new QueueCommands({ queue });

  await commands.queueRetry({ command: 'queue:retry', positional: ['job-1'], flags: {} });
  await commands.queueRetry({ command: 'queue:retry', positional: [], flags: { id: 'job-2' } });

  assert.deepEqual(calls.retry, ['job-1', 'job-2'], 'retry called with each requested job id');
  assert.equal(calls.retryAll.length, 0, 'retryAll is not used when a single job id is given');
});

test('queue:retry without a job id invokes DeadLetterApi.retryAll, honoring --queue (Req 15.5)', async () => {
  const { queue, calls } = makeProbeQueue();
  const commands = new QueueCommands({ queue });

  await commands.queueRetry({ command: 'queue:retry', positional: [], flags: {} });
  await commands.queueRetry({ command: 'queue:retry', positional: [], flags: { queue: 'emails' } });

  assert.deepEqual(calls.retryAll, [undefined, 'emails'], 'retryAll called with the optional queue scope');
  assert.equal(calls.retry.length, 0, 'single-id retry is not used without a job id');
});

test('queue:flush invokes DeadLetterApi.flush, honoring an optional --queue scope (Req 15.5)', async () => {
  const { queue, calls } = makeProbeQueue();
  const commands = new QueueCommands({ queue });

  await commands.queueFlush({ command: 'queue:flush', positional: [], flags: {} });
  await commands.queueFlush({ command: 'queue:flush', positional: [], flags: { queue: 'emails' } });

  assert.deepEqual(calls.flush, [undefined, 'emails'], 'flush called with the optional queue scope');
});
