// packages/cli/src/tests/dev.test.ts
// Integration tests for DevWatcher behaviour:
//   1. FSWatcher handles are closed on stop() — no listener leaks.
//   2. compile() is triggered when a .ts file changes.
//   3. When compile() returns false (type error), the previous server is kept
//      running (not killed / restarted).
//
// Strategy: subclass DevWatcher and override compile() / restartServer() so
// we never spawn real OS processes. This avoids ESM read-only module patching
// issues and keeps tests fast and hermetic.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DevWatcher } from '@streetjs/core';

// ── Types ────────────────────────────────────────────────────────────────────

type WatcherInternals = { watcherHandles: Array<{ close: () => void }> };

// ── Subclass helpers ─────────────────────────────────────────────────────────

/**
 * A DevWatcher that overrides compile() and restartServer() to avoid spawning
 * real processes. compile() returns a configurable result; restartServer()
 * records call counts.
 */
class TestableWatcher extends DevWatcher {
  compileCallCount = 0;
  restartCallCount = 0;
  compileResult = true; // set to false to simulate a type error

  override async compile(): Promise<boolean> {
    this.compileCallCount++;
    return Promise.resolve(this.compileResult);
  }

  override async restartServer(): Promise<void> {
    this.restartCallCount++;
    return Promise.resolve();
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTempSrcDir(): { srcDir: string; cleanup: () => void } {
  const base = mkdtempSync(join(tmpdir(), 'dev-test-'));
  const srcDir = join(base, 'src');
  mkdirSync(srcDir, { recursive: true });
  return { srcDir, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function makeWatcher(srcDir: string, compileResult = true): TestableWatcher {
  const watcher = new TestableWatcher({
    srcDir,
    outDir: join(srcDir, '..', 'dist'),
    drainTimeoutMs: 100,
    entrypoint: join(srcDir, '..', 'dist', 'main.js'),
  });
  watcher.compileResult = compileResult;
  return watcher;
}

// ── Test suite ───────────────────────────────────────────────────────────────

void describe('DevWatcher integration tests', () => {

  // ── Test 1: FSWatcher handles closed on stop() ───────────────────────────
  void describe('FSWatcher handles are closed on stop()', () => {
    let srcDir = '';
    let cleanup: () => void = () => { /* no-op */ };

    before(() => {
      ({ srcDir, cleanup } = makeTempSrcDir());
    });

    after(() => { cleanup(); });

    void it('closes all watcher handles after stop() is called', async () => {
      const watcher = makeWatcher(srcDir);

      await watcher.start();

      // Access the private handles array via type cast.
      const handles = (watcher as unknown as WatcherInternals).watcherHandles;
      const countBefore = handles.length;

      assert.ok(countBefore > 0, 'Expected at least one FSWatcher handle after start()');

      await watcher.stop();

      // After stop(), all handles must be closed and the array emptied.
      assert.strictEqual(
        handles.length,
        0,
        `watcherHandles must be empty after stop() — no listener leaks. Had ${countBefore} before stop.`,
      );
    });
  });

  // ── Test 2: compile() triggered on .ts file save ─────────────────────────
  void describe('Recompile triggers on .ts file save', () => {
    let srcDir = '';
    let cleanup: () => void = () => { /* no-op */ };

    before(() => {
      ({ srcDir, cleanup } = makeTempSrcDir());
    });

    after(() => { cleanup(); });

    void it('calls compile() when a .ts file changes', async () => {
      const watcher = makeWatcher(srcDir);

      await watcher.start();
      const compileCountAfterStart = watcher.compileCallCount;

      // Trigger a file-change event by writing a .ts file into srcDir.
      writeFileSync(join(srcDir, 'app.ts'), 'export const x = 1;');

      // Wait longer than the debounce window (150 ms) so the recompile fires.
      await new Promise<void>((resolve) => setTimeout(resolve, 400));

      await watcher.stop();

      assert.ok(
        watcher.compileCallCount > compileCountAfterStart,
        `Expected at least one additional compile() call after file change. ` +
        `Calls before trigger: ${compileCountAfterStart}, after: ${watcher.compileCallCount}`,
      );
    });
  });

  // ── Test 3: previous server kept alive on compile failure ─────────────────
  void describe('Error output on type errors keeps previous server running', () => {
    let srcDir = '';
    let cleanup: () => void = () => { /* no-op */ };

    before(() => {
      ({ srcDir, cleanup } = makeTempSrcDir());
    });

    after(() => { cleanup(); });

    void it('does not restart the server when compile() returns false', async () => {
      // Start with successful compilation so the server boots once.
      const watcher = makeWatcher(srcDir, true);

      await watcher.start();

      // Record server restarts after initial boot.
      const restartCountAfterStart = watcher.restartCallCount;

      // Switch to compile-failure mode.
      watcher.compileResult = false;

      // Trigger a .ts file change.
      writeFileSync(join(srcDir, 'broken.ts'), 'const x: string = 42;');

      // Wait for debounce (150 ms) + async compile to complete.
      await new Promise<void>((resolve) => setTimeout(resolve, 400));

      await watcher.stop();

      // restartServer() must NOT have been called again — the existing server
      // should remain alive when compile() returns false.
      assert.strictEqual(
        watcher.restartCallCount,
        restartCountAfterStart,
        `restartServer() must not be called when compile() returns false. ` +
        `restarts before: ${restartCountAfterStart}, after: ${watcher.restartCallCount}`,
      );
    });
  });
});
