// packages/cli/src/tests/marzpay-overlay.test.ts
// Integration test for the SaaS MarzPay overlay gating (Task 11.2).
//
// Asserts that `--starter saas --with-marzpay` emits the flag-gated MarzPay
// billing modules AND adds the @streetjs/plugin-marzpay dependency, while a
// plain `--starter saas` (no flag) emits NONE of those files and does NOT add
// the dependency.
//
// Validates: Requirements 6.1, 6.2, 5.5

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCommand } from '../commands/create.js';

interface CapturedOutput {
  logs: string[];
  errors: string[];
}

/** Run a test body in an isolated temp directory and clean it up afterwards. */
function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'street-marzpay-test-'));
  return fn(tmpDir).finally(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });
}

/** Silence console output during scaffolding. */
function captureCallbacks(): { output: CapturedOutput; restore: () => void } {
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

/** Build a CliContext for `street create` with the given flags. */
function makeContext(cwd: string, positionals: string[], flags: Record<string, string | boolean> = {}) {
  return {
    cwd,
    args: {
      command: 'create',
      positional: positionals,
      // --no-lockfile so the scaffold never spawns a network npm install.
      flags: { 'no-lockfile': true, ...flags },
    },
  };
}

/** Scaffold a project and return its generated directory. */
async function scaffold(tmpDir: string, name: string, flags: Record<string, string | boolean>): Promise<string> {
  process.exitCode = 0;
  const { restore } = captureCallbacks();
  try {
    const cmd = new CreateCommand();
    await cmd.execute(makeContext(tmpDir, [name], flags));
  } finally {
    restore();
  }
  assert.equal(process.exitCode, 0, 'scaffold should succeed');
  return join(tmpDir, name);
}

// The flag-gated MarzPay billing module files (tagged `flag: 'with-marzpay'`).
const MARZPAY_FILES = [
  'src/modules/billing/marzpay-billing.service.ts',
  'src/modules/billing/marzpay-subscription.service.ts',
  'src/modules/billing/marzpay-checkout.controller.ts',
  'src/modules/billing/marzpay-webhook.controller.ts',
  'src/modules/dashboard/billing-dashboard.controller.ts',
  'migrations/004_marzpay_billing.sql',
  '.env.marzpay.example',
];

const MARZPAY_DEP = '@streetjs/plugin-marzpay';

function readDeps(projectDir: string): Record<string, string> {
  const pkg = JSON.parse(readFileSync(join(projectDir, 'package.json'), 'utf8'));
  return pkg.dependencies ?? {};
}

void describe('SaaS MarzPay overlay gating', () => {
  void it('emits the MarzPay modules + dependency with --starter saas --with-marzpay', async () => {
    await withTempDir(async (tmpDir) => {
      const projectDir = await scaffold(tmpDir, 'saas-marzpay-app', {
        starter: 'saas',
        'with-marzpay': true,
      });

      // (a) Every flag-gated MarzPay billing file must exist.
      for (const rel of MARZPAY_FILES) {
        assert.ok(
          existsSync(join(projectDir, rel)),
          `expected MarzPay file to be emitted: ${rel}`,
        );
      }

      // (b) The MarzPay plugin dependency must be present.
      const deps = readDeps(projectDir);
      assert.ok(
        Object.prototype.hasOwnProperty.call(deps, MARZPAY_DEP),
        `expected dependency ${MARZPAY_DEP} in generated package.json`,
      );
    });
  });

  void it('emits NONE of the MarzPay modules + no dependency with plain --starter saas', async () => {
    await withTempDir(async (tmpDir) => {
      const projectDir = await scaffold(tmpDir, 'saas-plain-app', {
        starter: 'saas',
      });

      // (a) None of the flag-gated MarzPay billing files may exist.
      for (const rel of MARZPAY_FILES) {
        assert.ok(
          !existsSync(join(projectDir, rel)),
          `MarzPay file should NOT be emitted without --with-marzpay: ${rel}`,
        );
      }

      // (b) The MarzPay plugin dependency must NOT be present.
      const deps = readDeps(projectDir);
      assert.ok(
        !Object.prototype.hasOwnProperty.call(deps, MARZPAY_DEP),
        `dependency ${MARZPAY_DEP} should NOT be added without --with-marzpay`,
      );
    });
  });
});
