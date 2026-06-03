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
import * as cp from 'node:child_process';
// ── Minimal ChildProcess stub ────────────────────────────────────────────────
// Lightweight EventEmitter stand-in for ChildProcess so we can control
// spawn() return values without launching real OS processes.
class FakeChildProcess extends EventEmitter {
    exitCode = null;
    killed = false;
    // DevWatcher pipes .stdout / .stderr; provide readable EventEmitter stubs.
    stdout = new EventEmitter();
    stderr = new EventEmitter();
    kill(signal) {
        if (this.killed)
            return false;
        this.killed = true;
        setImmediate(() => {
            this.exitCode = 0;
            this.emit('exit', 0, signal ?? 'SIGTERM');
        });
        return true;
    }
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function makeTempSrcDir() {
    const base = mkdtempSync(join(tmpdir(), 'dev-test-'));
    const srcDir = join(base, 'src');
    mkdirSync(srcDir, { recursive: true });
    return { srcDir, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}
/** Create a FakeChildProcess that emits 'close' with the given exit code. */
function fakeProcess(exitCode, delayMs = 0) {
    const fake = new FakeChildProcess();
    const emit = () => {
        fake.exitCode = exitCode;
        fake.emit('close', exitCode, null);
    };
    if (delayMs > 0)
        setTimeout(emit, delayMs);
    else
        setImmediate(emit);
    return fake;
}
// ── Test suite ───────────────────────────────────────────────────────────────
void describe('DevWatcher integration tests', () => {
    // ── Test 1: FSWatcher handles closed on stop() ───────────────────────────
    void describe('FSWatcher handles are closed on stop()', () => {
        let srcDir = '';
        let cleanup = () => { };
        before(() => {
            ({ srcDir, cleanup } = makeTempSrcDir());
        });
        after(() => { cleanup(); });
        void it('closes all watcher handles after stop() is called', async () => {
            const { DevWatcher } = await import('@streetjs/core');
            const originalSpawn = cp.spawn;
            // Override spawn: all processes succeed immediately.
            cp.spawn = (..._args) => fakeProcess(0);
            try {
                const watcher = new DevWatcher({
                    srcDir,
                    outDir: join(srcDir, '..', 'dist'),
                    drainTimeoutMs: 100,
                    entrypoint: join(srcDir, '..', 'dist', 'main.js'),
                });
                await watcher.start();
                // Access the private handles array.
                const handles = watcher.watcherHandles;
                assert.ok(handles.length > 0, 'Expected at least one FSWatcher handle after start()');
                const countBefore = handles.length;
                await watcher.stop();
                // After stop() the internal array must be emptied (all handles closed).
                assert.strictEqual(handles.length, 0, `watcherHandles must be empty after stop() — no listener leaks. Had ${countBefore} before stop.`);
            }
            finally {
                cp.spawn = originalSpawn;
            }
        });
    });
    // ── Test 2: compile() triggered on .ts file save ─────────────────────────
    void describe('Recompile triggers on .ts file save', () => {
        let srcDir = '';
        let cleanup = () => { };
        before(() => {
            ({ srcDir, cleanup } = makeTempSrcDir());
        });
        after(() => { cleanup(); });
        void it('calls compile() when a .ts file changes', async () => {
            const { DevWatcher } = await import('@streetjs/core');
            const originalSpawn = cp.spawn;
            let compileCallCount = 0;
            cp.spawn = (...args) => {
                const [cmd, cmdArgs] = args;
                // DevWatcher compiles via: spawn('npx', ['tsc', '--incremental'], …)
                const isTsc = cmd === 'npx' || (Array.isArray(cmdArgs) && cmdArgs.includes('tsc'));
                if (isTsc)
                    compileCallCount++;
                return fakeProcess(0);
            };
            try {
                const watcher = new DevWatcher({
                    srcDir,
                    outDir: join(srcDir, '..', 'dist'),
                    drainTimeoutMs: 100,
                    entrypoint: join(srcDir, '..', 'dist', 'main.js'),
                });
                await watcher.start();
                const compileCountAfterStart = compileCallCount;
                // Trigger a file-change event by writing a .ts file into srcDir.
                writeFileSync(join(srcDir, 'app.ts'), 'export const x = 1;');
                // Wait longer than the debounce window (150 ms) so the recompile fires.
                await new Promise((resolve) => setTimeout(resolve, 400));
                await watcher.stop();
                assert.ok(compileCallCount > compileCountAfterStart, `Expected at least one additional compile() call after file change. ` +
                    `Calls before trigger: ${compileCountAfterStart}, after: ${compileCallCount}`);
            }
            finally {
                cp.spawn = originalSpawn;
            }
        });
    });
    // ── Test 3: previous server kept alive on compile failure ─────────────────
    void describe('Error output on type errors keeps previous server running', () => {
        let srcDir = '';
        let cleanup = () => { };
        before(() => {
            ({ srcDir, cleanup } = makeTempSrcDir());
        });
        after(() => { cleanup(); });
        void it('does not kill the server process when compile() returns false', async () => {
            const { DevWatcher } = await import('@streetjs/core');
            const originalSpawn = cp.spawn;
            // 'initial' = first compile succeeds; 'failing' = type error
            let phase = 'initial';
            let serverKillCount = 0;
            let serverFakeProcess = null;
            cp.spawn = (...args) => {
                const [cmd, cmdArgs] = args;
                const isNode = cmd === 'node';
                const isTsc = cmd === 'npx' || (Array.isArray(cmdArgs) && cmdArgs.includes('tsc'));
                if (isNode) {
                    // Server process: track kill() calls; never emit 'exit' on its own.
                    const fake = new FakeChildProcess();
                    const originalKill = fake.kill.bind(fake);
                    fake.kill = (signal) => {
                        serverKillCount++;
                        return originalKill(signal);
                    };
                    serverFakeProcess = fake;
                    return fake;
                }
                if (isTsc) {
                    // Compile: succeed on initial boot, fail with exit 1 on type errors.
                    return fakeProcess(phase === 'initial' ? 0 : 1);
                }
                // Fallback: succeed.
                return fakeProcess(0);
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
                // Switch to failing mode and trigger a .ts file change.
                phase = 'failing';
                writeFileSync(join(srcDir, 'broken.ts'), 'const x: string = 42;');
                // Wait for debounce (150 ms) + async compile to complete.
                await new Promise((resolve) => setTimeout(resolve, 500));
                // The running server must NOT have been killed due to compile failure.
                assert.strictEqual(serverKillCount, killsAfterStart, `Server must not be killed when compile() returns false. ` +
                    `kills before: ${killsAfterStart}, kills after: ${serverKillCount}`);
                // stop() legitimately kills the server — that's expected behaviour.
                await watcher.stop();
            }
            finally {
                cp.spawn = originalSpawn;
            }
        });
    });
});
//# sourceMappingURL=dev.test.js.map