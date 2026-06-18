// create-boot.integration.test.ts
// Integration test (Task 9): proves a freshly generated project actually STARTS.
//
// It scaffolds the default project (SQLite, zero-config), compiles it with the
// workspace TypeScript, boots `dist/main.js` exactly as `street dev` / `npm run
// dev` would, and asserts the HTTP server comes up and serves a request — i.e.
// no immediate database authentication failure on first run.
//
// The project is scaffolded INSIDE packages/cli (under a gitignored .itest dir)
// so Node/tsc resolve the workspace-linked `streetjs` the same way a real
// install would. If `streetjs` cannot be resolved (e.g. core not built), the
// test fails loudly rather than silently passing.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';

// .../packages/cli/dist/tests/<file>.js  →  packages/cli
const CLI_PKG = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TSC = join(CLI_PKG, '..', '..', 'node_modules', 'typescript', 'bin', 'tsc');

function httpGet(port: number, path: string): Promise<{ status: number }> {
  return new Promise((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: 4000 }, (res) => {
      res.resume();
      resolvePromise({ status: res.statusCode ?? 0 });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('request timeout')));
    req.end();
  });
}

async function waitForServer(port: number, timeoutMs: number): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const { status } = await httpGet(port, '/api/items');
      return status;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error(`server did not respond on :${port} within ${timeoutMs}ms (${String(lastErr)})`);
}

describe('generated project boots successfully (integration)', () => {
  it('default scaffold starts and serves a request with no database auth failure', { timeout: 120_000 }, async () => {
    const root = mkdtempSync(join(CLI_PKG, '.itest-'));
    const projectDir = join(root, 'my-app');
    let server: ReturnType<typeof spawn> | null = null;
    try {
      // 1) Scaffold the default project (SQLite, zero-config).
      const { CreateCommand } = await import('../commands/create.js');
      const ol = console.log, oe = console.error, ow = console.warn;
      console.log = () => {}; console.error = () => {}; console.warn = () => {};
      try {
        await new CreateCommand().execute({
          cwd: root,
          args: { command: 'create', positional: ['my-app'], flags: { 'no-lockfile': true } },
        } as never);
      } finally {
        console.log = ol; console.error = oe; console.warn = ow;
      }
      assert.ok(existsSync(join(projectDir, 'src', 'main.ts')), 'scaffold produced src/main.ts');

      // 2) Compile with the workspace TypeScript (mirrors `street dev`).
      const tsc = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], {
        cwd: projectDir, encoding: 'utf8',
      });
      assert.equal(tsc.status, 0, `tsc failed:\n${tsc.stdout}\n${tsc.stderr}`);
      assert.ok(existsSync(join(projectDir, 'dist', 'main.js')), 'compiled dist/main.js');

      // 3) Boot the server on an ephemeral-ish test port with ZERO db/secret env
      //    (the exact "first run" scenario). NODE_ENV stays development.
      const port = 3100 + Math.floor(Math.random() * 800);
      server = spawn(process.execPath, ['dist/main.js'], {
        cwd: projectDir,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'development' },
        stdio: 'ignore',
      });
      const exited = new Promise<number>((r) => server!.on('exit', (c) => r(c ?? -1)));

      // 4) The server must come up and serve /api/items (DB-backed, sqlite).
      const status = await Promise.race([
        waitForServer(port, 30_000),
        exited.then((c) => { throw new Error(`server process exited early with code ${c}`); }),
      ]);
      assert.equal(status, 200, '/api/items returns 200 on a fresh sqlite project');
    } finally {
      if (server && !server.killed) server.kill('SIGKILL');
      rmSync(root, { recursive: true, force: true });
    }
  });
});
