// src/tests/backward-compat.test.ts
// Backward-compatibility regression and additive-only pinning (Task 17.1).
//
// This file guards the four "additive-only" hard constraints of the design so
// that any future drift is caught at build time (compile-fail assertions) and
// at test time (runtime shape/import checks):
//
//   - Req 1.4: `@streetjs/queue` preserves the EXACT public signatures of the
//     core `JobQueue`, `CronScheduler`, and `WorkflowEngine`. Pinned two ways:
//       * type-level — `Expect<Equal<...>>` assertions over each public method's
//         `Parameters<>`/`ReturnType<>` fail to compile if a signature drifts;
//       * runtime shape — the classes exist and expose exactly the pinned
//         methods with the pinned arities (`fn.length`).
//     The signatures below were read verbatim from:
//       * packages/core/src/jobs/queue.ts     (JobQueue)
//       * packages/core/src/jobs/scheduler.ts (CronScheduler)
//       * packages/core/src/jobs/workflow.ts  (WorkflowEngine)
//
//   - Req 1.5: the package imports ONLY symbols already exported from the
//     `streetjs` entry point and does NOT modify / deep-import `packages/core`.
//     Enforced by (a) scanning every `src/**/*.ts` import specifier and (b)
//     importing the full core dependency surface from `streetjs` and asserting
//     each symbol is defined (pins the dependency surface).
//
//   - Req 1.3: the `RedisDriver` is reachable ONLY through the
//     `@streetjs/queue/redis` submodule and is NOT re-exported from the default
//     `@streetjs/queue` entry point.
//
//   - Req 1.2: Memory-driver usage introduces NO third-party runtime dependency
//     — the package declares only `streetjs` as a runtime dependency and the
//     MemoryDriver module imports only node builtins + relative modules.
//
// Everything here runs with `node:test` + `node:assert/strict`, requires no
// Redis and no wall-clock timing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, sep, isAbsolute } from 'node:path';

// ── Core classes + types pulled ONLY from the `streetjs` entry point ──────────
// Values (runtime-checkable):
import {
  JobQueue,
  CronScheduler,
  CronParseError,
  WorkflowEngine,
  RedisClient,
  InMemoryRateLimitStore,
  parseWindow,
  systemClock,
  HealthCheckRegistry,
  MetricsRegistry,
  Counter,
  Gauge,
  Histogram,
  PluginModule,
  CliKernel,
  parseArgv,
  Command,
  DistributedLock,
} from 'streetjs';
// Types (compile-checkable — build fails if any is not exported by `streetjs`):
import type {
  JobHandler as CoreJobHandler,
  JobContext as CoreJobContext,
  RetryPolicy as CoreRetryPolicy,
  DlqPruneScheduler as CoreDlqPruneScheduler,
  JobQueueMetrics as CoreJobQueueMetrics,
  WorkflowStep as CoreWorkflowStep,
  RateLimitStore as CoreRateLimitStore,
  Clock as CoreClock,
  SandboxedApp as CoreSandboxedApp,
  RespValue as CoreRespValue,
  RedisLike as CoreRedisLike,
} from 'streetjs';

// ── Type-equality machinery (compile-time drift guards) ───────────────────────

/** Exact type equality: true only when X and Y are mutually assignable. */
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends (<T>() => T extends Y ? 1 : 2) ? true : false;
/** Compiles only when the argument type resolves to `true`. */
type Expect<T extends true> = T;

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.4 — Type-level signature pins for core `JobQueue`
// (packages/core/src/jobs/queue.ts). Any drift fails `tsc`.
// ─────────────────────────────────────────────────────────────────────────────

// enqueue(opts: JobEnqueueOpts): Promise<string>
type _JQ_enqueue_p = Expect<
  Equal<Parameters<JobQueue['enqueue']>, [{ type: string; payload?: unknown; runAt?: Date }]>
>;
type _JQ_enqueue_r = Expect<Equal<ReturnType<JobQueue['enqueue']>, Promise<string>>>;

// register(type: string, handler: JobHandler): void
type _JQ_register_p = Expect<Equal<Parameters<JobQueue['register']>, [string, CoreJobHandler]>>;
type _JQ_register_r = Expect<Equal<ReturnType<JobQueue['register']>, void>>;

// registerClass(ctor: new () => { execute(payload, ctx): Promise<void> }): void
type _JQ_registerClass_p = Expect<
  Equal<
    Parameters<JobQueue['registerClass']>,
    [new () => { execute(payload: unknown, ctx: CoreJobContext): Promise<void> }]
  >
>;
type _JQ_registerClass_r = Expect<Equal<ReturnType<JobQueue['registerClass']>, void>>;

// setRetryPolicy(type: string, policy: RetryPolicy): void
type _JQ_setRetryPolicy_p = Expect<
  Equal<Parameters<JobQueue['setRetryPolicy']>, [string, CoreRetryPolicy]>
>;
type _JQ_setRetryPolicy_r = Expect<Equal<ReturnType<JobQueue['setRetryPolicy']>, void>>;

// pruneDeadLetterQueue(maxEntries: number): Promise<number>
type _JQ_pruneDlq_p = Expect<Equal<Parameters<JobQueue['pruneDeadLetterQueue']>, [number]>>;
type _JQ_pruneDlq_r = Expect<Equal<ReturnType<JobQueue['pruneDeadLetterQueue']>, Promise<number>>>;

// registerDlqPruning(scheduler: DlqPruneScheduler, maxEntries: number, cronExpression?: string): void
type _JQ_regDlqPrune_p = Expect<
  Equal<Parameters<JobQueue['registerDlqPruning']>, [CoreDlqPruneScheduler, number, string?]>
>;
type _JQ_regDlqPrune_r = Expect<Equal<ReturnType<JobQueue['registerDlqPruning']>, void>>;

// pruneJobHistory(maxPerType: number): Promise<number>
type _JQ_pruneHist_p = Expect<Equal<Parameters<JobQueue['pruneJobHistory']>, [number]>>;
type _JQ_pruneHist_r = Expect<Equal<ReturnType<JobQueue['pruneJobHistory']>, Promise<number>>>;

// registerJobHistoryPruning(scheduler: DlqPruneScheduler, maxPerType?: number, cronExpression?: string): void
type _JQ_regHistPrune_p = Expect<
  Equal<Parameters<JobQueue['registerJobHistoryPruning']>, [CoreDlqPruneScheduler, number?, string?]>
>;
type _JQ_regHistPrune_r = Expect<Equal<ReturnType<JobQueue['registerJobHistoryPruning']>, void>>;

// metrics(): Promise<JobQueueMetrics>
type _JQ_metrics_p = Expect<Equal<Parameters<JobQueue['metrics']>, []>>;
type _JQ_metrics_r = Expect<Equal<ReturnType<JobQueue['metrics']>, Promise<CoreJobQueueMetrics>>>;

// start(): void  /  stop(): void
type _JQ_start = Expect<Equal<() => ReturnType<JobQueue['start']>, () => void>>;
type _JQ_stop = Expect<Equal<() => ReturnType<JobQueue['stop']>, () => void>>;

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.4 — Type-level signature pins for core `CronScheduler`
// (packages/core/src/jobs/scheduler.ts).
// ─────────────────────────────────────────────────────────────────────────────

// register(expression: string, name: string, fn: () => Promise<void>): void
type _CS_register_p = Expect<
  Equal<Parameters<CronScheduler['register']>, [string, string, () => Promise<void>]>
>;
type _CS_register_r = Expect<Equal<ReturnType<CronScheduler['register']>, void>>;
type _CS_start = Expect<Equal<Parameters<CronScheduler['start']>, []>> &
  Expect<Equal<ReturnType<CronScheduler['start']>, void>>;
type _CS_stop = Expect<Equal<Parameters<CronScheduler['stop']>, []>> &
  Expect<Equal<ReturnType<CronScheduler['stop']>, void>>;

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.4 — Type-level signature pins for core `WorkflowEngine`
// (packages/core/src/jobs/workflow.ts).
// ─────────────────────────────────────────────────────────────────────────────

// define(name: string, steps: WorkflowStep[]): void
type _WE_define_p = Expect<Equal<Parameters<WorkflowEngine['define']>, [string, CoreWorkflowStep[]]>>;
type _WE_define_r = Expect<Equal<ReturnType<WorkflowEngine['define']>, void>>;

// start(name: string, input: unknown): Promise<string>
type _WE_start_p = Expect<Equal<Parameters<WorkflowEngine['start']>, [string, unknown]>>;
type _WE_start_r = Expect<Equal<ReturnType<WorkflowEngine['start']>, Promise<string>>>;

// resume(workflowId: string): Promise<void>
type _WE_resume_p = Expect<Equal<Parameters<WorkflowEngine['resume']>, [string]>>;
type _WE_resume_r = Expect<Equal<ReturnType<WorkflowEngine['resume']>, Promise<void>>>;

// Reference the type aliases so tooling treats them as consumed. `satisfies`
// keeps this purely at the type layer (no runtime footprint beyond `true`).
const _typeLevelPinsHold = true satisfies (
  _JQ_enqueue_p & _JQ_enqueue_r & _JQ_register_p & _JQ_register_r &
  _JQ_registerClass_p & _JQ_registerClass_r & _JQ_setRetryPolicy_p & _JQ_setRetryPolicy_r &
  _JQ_pruneDlq_p & _JQ_pruneDlq_r & _JQ_regDlqPrune_p & _JQ_regDlqPrune_r &
  _JQ_pruneHist_p & _JQ_pruneHist_r & _JQ_regHistPrune_p & _JQ_regHistPrune_r &
  _JQ_metrics_p & _JQ_metrics_r & _JQ_start & _JQ_stop &
  _CS_register_p & _CS_register_r & _CS_start & _CS_stop &
  _WE_define_p & _WE_define_r & _WE_start_p & _WE_start_r & _WE_resume_p & _WE_resume_r
);

// ── Path helpers (resolve package layout from the compiled test location) ─────
// At runtime this file lives at `<pkg>/dist/tests/backward-compat.test.js`.
const HERE = dirname(fileURLToPath(import.meta.url)); // <pkg>/dist/tests
const DIST_ROOT = resolve(HERE, '..'); // <pkg>/dist
const PKG_ROOT = resolve(DIST_ROOT, '..'); // <pkg>
const SRC_ROOT = resolve(PKG_ROOT, 'src'); // <pkg>/src

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.4 — Runtime shape pins: classes exist with the expected methods/arity.
// ─────────────────────────────────────────────────────────────────────────────

/** Assert a prototype method exists and pins its declared arity (`fn.length`). */
function assertMethod(
  ctor: abstract new (...args: never[]) => unknown,
  name: string,
  arity: number,
): void {
  const fn = (ctor.prototype as Record<string, unknown>)[name];
  assert.equal(typeof fn, 'function', `expected method ${name} to be a function`);
  assert.equal(
    (fn as (...a: unknown[]) => unknown).length,
    arity,
    `expected method ${name} to have arity ${arity}`,
  );
}

test('Req 1.4: core JobQueue class exposes its exact public method surface', () => {
  assert.equal(typeof JobQueue, 'function');
  // Arities read verbatim from packages/core/src/jobs/queue.ts.
  assertMethod(JobQueue, 'enqueue', 1);
  assertMethod(JobQueue, 'register', 2);
  assertMethod(JobQueue, 'registerClass', 1);
  assertMethod(JobQueue, 'setRetryPolicy', 2);
  assertMethod(JobQueue, 'pruneDeadLetterQueue', 1);
  // registerDlqPruning(scheduler, maxEntries, cronExpression = '0 0 * * *') → arity 2.
  assertMethod(JobQueue, 'registerDlqPruning', 2);
  assertMethod(JobQueue, 'pruneJobHistory', 1);
  // registerJobHistoryPruning(scheduler, maxPerType = 1000, cronExpression = '0 0 * * *') → arity 1.
  assertMethod(JobQueue, 'registerJobHistoryPruning', 1);
  assertMethod(JobQueue, 'metrics', 0);
  assertMethod(JobQueue, 'start', 0);
  assertMethod(JobQueue, 'stop', 0);
});

test('Req 1.4: core CronScheduler class exposes its exact public method surface', () => {
  assert.equal(typeof CronScheduler, 'function');
  assertMethod(CronScheduler, 'register', 3);
  assertMethod(CronScheduler, 'start', 0);
  assertMethod(CronScheduler, 'stop', 0);
  // The re-exported CronParseError is the same error type the queue relies on.
  assert.equal(typeof CronParseError, 'function');
  const err = new CronParseError('bad', 'reason');
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'CronParseError');
});

test('Req 1.4: core WorkflowEngine class exposes its exact public method surface', () => {
  assert.equal(typeof WorkflowEngine, 'function');
  assertMethod(WorkflowEngine, 'define', 2);
  assertMethod(WorkflowEngine, 'start', 2);
  assertMethod(WorkflowEngine, 'resume', 1);
});

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.5 — Dependency surface: every core symbol the queue relies on is
// actually exported from the `streetjs` entry point. Importing them above pins
// the surface at compile time; asserting they are defined pins it at runtime.
// ─────────────────────────────────────────────────────────────────────────────

test('Req 1.5: the full core dependency surface is importable from "streetjs"', () => {
  const runtimeSymbols: Record<string, unknown> = {
    JobQueue,
    CronScheduler,
    CronParseError,
    WorkflowEngine,
    RedisClient,
    InMemoryRateLimitStore,
    parseWindow,
    systemClock,
    HealthCheckRegistry,
    MetricsRegistry,
    Counter,
    Gauge,
    Histogram,
    PluginModule,
    CliKernel,
    parseArgv,
    Command,
    DistributedLock,
  };
  for (const [name, value] of Object.entries(runtimeSymbols)) {
    assert.notEqual(value, undefined, `expected "${name}" to be exported from streetjs`);
  }
  // Callable/instantiable spot-checks confirming these are the real primitives,
  // not accidental undefineds smuggled through re-exports.
  assert.equal(typeof parseWindow, 'function');
  assert.equal(parseWindow('5m'), 300000);
  assert.equal(typeof systemClock, 'function');
  assert.equal(typeof systemClock(), 'number');

  // Type-only symbols: referenced here so the import above cannot be treated as
  // dead. If any stops being exported from `streetjs`, the file fails to build.
  const _typeSurface: Array<
    | CoreRateLimitStore
    | CoreClock
    | CoreSandboxedApp
    | CoreRespValue
    | CoreRedisLike
    | undefined
  > = [];
  assert.ok(Array.isArray(_typeSurface));
});

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.5 — No deep imports into packages/core; imports resolve only to
// relative paths, node builtins, `streetjs`(/…), or the dev-only `fast-check`.
// ─────────────────────────────────────────────────────────────────────────────

/** Recursively collect every `.ts` file under `dir`. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** Strip block and line comments so import scanning never matches doc-comment
 *  prose. Line comments are only stripped when `//` is not part of `://` (so
 *  URLs inside real code are preserved and cannot mask a following import). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // line comments (keeps `://`)
}

/** Extract module specifiers from real `import`/`export ... from`/side-effect
 *  import statements (anchored to a line start so template-literal scaffold code
 *  and comment prose do not produce false positives) plus dynamic `import(…)`. */
function extractImportSpecifiers(source: string): string[] {
  const clean = stripComments(source);
  const specs: string[] = [];
  const patterns = [
    // `import ... from '…'` and `export ... from '…'` (anchored to line start)
    /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm,
    // bare side-effect import: `import '…'`
    /^\s*import\s+['"]([^'"]+)['"]/gm,
    // dynamic import: `import('…')`
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) specs.push(m[1]);
  }
  return specs;
}

/** Classification of an allowed specifier. */
function isNodeBuiltin(spec: string): boolean {
  return spec.startsWith('node:');
}
function isRelative(spec: string): boolean {
  return spec.startsWith('./') || spec.startsWith('../');
}
function isStreetjs(spec: string): boolean {
  return spec === 'streetjs' || spec.startsWith('streetjs/');
}
/** The package's own public specifier (used in generated scaffold templates and
 *  cross-test imports). This is the public `@streetjs/queue` entry — not a core
 *  deep-import — so it is allowed. */
function isSelfPackage(spec: string): boolean {
  return spec === '@streetjs/queue' || spec.startsWith('@streetjs/queue/');
}
/** Dev-only test dependency permitted in `*.test.ts` / helper test modules. */
function isAllowedDevDep(spec: string): boolean {
  return spec === 'fast-check';
}

test('Req 1.5: every queue src import is relative, a node builtin, "streetjs", or a dev-only test dep', () => {
  const files = collectTsFiles(SRC_ROOT);
  assert.ok(files.length > 0, 'expected to find source files under src/');

  const violations: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const spec of extractImportSpecifiers(source)) {
      // Deep-import guard: nothing may reach into packages/core (or any path
      // that names it), which would bypass the public `streetjs` entry point.
      if (spec.includes('packages/core') || spec.includes('packages\\core')) {
        violations.push(`${relative(PKG_ROOT, file)} deep-imports core via "${spec}"`);
        continue;
      }
      if (
        isRelative(spec) ||
        isNodeBuiltin(spec) ||
        isStreetjs(spec) ||
        isSelfPackage(spec) ||
        isAllowedDevDep(spec)
      ) {
        continue;
      }
      violations.push(`${relative(PKG_ROOT, file)} imports disallowed specifier "${spec}"`);
    }
  }
  assert.deepEqual(violations, [], `disallowed imports found:\n${violations.join('\n')}`);
});

test('Req 1.5: no relative import escapes the queue package root', () => {
  const files = collectTsFiles(SRC_ROOT);
  const escapes: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const spec of extractImportSpecifiers(source)) {
      if (!isRelative(spec)) continue;
      const resolved = resolve(dirname(file), spec);
      const rel = relative(PKG_ROOT, resolved);
      // A relative import that resolves outside the package root produces a
      // path starting with '..' (or an absolute path on a different root).
      if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
        escapes.push(`${relative(PKG_ROOT, file)} escapes package via "${spec}"`);
      }
    }
  }
  assert.deepEqual(escapes, [], `relative imports escaping the package:\n${escapes.join('\n')}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.3 — RedisDriver reachable ONLY via the `@streetjs/queue/redis` submodule
// and NOT re-exported from the default `@streetjs/queue` entry point.
// ─────────────────────────────────────────────────────────────────────────────

test('Req 1.3: the default entry point does NOT export RedisDriver/RedisDriverOptions', async () => {
  const indexModule = (await import('../index.js')) as Record<string, unknown>;
  assert.equal(
    indexModule['RedisDriver'],
    undefined,
    'RedisDriver must not be re-exported from the default @streetjs/queue entry point',
  );
  assert.equal(
    indexModule['RedisDriverOptions'],
    undefined,
    'RedisDriverOptions must not be re-exported from the default entry point',
  );
  // Sanity: the default entry DOES expose the zero-dep MemoryDriver.
  assert.equal(typeof indexModule['MemoryDriver'], 'function');
});

test('Req 1.3: RedisDriver IS reachable through the /redis submodule', async () => {
  // `../drivers/redis.js` is exactly what the "./redis" package export maps to
  // ("./dist/drivers/redis.js"), so this mirrors `import ... from "@streetjs/queue/redis"`.
  const redisModule = (await import('../drivers/redis.js')) as Record<string, unknown>;
  assert.equal(typeof redisModule['RedisDriver'], 'function', 'RedisDriver must be exported from the /redis submodule');
});

test('Req 1.3: package.json maps "./redis" to the redis driver and "." to the index', () => {
  const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8')) as {
    exports?: Record<string, { import?: string; types?: string }>;
  };
  const exportsMap = pkg.exports ?? {};
  assert.ok(exportsMap['.'], 'package must declare a "." export');
  assert.equal(exportsMap['.'].import, './dist/index.js');
  assert.ok(exportsMap['./redis'], 'package must declare a "./redis" submodule export');
  assert.equal(exportsMap['./redis'].import, './dist/drivers/redis.js');
});

// ─────────────────────────────────────────────────────────────────────────────
// Req 1.2 — Memory-driver usage introduces zero third-party runtime deps.
// ─────────────────────────────────────────────────────────────────────────────

test('Req 1.2: the package declares ONLY "streetjs" as a runtime dependency', () => {
  const pkg = JSON.parse(readFileSync(resolve(PKG_ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = pkg.dependencies ?? {};
  assert.deepEqual(
    Object.keys(deps).sort(),
    ['streetjs'],
    'the only runtime dependency must be "streetjs" so Memory users pull in no third-party runtime deps',
  );

  // The tooling the tests rely on lives strictly in devDependencies.
  const devDeps = pkg.devDependencies ?? {};
  for (const tool of ['fast-check', '@types/node', 'typescript']) {
    assert.ok(tool in devDeps, `expected "${tool}" to be a devDependency, not a runtime dependency`);
    assert.ok(!(tool in deps), `"${tool}" must not be a runtime dependency`);
  }
});

test('Req 1.2: the MemoryDriver module imports only node builtins + relative modules', () => {
  const memorySrc = readFileSync(resolve(SRC_ROOT, 'drivers', 'memory.ts'), 'utf8');
  const specs = extractImportSpecifiers(memorySrc);
  assert.ok(specs.length > 0, 'expected MemoryDriver to have imports');
  const disallowed = specs.filter((s) => !(isNodeBuiltin(s) || isRelative(s)));
  assert.deepEqual(
    disallowed,
    [],
    `MemoryDriver must import only node builtins + relative modules; found: ${disallowed.join(', ')}`,
  );
});

// Keep the compile-time pin marker observable at runtime without side effects.
test('Req 1.4: type-level signature pins compiled successfully', () => {
  assert.equal(_typeLevelPinsHold, true);
});
