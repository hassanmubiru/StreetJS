// scripts/tests/marzpay-examples.test.mjs
//
// Task 21.3 — Integration/smoke tests for the six runnable MarzPay example
// projects (examples/marzpay-{checkout,subscriptions,saas,htmx,react,next}).
//
// Two requirements are asserted for EACH example:
//
//   • Missing-env (Requirement 13.5): when a required environment variable is
//     UNSET, the example's bootstrap must exit with a NON-ZERO status and name
//     the missing variable in its output. This is fast, deterministic, and needs
//     no network — it ALWAYS runs.
//
//   • Startup / stays-up (Requirement 13.2): with EVERY required env var SET,
//     the example's documented run command (`node dist/main.js`, the package
//     `start` script) must start its process and remain running — without
//     emitting a fatal error or exiting — for at least 60 seconds.
//
// ── How the stays-up window is verified efficiently ─────────────────────────
// A literal 60s-per-example serial wait would take >6 minutes across six
// examples. Instead the six processes are started CONCURRENTLY, each is polled
// for its "listening" signal within a bounded readiness window, and then a
// single shared 60s window is held during which NONE of them may exit. That
// gives every process a real ≥60s up-time while keeping wall-clock near 60s.
//
// ── Offline robustness (mirrors marzpay-next-smoke) ─────────────────────────
// The examples import `streetjs` and `@streetjs/plugin-marzpay`, both resolved
// through the repo-root node_modules symlinks (no registry install needed), and
// are compiled with the repo's local TypeScript — so this runs fully offline in
// this monorepo. If, in some other environment, an example cannot be built
// (e.g. the workspace symlinks/plugin build are absent), the stays-up assertion
// for that example SKIPS gracefully with a clear message rather than failing.
// The missing-env exit-code assertions need only the compiled bootstrap and are
// reported per example.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// scripts/tests/<file>.mjs → repo root
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const EXAMPLES_DIR = join(REPO_ROOT, 'examples');
const TSC = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

// Placeholder credentials — the examples never make a real network call at
// startup, they only validate that the variables are present and well-formed.
const BASE_MARZPAY_ENV = {
  MARZPAY_API_KEY: 'test-marzpay-api-key',
  MARZPAY_SECRET: 'test-marzpay-secret',
  MARZPAY_ENVIRONMENT: 'sandbox',
};

// The six examples, each with its ORDERED required env-var list (matching the
// bootstrap's startup guard) and any frontend-specific extras. A unique PORT is
// assigned to each so the concurrent stays-up run never collides.
const EXAMPLES = [
  {
    dir: 'marzpay-checkout',
    required: ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'],
    extraEnv: {},
    port: 41010,
  },
  {
    dir: 'marzpay-subscriptions',
    required: ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'],
    extraEnv: {},
    port: 41011,
  },
  {
    dir: 'marzpay-saas',
    required: ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'],
    extraEnv: {},
    port: 41012,
  },
  {
    dir: 'marzpay-htmx',
    required: ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT'],
    extraEnv: {},
    port: 41013,
  },
  {
    dir: 'marzpay-react',
    required: ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT', 'VITE_API_URL'],
    extraEnv: { VITE_API_URL: 'http://localhost:41014' },
    port: 41014,
  },
  {
    dir: 'marzpay-next',
    required: ['MARZPAY_API_KEY', 'MARZPAY_SECRET', 'MARZPAY_ENVIRONMENT', 'NEXT_PUBLIC_API_URL'],
    extraEnv: { NEXT_PUBLIC_API_URL: 'http://localhost:41015' },
    port: 41015,
  },
];

// A backend that has started successfully prints both "[street] Listening on
// http://…" (from app.listen) and "… running on http://localhost:…". Either is
// an unambiguous healthy/ready signal.
const READY_RE = /(Listening on http|running on http)/i;

// Bounded readiness window and the required up-time window (Req 13.2).
const READY_TIMEOUT_MS = 30_000;
const STAY_UP_MS = 60_000;

// ── Helpers ─────────────────────────────────────────────────────────────────

function exampleDir(entry) {
  return join(EXAMPLES_DIR, entry.dir);
}

function mainEntry(entry) {
  return join(exampleDir(entry), 'dist', 'main.js');
}

/** Full env with every required variable + extras set to placeholder values. */
function fullEnvFor(entry) {
  return { ...BASE_MARZPAY_ENV, ...entry.extraEnv };
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Compile a single example with the repo's local TypeScript. Returns true on a
 * clean build that produced dist/main.js. Never throws — a failed/offline build
 * is reported to the caller so dependent assertions can skip gracefully.
 */
function buildExample(entry) {
  const res = spawnSync(TSC, ['-p', join(exampleDir(entry), 'tsconfig.json')], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const built = res.status === 0 && existsSync(mainEntry(entry));
  return {
    built,
    output: `${res.stdout ?? ''}${res.stderr ?? ''}`.trim(),
    status: res.status,
  };
}

/** Per-example build state, populated once in `before`. */
const buildState = new Map();

/**
 * Run the example bootstrap with `missingVar` UNSET (all other required vars
 * set). The startup guard checks vars in declared order and exits on the first
 * missing one, so removing exactly one — with all others present — makes that
 * variable the first (and only) missing one.
 */
function runWithMissing(entry, missingVar) {
  const env = { ...process.env, ...fullEnvFor(entry), PORT: String(entry.port) };
  delete env[missingVar];
  return spawnSync(process.execPath, [mainEntry(entry)], {
    cwd: exampleDir(entry),
    env,
    encoding: 'utf8',
    timeout: 20_000,
  });
}

/** Spawn an example with the full env and capture its output + lifecycle. */
function spawnExample(entry) {
  const env = { ...process.env, ...fullEnvFor(entry), PORT: String(entry.port) };
  const child = spawn(process.execPath, [mainEntry(entry)], {
    cwd: exampleDir(entry),
    env,
  });
  const proc = {
    label: entry.dir,
    child,
    output: '',
    ready: false,
    exited: false,
    exitInfo: null,
  };
  const onData = (buf) => {
    proc.output += buf.toString();
    if (READY_RE.test(proc.output)) proc.ready = true;
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code, signal) => {
    proc.exited = true;
    proc.exitInfo = { code, signal };
  });
  return proc;
}

/** Resolve once the process signals ready, or when it exits, or on timeout. */
async function waitUntilReadyOrExit(proc, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.ready) return 'ready';
    if (proc.exited) return 'exited';
    await delay(100);
  }
  return 'timeout';
}

function killProc(proc) {
  if (!proc.exited) {
    try {
      proc.child.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }
}

// ── Build all examples once ──────────────────────────────────────────────────

describe('MarzPay examples — startup & missing-env smoke (Task 21.3, Req 13.2/13.5)', () => {
  before(() => {
    for (const entry of EXAMPLES) {
      buildState.set(entry.dir, buildExample(entry));
    }
  });

  // ── Missing-env (Requirement 13.5): always-run, deterministic ──────────────
  describe('missing required env var → non-zero exit naming the variable (Req 13.5)', () => {
    for (const entry of EXAMPLES) {
      for (const missingVar of entry.required) {
        it(`${entry.dir}: exits non-zero and names ${missingVar} when it is unset`, () => {
          const state = buildState.get(entry.dir);
          assert.ok(
            state?.built,
            `example ${entry.dir} must compile to dist/main.js for the missing-env check ` +
              `(tsc status=${String(state?.status)}):\n${state?.output ?? ''}`,
          );

          const res = runWithMissing(entry, missingVar);
          const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;

          // Must NOT exit zero — a missing required var is a hard startup failure.
          assert.notEqual(
            res.status,
            0,
            `${entry.dir} must exit non-zero when ${missingVar} is unset (status=${String(res.status)}, signal=${String(res.signal)}):\n${out}`,
          );
          // The offending variable must be named in the output.
          assert.ok(
            out.includes(missingVar),
            `${entry.dir} output must name the missing variable ${missingVar}:\n${out}`,
          );
        });
      }
    }
  });

  // ── Startup / stays-up (Requirement 13.2): concurrent, real ≥60s window ────
  describe('starts and stays up ≥60s with all env set (Req 13.2)', () => {
    const liveProcs = [];

    after(() => {
      for (const proc of liveProcs) killProc(proc);
    });

    it(
      'all six examples start, become ready, and remain running for ≥60s',
      { timeout: STAY_UP_MS + READY_TIMEOUT_MS + 60_000 },
      async (t) => {
        const buildable = EXAMPLES.filter((e) => buildState.get(e.dir)?.built);
        const unbuildable = EXAMPLES.filter((e) => !buildState.get(e.dir)?.built);

        if (buildable.length === 0) {
          // No example could be built (e.g. offline environment without the
          // workspace symlinks / plugin build): this is an environment
          // limitation, not a Req 13.2 violation. Skip rather than fail.
          t.skip(
            'no example could be compiled (offline / missing workspace deps); ' +
              'skipping the stays-up window. Missing-env assertions still ran.',
          );
          return;
        }

        const start = Date.now();
        const procs = buildable.map((entry) => spawnExample(entry));
        liveProcs.push(...procs);

        // 1) Every started example must reach its ready signal without exiting.
        const readiness = await Promise.all(
          procs.map((p) => waitUntilReadyOrExit(p, READY_TIMEOUT_MS)),
        );
        procs.forEach((proc, i) => {
          assert.equal(
            readiness[i],
            'ready',
            `${proc.label} should reach its listening signal without exiting ` +
              `(result=${readiness[i]}, exit=${JSON.stringify(proc.exitInfo)}):\n${proc.output}`,
          );
        });

        // 2) Hold the shared window until ≥60s have elapsed since start; the
        //    concurrently-running processes therefore each accumulate ≥60s of
        //    up-time. None of them may exit during this window.
        const remaining = STAY_UP_MS - (Date.now() - start);
        if (remaining > 0) await delay(remaining);

        for (const proc of procs) {
          assert.equal(
            proc.exited,
            false,
            `${proc.label} must remain running for ≥60s without exiting ` +
              `(exit=${JSON.stringify(proc.exitInfo)}):\n${proc.output}`,
          );
        }

        // Document any examples that were skipped because they couldn't build.
        if (unbuildable.length > 0) {
          t.diagnostic(
            `stays-up skipped for unbuildable examples: ${unbuildable.map((e) => e.dir).join(', ')}`,
          );
        }
      },
    );
  });
});
