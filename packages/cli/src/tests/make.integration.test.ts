// make.integration.test.ts
// Task 13.3 — CLI generator integration tests, including the tsc compile guarantee.
//
// Unit coverage for `make:channel` / `make:gateway` (name normalization, usage
// exits, template output) already lives in make.test.ts. This suite adds the
// end-to-end guarantees that cannot be asserted at the unit level:
//
//   • COMPILE (Req 14.4, 15.4) — run each generator into a scaffolded project
//     and invoke the workspace TypeScript against the project's own tsconfig to
//     PROVE the generated channel and gateway source compile cleanly (exit 0,
//     zero diagnostics). This is the real "generated code is compile-ready"
//     contract; a drift in the public `@streetjs/realtime` surface or a template
//     type error fails here with tsc's output.
//   • MISSING-NAME (Req 14.2, 15.2) — both commands exit non-zero and print the
//     `Usage: street make:<kind> <Name>` guidance, creating no files.
//   • NO-OVERWRITE (Req 14.3, 15.3) — a pre-existing target file is left
//     byte-for-byte intact and the command exits non-zero.
//
// ── Resolving @streetjs/realtime for tsc ────────────────────────────────────
// The generated files import only public `@streetjs/realtime` symbols. There is
// no `node_modules/@streetjs/realtime` symlink in this workspace, so the
// scaffolded project's tsconfig maps the bare specifier to the package's built
// declaration entry via `paths` (`@streetjs/realtime` → packages/realtime/dist/
// index.d.ts). Under TypeScript 6 `paths` needs no `baseUrl`. The realtime
// declarations transitively import from `streetjs`; the project is scaffolded
// INSIDE packages/cli (a gitignored `.itest-*` dir) so Node/tsc resolve the
// workspace-linked `streetjs` (node_modules/streetjs → packages/core) exactly
// as a real install would. If the realtime build or the workspace TypeScript is
// genuinely unavailable, the compile case fails loudly rather than silently
// passing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { MakeCommand } from '../commands/make.js';

// .../packages/cli/dist/tests/<file>.js  →  packages/cli
const CLI_PKG = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// Workspace TypeScript (the same binary the create-boot integration test uses).
const TSC = join(CLI_PKG, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');
// The built @streetjs/realtime declaration entry the generated files import from.
const REALTIME_DTS = join(CLI_PKG, '..', 'realtime', 'dist', 'index.d.ts');

/** Silence a command's console output while still restoring the originals. */
function captureConsole(): { errors: string[]; restore: () => void } {
  const errors: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = () => {};
  console.error = (...args: unknown[]) => { errors.push(args.join(' ')); };
  return {
    errors,
    restore: () => { console.log = origLog; console.error = origErr; },
  };
}

function channelCtx(cwd: string, positional: string[]) {
  return { cwd, args: { command: 'make:channel', positional, flags: {} as Record<string, string | boolean> } };
}

function gatewayCtx(cwd: string, positional: string[]) {
  return { cwd, args: { command: 'make:gateway', positional, flags: {} as Record<string, string | boolean> } };
}

/**
 * Run `fn` with `process.exitCode` reset to 0, returning the exit code the
 * command-under-test set. Always restores the runner's own exit code so a
 * non-zero code from a command does not leak into the test process status.
 */
async function withExitCode(fn: () => Promise<void>): Promise<number> {
  const prior = process.exitCode;
  process.exitCode = 0;
  try {
    await fn();
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } finally {
    process.exitCode = prior ?? 0;
  }
}

/** Write the scaffolded project's tsconfig that maps @streetjs/realtime for tsc. */
function writeProjectTsconfig(projectDir: string): void {
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      noEmit: true,
      lib: ['ES2022'],
      types: ['node'],
      // TS6: `paths` needs no baseUrl. Point the bare specifier at the built
      // declaration entry so tsc resolves the public realtime surface.
      paths: {
        '@streetjs/realtime': [REALTIME_DTS],
      },
    },
    include: ['src/**/*'],
  };
  writeFileSync(join(projectDir, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`, 'utf8');
  writeFileSync(
    join(projectDir, 'package.json'),
    `${JSON.stringify({ name: 'make-itest-app', version: '0.0.0', private: true, type: 'module' }, null, 2)}\n`,
    'utf8',
  );
}

describe('street make:* generators (integration)', () => {
  it(
    'generated channel and gateway compile cleanly under the project tsconfig (14.4, 15.4)',
    { timeout: 120_000 },
    async () => {
      // Pre-req: the realtime build the generated files import from must exist.
      assert.ok(
        existsSync(REALTIME_DTS),
        `@streetjs/realtime build not found at ${REALTIME_DTS} — build packages/realtime first`,
      );
      assert.ok(existsSync(TSC), `workspace TypeScript not found at ${TSC}`);

      const root = mkdtempSync(join(CLI_PKG, '.itest-make-'));
      const projectDir = join(root, 'app');
      try {
        mkdirSync(projectDir, { recursive: true });

        // 1) Run BOTH generators into the scaffolded project.
        const { restore } = captureConsole();
        let channelExit = 0;
        let gatewayExit = 0;
        try {
          channelExit = await withExitCode(() =>
            new MakeCommand().executeChannel(channelCtx(projectDir, ['Chat'])),
          );
          gatewayExit = await withExitCode(() =>
            new MakeCommand().executeGateway(gatewayCtx(projectDir, ['Chat'])),
          );
        } finally {
          restore();
        }
        assert.equal(channelExit, 0, 'make:channel exits 0');
        assert.equal(gatewayExit, 0, 'make:gateway exits 0');

        const channelFile = join(projectDir, 'src', 'channels', 'ChatChannel.ts');
        const gatewayFile = join(projectDir, 'src', 'gateways', 'ChatGateway.ts');
        assert.ok(existsSync(channelFile), 'generated src/channels/ChatChannel.ts');
        assert.ok(existsSync(gatewayFile), 'generated src/gateways/ChatGateway.ts');

        // 2) Write the tsconfig that resolves @streetjs/realtime for tsc.
        writeProjectTsconfig(projectDir);

        // 3) Invoke the workspace tsc against the project's tsconfig. Exit 0 with
        //    no diagnostics PROVES the generated channel + gateway compile cleanly.
        const tsc = spawnSync(process.execPath, [TSC, '--noEmit', '-p', 'tsconfig.json'], {
          cwd: projectDir, encoding: 'utf8',
        });
        assert.equal(
          tsc.status,
          0,
          `tsc must compile the generated files cleanly:\n${tsc.stdout}\n${tsc.stderr}`,
        );
        // Defensive: tsc writes diagnostics to stdout; assert none leaked even on
        // a zero exit (guards against a future flag change).
        assert.ok(
          !/error TS\d+/.test(`${tsc.stdout}\n${tsc.stderr}`),
          `no TypeScript diagnostics expected from the generated files:\n${tsc.stdout}\n${tsc.stderr}`,
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('make:channel and make:gateway exit non-zero with usage on a missing name (14.2, 15.2)', async () => {
    const root = mkdtempSync(join(CLI_PKG, '.itest-make-'));
    try {
      // make:channel — missing name.
      {
        const { errors, restore } = captureConsole();
        const exit = await withExitCode(() =>
          new MakeCommand().executeChannel(channelCtx(root, [])),
        );
        restore();
        assert.notEqual(exit, 0, 'make:channel exits non-zero on missing name');
        assert.ok(
          errors.some((e) => e.includes('Usage: street make:channel <Name>')),
          'make:channel prints usage guidance',
        );
        assert.ok(!existsSync(join(root, 'src', 'channels')), 'no channel dir created on missing name');
      }

      // make:gateway — missing name.
      {
        const { errors, restore } = captureConsole();
        const exit = await withExitCode(() =>
          new MakeCommand().executeGateway(gatewayCtx(root, [])),
        );
        restore();
        assert.notEqual(exit, 0, 'make:gateway exits non-zero on missing name');
        assert.ok(
          errors.some((e) => e.includes('Usage: street make:gateway <Name>')),
          'make:gateway prints usage guidance',
        );
        assert.ok(!existsSync(join(root, 'src', 'gateways')), 'no gateway dir created on missing name');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('make:channel and make:gateway do not overwrite existing files and exit non-zero (14.3, 15.3)', async () => {
    const root = mkdtempSync(join(CLI_PKG, '.itest-make-'));
    const sentinel = '// pre-existing content — must not be overwritten\n';
    try {
      // make:channel — no overwrite.
      {
        const channelsDir = join(root, 'src', 'channels');
        mkdirSync(channelsDir, { recursive: true });
        const filePath = join(channelsDir, 'ChatChannel.ts');
        writeFileSync(filePath, sentinel, 'utf8');

        const { errors, restore } = captureConsole();
        const exit = await withExitCode(() =>
          new MakeCommand().executeChannel(channelCtx(root, ['Chat'])),
        );
        restore();
        assert.notEqual(exit, 0, 'make:channel exits non-zero when target exists');
        assert.ok(errors.some((e) => e.includes('already exists')), 'reports the file already exists');
        assert.equal(readFileSync(filePath, 'utf8'), sentinel, 'channel file left byte-for-byte intact');
      }

      // make:gateway — no overwrite.
      {
        const gatewaysDir = join(root, 'src', 'gateways');
        mkdirSync(gatewaysDir, { recursive: true });
        const filePath = join(gatewaysDir, 'ChatGateway.ts');
        writeFileSync(filePath, sentinel, 'utf8');

        const { errors, restore } = captureConsole();
        const exit = await withExitCode(() =>
          new MakeCommand().executeGateway(gatewayCtx(root, ['Chat'])),
        );
        restore();
        assert.notEqual(exit, 0, 'make:gateway exits non-zero when target exists');
        assert.ok(errors.some((e) => e.includes('already exists')), 'reports the file already exists');
        assert.equal(readFileSync(filePath, 'utf8'), sentinel, 'gateway file left byte-for-byte intact');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
