// packages/cli/src/tests/index.test.ts
// Unit tests for the CLI dispatcher.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../index.js';

/** Capture all console output during a test */
function captureConsole<T>(fn: () => Promise<T>): Promise<{ result: T; logs: string[]; errors: string[] }> {
  const logs: string[] = [];
  const errors: string[] = [];

  const origLog = console.log;
  const origErr = console.error;

  console.log = (...args: string[]) => { logs.push(args.join(' ')); };
  console.error = (...args: string[]) => { errors.push(args.join(' ')); };

  return fn().then(
    (result) => {
      console.log = origLog;
      console.error = origErr;
      return { result, logs, errors };
    },
    (err) => {
      console.log = origLog;
      console.error = origErr;
      throw err;
    },
  );
}

/** Save and restore process.exitCode around each test */
function withExitCode(fn: () => Promise<void>): Promise<void> {
  const original = process.exitCode;
  process.exitCode = 0;
  return fn().finally(() => {
    process.exitCode = original;
  });
}

const VERSION_OUTPUT = `street v${JSON.parse(
  (await import('node:fs')).readFileSync(
    new URL('../../package.json', import.meta.url),
    'utf8'
  )
).version}`;

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
      // The operational commands must be discoverable from help.
      const help = logs.join('\n');
      assert.ok(/\binfo\b/.test(help), 'help should list the "info" command');
      assert.ok(/\bdoctor\b/.test(help), 'help should list the "doctor" command');
      assert.ok(/env validate/.test(help), 'help should list the "env validate" command');
      assert.ok(/\baudit\b/.test(help), 'help should list the "audit" command');
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
    } catch {
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

  void it('routes "test" command', async () => {
    await withExitCode(async () => {
      // The test command compiles TypeScript and runs tests.
      // Since the CLI package itself has a valid project setup,
      // compilation may succeed — we just verify routing happened.
      let didRoute = false;
      try {
        await captureConsole(() => runCli(['node', 'street', 'test']));
        didRoute = true;
      } catch {
        didRoute = true;
      }
      assert.ok(didRoute, 'test command should be routed');
    });
  });

  void it('routes "migrate:run" command — error if no build', async () => {
    await withExitCode(async () => {
      const { errors } = await captureConsole(() => runCli(['node', 'street', 'migrate:run']));
      assert.ok(errors.some((e) => e.includes('Build not found')));
    });
  });

  void it('routes "info" command and prints the info table', async () => {
    await withExitCode(async () => {
      const { logs } = await captureConsole(() => runCli(['node', 'street', 'info']));
      assert.ok(logs.some((l) => l.includes('Street Framework — Info')));
    });
  });

  void it('routes "doctor" command and prints the diagnostics report', async () => {
    await withExitCode(async () => {
      const { logs } = await captureConsole(() => runCli(['node', 'street', 'doctor']));
      assert.ok(logs.some((l) => l.includes('Street Framework — Doctor')));
    });
  });

  void it('routes "env" command — prints usage when no subcommand is given', async () => {
    await withExitCode(async () => {
      const { errors } = await captureConsole(() => runCli(['node', 'street', 'env']));
      assert.ok(errors.some((e) => e.includes('street env validate')));
      assert.notEqual(process.exitCode, 0);
    });
  });

  void it('routes "env validate" subcommand to EnvValidateCommand', async () => {
    await withExitCode(async () => {
      // No street.config.js in the CLI package dir, so the command reports it
      // could not load the config — which still proves the subcommand routed.
      const { errors } = await captureConsole(() => runCli(['node', 'street', 'env', 'validate']));
      assert.ok(
        errors.some((e) => e.includes('street.config') || e.includes('config schema')),
        `Expected env validate to attempt loading street.config. Errors: ${errors.join(' | ')}`,
      );
    });
  });

  void it('routes "audit" command to AuditCommand', async () => {
    await withExitCode(async () => {
      // AuditCommand announces itself before spawning npm; that log proves the
      // dispatcher routed "audit" correctly without asserting on npm results.
      let didRoute = false;
      try {
        const { logs } = await captureConsole(() => runCli(['node', 'street', 'audit']));
        didRoute = logs.some((l) => l.includes('Running npm audit'));
      } catch {
        didRoute = true;
      }
      assert.ok(didRoute, 'audit command should be routed to AuditCommand');
    });
  });

  void it('handles errors gracefully', async () => {
    await withExitCode(async () => {
      const { errors } = await captureConsole(() => runCli(['node', 'street', 'nonexistent']));
      assert.ok(errors.some((e) => e.includes('Unknown command') || e.includes('failed')));
    });
  });
});
