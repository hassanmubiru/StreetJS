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
// Lightweight EventEmitter-based stand-in for ChildProcess so we can control
// spawn() return values without spawning real processes.

class FakeChildProcess extends EventEmitter {
  exitCode: number | null = null;
  killed = false;
  // DevWatcher pipes stdout/stderr; provide readable EventEmitter stubs.
  readonly stdout: NodeJS.ReadableStream = new EventEmitter() as unknown as NodeJS.ReadableStream;
  readonly stderr: NodeJS.ReadableStream = new EventEmitter() as unknown as NodeJS.ReadableStream;

  kill(signal?: NodeJS.Signals | number): boolean {
    if (this.killed) return false;
    this.killed = true;
    setImmediate(() => {
      this.exitCode = 0;
      this.emit('exit', 0, signal ?? 'SIGTERM');
    });
    return true;
  }
}

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

// ── Spawn factory: always succeeds ──────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySpawn = (...args: any[]) => any;

function makeSuccessSpawn(): AnySpawn {
  return (..._args: unknown[]): FakeChildProcess => {
    const fake = new FakeChildProcess();
    setImmediate(() => {
      fake.exitCode = 0;
      fake.emit('close', 0, null);
    });
    return fake;
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
      const { DevWatcher } = await import('@streetjs/core');
      const cp = await import('node:child_process');
      const originalSpawn = cp.spawn;

      // @ts-expect-error — intentional runtime override for testing
      cp.spawn = makeSuccessSpawn();

      try {
        const watcher = new DevWatcher({
          srcDir,
          outDir: join(srcDir, '..', 'dist'),
          drainTimeoutMs: 100,
          entrypoint: join(srcDir, '..', 'dist', 'main.js'),
        });

        await watcher.start();

        // Access the private handles array via type casting.
        type WatcherInternals = { watcherHandles: Array<{ close: () => void }> };
        const handles = (watcher as unknown as WatcherInternals).watcherHandles;

        assert.ok(handles.length > 0, 'Expected at least one FSWatcher handle after start()');

        const countBefore = handles.length;

        await watcher.stop();

        // After stop(), the internal array must be cleared (all handles closed).
        assert.strictEqual(
          handles.length,
          0,
          `watcherHandles must be empty after stop() — no listener leaks. Had ${countBefore} before stop.`,
        );
      } finally {
        cp.spawn = originalSpawn;
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

      // @ts-expect-error — intentional runtime override for testing
      cp.spawn = (...args: unknown[]): FakeChildProcess => {
        const [cmd, cmdArgs] = args as [string, string[]];
        // DevWatcher spawns 'npx' ['tsc', '--incremental'] for compilation.
        const isTsc =
          cmd === 'npx' ||
          (Array.isArray(cmdArgs) && cmdArgs.includes('tsc'));
        if (isTsc) compileCallCount++;

        const fake = new FakeChildProcess();
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

        // Record compile count after initial boot.
        const compileCountAfterStart = compileCallCount;

        // Trigger a file-change by writing a .ts file in srcDir.
        writeFileSync(join(srcDir, 'app.ts'), 'export const x = 1;');

        // Wait longer than the debounce window (150 ms) to allow recompile to fire.
        await new Promise<void>((resolve) => setTimeout(resolve, 400));

        await watcher.stop();

        assert.ok(
          compileCallCount > compileCountAfterStart,
          `Expected at least one additional compile() call after file change. ` +
          `Calls before trigger: ${compileCountAfterStart}, after: ${compileCallCount}`,
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

      // 'initial' = first compile+server; 'failing' = simulate type error
      let phase: 'initial' | 'failing' = 'initial';
      let serverKillCount = 0;
      let serverFakeProcess: FakeChildProcess | null = null;

      // @ts-expect-error — intentional runtime override for testing
      cp.spawn = (...args: unknown[]): FakeChildProcess => {
        const [cmd, cmdArgs] = args as [string, string[]];

        const isNode = cmd === 'node';
        const isTsc =
          cmd === 'npx' ||
          (Array.isArray(cmdArgs) && cmdArgs.includes('tsc'));

        const fake = new FakeChildProcess();

        if (isNode) {
          // Server process: track kill() calls, stay running indefinitely.
          const originalKill = fake.kill.bind(fake);
          fake.kill = (signal?: NodeJS.Signals | number): boolean => {
            serverKillCount++;
            return originalKill(signal);
          };
          serverFakeProcess = fake;
          // Intentionally do NOT emit 'exit' — server stays "alive".
        } else if (isTsc) {
          if (phase === 'initial') {
            // Initial compile succeeds → server can boot.
            setImmediate(() => {
              fake.exitCode = 0;
              fake.emit('close', 0, null);
            });
          } else {
            // Failing compile (type error) → exit code 1.
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

        // Wait for debounce (150 ms) + async compile to complete.
        await new Promise<void>((resolve) => setTimeout(resolve, 500));

        // The server must NOT have been killed due to the compile failure.
        assert.strictEqual(
          serverKillCount,
          killsAfterStart,
          `Server must not be killed when compile() returns false. ` +
          `kills before: ${killsAfterStart}, kills after: ${serverKillCount}`,
        );

        // Stop the watcher (this legitimately kills the server — that's fine).
        await watcher.stop();
      } finally {
        cp.spawn = originalSpawn;
      }
    });
  });
});
