// scripts/devtools/lib.mjs
//
// Shared helpers for the Interactive Developer Experience (devtools) Layer-B
// verification (Requirement 7.9). These back two scripts:
//
//   • verify.mjs   — the CommandRunner driver. Runs the headless-browser
//     prerequisite probe and executes headless.mjs through the zero-dependency
//     `CommandRunner`, emitting one machine-readable Verification Artifact per
//     tool: devx.playground / devx.route-explorer / devx.dependency-graph.
//
//   • headless.mjs — the real harness. Builds the @streetjs/devtools bundle,
//     runs its node:test suite, then renders the self-contained browser bundle
//     and drives a REAL headless browser over it (Chrome DevTools `--dump-dom`),
//     asserting that the tool's content is produced AFTER the client JS executes.
//
// Honest BLOCKED (Requirement 1.5 / Testing Strategy → Honest BLOCKED): when no
// headless browser is available the driver records an honest BLOCKED with the
// specific missing prerequisite (`headless-browser`) — never a mock, never a
// false VERIFIED. The build + node:test suite (the offline-verifiable evidence)
// still runs so a BLOCKED capability shows concrete executed evidence.
//
// Zero runtime dependencies: only Node core (`node:child_process`, `node:fs`,
// `node:os`, `node:path`, `node:url`).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** The repo root, derived from this file's location (scripts/devtools/ → ../../). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The @streetjs/devtools package directory. */
export const DEVTOOLS_DIR = resolve(REPO_ROOT, 'packages', 'devtools');

/** The built bundle entry the harness imports to render the browser experience. */
export const DEVTOOLS_DIST_ENTRY = resolve(DEVTOOLS_DIR, 'dist', 'index.js');

/** The three browser tools this Layer-B verification covers, with capability ids. */
export const DEVTOOLS_TOOLS = Object.freeze([
  { tool: 'playground', capabilityId: 'devx.playground' },
  { tool: 'route-explorer', capabilityId: 'devx.route-explorer' },
  { tool: 'dependency-graph', capabilityId: 'devx.dependency-graph' },
]);

/** Candidate headless-browser binaries, in declared resolution order. */
const BROWSER_BINARIES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
];

/** True iff the given executable resolves on PATH (`command -v <bin>`). */
export function hasBinary(bin) {
  const r = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' });
  return r.status === 0 && String(r.stdout ?? '').trim() !== '';
}

/**
 * Resolve a usable headless-browser binary, or `null` when none is available.
 * Honors the conventional env overrides first (CHROME_BIN / CHROMIUM_BIN /
 * PUPPETEER_EXECUTABLE_PATH), then probes the common binary names on PATH.
 */
export function resolveBrowserBinary() {
  const fromEnv = [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    process.env.PUPPETEER_EXECUTABLE_PATH,
  ].filter((v) => v && String(v).trim() !== '');
  for (const candidate of fromEnv) {
    if (existsSync(candidate)) return candidate;
  }
  for (const bin of BROWSER_BINARIES) {
    if (hasBinary(bin)) return bin;
  }
  return null;
}

/**
 * Probe the headless-browser prerequisite and return the missing one as a
 * `BlockedReason` (`{ missingPrerequisite, kind }`), or `null` when a browser is
 * available (Requirement 1.5 / 7.9). Used by the CommandRunner driver so an
 * absent browser is recorded as an honest BLOCKED rather than a fake VERIFIED.
 *
 * @returns {{ missingPrerequisite: string, kind: 'runtime' } | null}
 */
export function probeHeadlessBrowser() {
  return resolveBrowserBinary() ? null : { missingPrerequisite: 'headless-browser', kind: 'runtime' };
}

/** Newest mtime (ms) among the source files under `dir` matching `.ts`. */
function newestSourceMtime(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'dist-test') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full));
    } else if (entry.name.endsWith('.ts')) {
      newest = Math.max(newest, statSync(full).mtimeMs);
    }
  }
  return newest;
}

/**
 * Ensure the @streetjs/devtools bundle is built. Builds (tsc via `npm run
 * build`) only when the built entry is missing or stale relative to sources, so
 * repeated per-tool invocations do not rebuild needlessly. Returns
 * `{ built, ok, output }`; `ok === false` signals a build failure.
 */
export function ensureBuilt() {
  const src = resolve(DEVTOOLS_DIR, 'src');
  const upToDate =
    existsSync(DEVTOOLS_DIST_ENTRY) &&
    statSync(DEVTOOLS_DIST_ENTRY).mtimeMs >= newestSourceMtime(src);
  if (upToDate) return { built: false, ok: true, output: 'bundle already up to date' };

  const r = spawnSync('npm', ['run', 'build'], {
    cwd: DEVTOOLS_DIR,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { built: true, ok: r.status === 0 && existsSync(DEVTOOLS_DIST_ENTRY), output };
}

/**
 * Run the @streetjs/devtools node:test suite (`npm run test:run`, which compiles
 * the test sources then runs them with `node --test`). Returns `{ ok, output }`.
 */
export function runDevtoolsTests() {
  const r = spawnSync('npm', ['run', 'test:run'], {
    cwd: DEVTOOLS_DIR,
    encoding: 'utf8',
    timeout: 180_000,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, output };
}

/**
 * Render the demo browser bundle to a fresh temp HTML file and return both the
 * file path and its `file://` URL. The demo dataset is what the published docs
 * site renders, so the headless test exercises the real shipped experience.
 */
export async function renderBundleToTempFile() {
  const mod = await import(pathToFileURL(DEVTOOLS_DIST_ENTRY).href);
  const html = mod.renderDevtoolsBundle(mod.demoDevtoolsData());
  const dir = mkdtempSync(join(tmpdir(), 'street-devtools-'));
  const file = join(dir, 'index.html');
  writeFileSync(file, html, 'utf8');
  return { dir, file, url: pathToFileURL(file).href };
}

/**
 * Drive a real headless browser over `url` and return the post-JS serialized
 * DOM (Chrome DevTools `--dump-dom` runs page scripts before serializing).
 * Returns `{ ok, dom, error }`.
 */
export function dumpDom(browserBin, url, { timeoutMs = 60_000 } = {}) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'street-chrome-'));
  try {
    const r = spawnSync(
      browserBin,
      [
        '--headless=new',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-dev-shm-usage',
        `--user-data-dir=${userDataDir}`,
        '--dump-dom',
        url,
      ],
      { encoding: 'utf8', timeout: timeoutMs },
    );
    if (r.status !== 0 || !r.stdout) {
      return { ok: false, dom: '', error: (r.stderr || `exit ${r.status}`).trim() };
    }
    return { ok: true, dom: r.stdout, error: '' };
  } finally {
    rmSync(userDataDir, { recursive: true, force: true });
  }
}

/**
 * Tool-specific DOM assertions over the post-JS serialized page. Each returns a
 * list of failed-assertion messages (empty ⇒ the tool rendered correctly). A
 * shared sentinel (`#token-status` populated by the init script) proves the
 * client JS actually executed in the browser for every tool.
 */
const JS_EXECUTED = /id="token-status"[^>]*class="warn"[^>]*>No token set/;

export function assertTool(tool, dom) {
  const failures = [];
  if (!JS_EXECUTED.test(dom)) {
    failures.push('client JS did not execute (token gate sentinel not rendered)');
  }
  switch (tool) {
    case 'playground': {
      // Playground operations + the OpenAPI viewer are rendered by the client JS.
      if (!/class="op"/.test(dom)) failures.push('no Playground operations rendered');
      if (!/id="openapi-viewer"[^>]*>\s*\{/.test(dom)) failures.push('OpenAPI viewer not populated');
      break;
    }
    case 'route-explorer': {
      // The route tree shows each route's HTTP method + path (Req 7.2).
      if (!/class="routes"/.test(dom)) failures.push('route tree not rendered');
      if (!/m-GET">GET<\/span><code>\/health\/live<\/code>/.test(dom)) {
        failures.push('route leaf (method + path) not rendered');
      }
      break;
    }
    case 'dependency-graph': {
      // Nodes + edges drawn as an SVG by the client JS (Req 7.3).
      if (!/<circle/.test(dom)) failures.push('dependency graph nodes not drawn');
      if (!/\d+ modules, \d+ edges/.test(dom)) failures.push('dependency graph summary not rendered');
      break;
    }
    default:
      failures.push(`unknown tool: ${tool}`);
  }
  return failures;
}
