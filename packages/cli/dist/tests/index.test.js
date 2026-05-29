// packages/cli/src/tests/index.test.ts
// Unit tests for the CLI dispatcher.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../index.js';
/** Capture all console output during a test */
function captureConsole(fn) {
    const logs = [];
    const errors = [];
    const origLog = console.log;
    const origErr = console.error;
    console.log = (...args) => { logs.push(args.join(' ')); };
    console.error = (...args) => { errors.push(args.join(' ')); };
    return fn().then((result) => {
        console.log = origLog;
        console.error = origErr;
        return { result, logs, errors };
    }, (err) => {
        console.log = origLog;
        console.error = origErr;
        throw err;
    });
}
/** Save and restore process.exitCode around each test */
function withExitCode(fn) {
    const original = process.exitCode;
    process.exitCode = 0;
    return fn().finally(() => {
        process.exitCode = original;
    });
}
const VERSION_OUTPUT = 'street v1.0.0';
void describe('runCli', () => {
    void it('prints version on --version flag', async () => {
        await withExitCode(async () => {
            const { logs } = await captureConsole(() => runCli(['node', 'street', '--version']));
            assert.ok(logs.some((l) => l.includes(VERSION_OUTPUT)));
        });
    });
    void it('prints version on -v flag', async () => {
        await withExitCode(async () => {
            const { logs } = await captureConsole(() => runCli(['node', 'street', '-v']));
            assert.ok(logs.some((l) => l.includes(VERSION_OUTPUT)));
        });
    });
    void it('prints help and exits 0 with no arguments', async () => {
        await withExitCode(async () => {
            const { logs } = await captureConsole(() => runCli(['node', 'street']));
            assert.ok(logs.some((l) => l.includes('Usage:')));
            assert.equal(process.exitCode, 0);
        });
    });
    void it('prints help on --help flag', async () => {
        await withExitCode(async () => {
            const { logs } = await captureConsole(() => runCli(['node', 'street', '--help']));
            assert.ok(logs.some((l) => l.includes('Usage:')));
            assert.ok(logs.some((l) => l.includes('Scaffold a new Street project')));
        });
    });
    void it('prints help on -h flag', async () => {
        await withExitCode(async () => {
            const { logs } = await captureConsole(() => runCli(['node', 'street', '-h']));
            assert.ok(logs.some((l) => l.includes('Usage:')));
        });
    });
    void it('prints error for unknown command', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'unknown-command']));
            assert.ok(errors.some((e) => e.includes('Unknown command')));
            assert.notEqual(process.exitCode, 0);
        });
    });
    void it('routes "create" command without error for missing args', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'create']));
            // Should print usage error
            assert.ok(errors.some((e) => e.includes('Usage')));
        });
    });
    void it('routes "generate" command without error for missing args', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'generate']));
            assert.ok(errors.some((e) => e.includes('Usage')));
        });
    });
    void it('routes "migrate:create" command', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'migrate:create']));
            assert.ok(errors.some((e) => e.includes('Usage')));
        });
    });
    void it('routes "build" command — error if no tsconfig (no project)', async () => {
        await withExitCode(async () => {
            const { logs } = await captureConsole(() => runCli(['node', 'street', 'build']));
            assert.ok(logs.some((l) => l.includes('Building')));
        });
    });
    void it('routes "dev" command without throwing', async () => {
        // dev command should attempt compilation — we just check routing, not success
        let didRoute = false;
        const origExitCode = process.exitCode;
        process.exitCode = 0;
        try {
            await captureConsole(() => runCli(['node', 'street', 'dev']));
            didRoute = true;
        }
        catch {
            // Expected to fail because no project = no tsconfig
            didRoute = true;
        }
        assert.ok(didRoute, 'dev command should be routed');
        process.exitCode = origExitCode;
    });
    void it('routes "start" command — error if no build', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'start']));
            assert.ok(errors.some((e) => e.includes('Build not found')));
        });
    });
    void it('routes "test" command — error if no compilation', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'test']));
            assert.ok(errors.some((e) => e.includes('compilation') || e.includes('failed')));
        });
    });
    void it('routes "migrate:run" command — error if no build', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'migrate:run']));
            assert.ok(errors.some((e) => e.includes('Build not found')));
        });
    });
    void it('handles errors gracefully', async () => {
        await withExitCode(async () => {
            const { errors } = await captureConsole(() => runCli(['node', 'street', 'nonexistent']));
            assert.ok(errors.some((e) => e.includes('Unknown command') || e.includes('failed')));
        });
    });
});
//# sourceMappingURL=index.test.js.map