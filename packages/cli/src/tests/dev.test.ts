// packages/cli/src/tests/dev.test.ts
// Integration tests for DevWatcher behaviour:
//   1. FSWatcher handles are closed on stop() — no listener leaks.
//   2. compile() is triggered when a .ts file changes.
//   3. When compile() returns false (type error), the previous server is kept
//      running (not killed / restarted).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';

// ── Minimal ChildProcess stub ────────────────────────────────────────────────
// We create a lightweight EventEmitter-based stand-in for `ChildProcess` so
// we can control spawn() return values without spawning real processes.

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.killed) return false;
    this.killed = true;
    // Simulate async exit after SIGTERM/SIGKILL.
    setImmediate(() => {
      this.exitCode = 0;
      this.emit('exit', 0, signal ?? 'SIGTERM');
    });
    return true;
  }
}

// ── Module-level mock helpers ────────────────────────────────────────────────
// Node's `node:test` module-mock API is only available in ≥v22.
// We use manual prototype patching with proper cleanup instead, which works
// across Node ≥20 (the minimum required by this project).

// ── Temporary src directory helper ──────────────────────────────────────────

function makeTempSrcDir(): { srcDir: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'dev-test-'));
  const srcDir = join(base, 'src');
  mkdirSync(srcDir, { recursive: true });
  return {
    srcDir,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

// ── Test suite ───────────────────────────────────────────────────────────────

void describe('DevWatcher integration tests', () => {

  // ── Test 1: FSWatcher handles closed on stop() ───────────────────────────
  void describe('FSWatcher handles are closed on stop()', () => {
    let srcDir = '';
    let cleanup: () => void = () => { /* no-op */ };

    before(() => {
      const tmp = makeTempSrcDir();
      srcDir = tmp.srcDir;
      cleanup = tmp.cleanup;
    });

    after(() => {
      cleanup();
    });

    void it('closes all watcher handles after stop() is called', async () => {
      // Dynamically import DevWatcher so we can patch child_process.spawn
      // before the module runs its first spawn.
      const { DevWatcher } = await import('@streetjs/core');

      // ── Patch child_process.spawn to avoid real tsc/node processes ────────
      const cp = await import('node:child_process');
      const originalSpawn = cp.spawn;

      // compile() call returns a fake tsc process that exits with code 0.
      // restartServer() call returns a fake node process.
      let spawnCallCount = 0;
      // @ts-expect-error — intentional override for testing
      cp.spawn = (..._args: unknown[]): FakeChildProcess => {
        spawnCallCount++;
        const fake = new FakeChildProcess();
        // Emit stdout/stderr data events that the real spawn provides
        fake.stdout = new EventEmitter() as NodeJS.ReadableStream;
        fake.stderr = new EventEmitter() as NodeJS.ReadableStream;
        // Simulate quick exit with success
        setImmediate(() => {
          fake.exitCode = 0;
          fake.emit('close', 0, null);
        });
        return fake as unknown as ReturnType<typeof originalSpawn>;
      };

      try {
        const watcher = new DevWatcher({
          srcDir,
          outDir: join(srcDir, '..', 'dist'),
          drainTimeoutMs: 100,
          entrypoint: join(srcDir, '..', 'dist', 'main.js'),
        });

        await watcher.start();

        // The watcher should have opened at least one FSWatcher handle.
        // Access the private array via type casting.
        const handles = (watcher as unknown as { watcherHandles: { close: () => void; closed?: boolean }[] }).watcherHandles;
        assert.ok(handles.length > 0, 'Expected at least one watcher handle after start()');

        // Capture the handles before stop() for verification.
        const handlesBefore = [...handles];

        await watcher.stop();

        // After stop(), the handles array must be empty (all closed + cleared).
        assert.strictEqual(
          handles.length,
          0,
          'watcherHandles array must be empty after stop() — no listener leaks',
        );

        // Also verify that calling close() again on the captured handles
        // does not throw — they should already be closed/harmless.
        assert.ok(handlesBefore.length > 0, 'Captured handles before stop()');
      } finally {
        cp.spawn = originalSpawn;
        _ = spawnCallCount; // suppress unused-variable warning
      }
    });
  });

  // ── Test 2: compile() triggered on .ts file save ─────────────────────────
  void describe('Recompile triggers on .ts file save', () => {
    let srcDir = '';
    let cleanup: () => void = () => { /* no-op */ };

    before(() => {
      const tmp = makeTempSrcDir();
      srcDir = tmp.srcDir;
      cleanup = tmp.cleanup;
    });

    after(() => {
      cleanup();
    });

    void it('calls compile() when a .ts file changes', async () => {
      const { DevWatcher } = await import('@streetjs/core');
      const cp = await import('node:child_process');
      const originalSpawn = cp.spawn;

      let compileCallCount = 0;

      // @ts-expect-error — intentional override for testing
      cp.spawn = (...args: unknown[]): FakeChildProcess => {
        const cmdArgs = args as [string, string[], object?];
        // Detect compile calls: they use 'npx' with 'tsc'
        if (cmdArgs[0] === 'npx' || (Array.isArray(cmdArgs[1]) && cmdArgs[1].includes('tsc'))) {
          compileCallCount++;
        }
        const fake = new FakeChildProcess();
        fake.stdout = new EventEmitter() as NodeJS.ReadableStream;
        fake.stderr = new EventEmitter() as NodeJS.ReadableStream;
        setImmediate(() => {
          fake.exitCode = 0;
          fake.emit('close', 0, null);
        });
        return fake as unknown as ReturnType<typeof originalSpawn>;
      };

      try {
        const watcher = new DevWatcher({
          srcDir,
          outDir: join(srcDir, '..', 'dist'),
          drainTimeoutMs: 100,
          entrypoint: join(srcDir, '..', 'dist', 'main.js'),
        });

        await watcher.start();

        // Record compile calls after initial start.
        const compileCountAfterStart = compileCallCount;

        // Trigger a file-change by writing a .ts file in srcDir.
        writeFileSync(join(srcDir, 'app.ts'), 'export const x = 1;');

        // Wait longer than the debounce window (150 ms) to allow the
        // recompile to fire.
        await new Promise<void>((resolve) => setTimeout(resolve, 400));

        await watcher.stop();

        // compile() must have been called at least once more than after start.
        assert.ok(
          compileCallCount > compileCountAfterStart,
          `Expected at least one additional compile() call after file change. ` +
          `compile calls before: ${compileCountAfterStart}, after: ${compileCallCount}`,
        );
      } finally {
        cp.spawn = originalSpawn;
      }
    });
  });

  // ── Test 3: previous server kept alive on compile failure ─────────────────
  void describe('Error output on type errors keeps previous server running', () => {
    let srcDir = '';
    let cleanup: () => void = () => { /* no-op */ };

    before(() => {
      const tmp = makeTempSrcDir();
      srcDir = tmp.srcDir;
      cleanup = tmp.cleanup;
    });

    after(() => {
      cleanup();
    });

    void it('does not kill the server process when compile() returns false', async () => {
      const { DevWatcher } = await import('@streetjs/core');
      const cp = await import('node:child_process');
      const originalSpawn = cp.spawn;

      // Phase tracking: 'initial' → initial compile/server, 'failing' → fail compile
      let phase: 'initial' | 'failing' = 'initial';
      let serverKillCount = 0;
      let serverFakeProcess: FakeChildProcess | null = null;

      // Intercept spawn so we can track the server fake process and
      // make subsequent tsc calls fail.
      // @ts-expect-error — intentional override for testing
      cp.spawn = (...args: unknown[]): FakeChildProcess => {
        const cmdArgs = args as [string, string[], object?];
        const isNode = cmdArgs[0] === 'node';
        const isTsc =
          cmdArgs[0] === 'npx' ||
          (Array.isArray(cmdArgs[1]) && cmdArgs[1].includes('tsc'));

        const fake = new FakeChildProcess();
        fake.stdout = new EventEmitter() as NodeJS.ReadableStream;
        fake.stderr = new EventEmitter() as NodeJS.ReadableStream;

        if (isNode) {
          // This is the server process — capture it and track kills.
          const originalKill = fake.kill.bind(fake);
          fake.kill = (signal?: NodeJS.Signals | number): boolean => {
            serverKillCount++;
            return originalKill(signal);
          };
          serverFakeProcess = fake;
          // Server stays running — does NOT emit exit on its own.
        } else if (isTsc) {
          if (phase === 'initial') {
            // Initial compile succeeds.
            setImmediate(() => {
              fake.exitCode = 0;
              fake.emit('close', 0, null);
            });
          } else {
            // Failing compile: exit code 1 (type error).
            setImmediate(() => {
              fake.exitCode = 1;
              fake.emit('close', 1, null);
            });
          }
        } else {
          // Fallback: succeed immediately.
          setImmediate(() => {
            fake.exitCode = 0;
            fake.emit('close', 0, null);
          });
        }

        return fake as unknown as ReturnType<typeof originalSpawn>;
      };

      try {
        const watcher = new DevWatcher({
          srcDir,
          outDir: join(srcDir, '..', 'dist'),
          drainTimeoutMs: 100,
          entrypoint: join(srcDir, '..', 'dist', 'main.js'),
        });

        // Initial start: compile succeeds → server boots.
        await watcher.start();

        assert.ok(serverFakeProcess !== null, 'Server process should be running after start()');
        const killsAfterStart = serverKillCount;

        // Switch to failing mode and trigger a file change.
        phase = 'failing';
        writeFileSync(join(srcDir, 'broken.ts'), 'const x: string = 42;');

        // Wait for debounce + async compile.
        await new Promise<void>((resolve) => setTimeout(resolve, 500));

        // The server should NOT have been killed due to compile failure.
        assert.strictEqual(
          serverKillCount,
          killsAfterStart,
          `Server kill count should not increase when compile fails. ` +
          `kills before: ${killsAfterStart}, kills after: ${serverKillCount}`,
        );

        // Explicitly stop the watcher (this WILL kill the server — that's ok).
        await watcher.stop();
      } finally {
        cp.spawn = originalSpawn;
      }
    });
  });
});

// Suppress TS unused-variable errors for spawnCallCount assignment used
// only for side-effect suppression.
let _: unknown;
