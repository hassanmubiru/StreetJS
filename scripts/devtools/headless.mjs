#!/usr/bin/env node
// scripts/devtools/headless.mjs
//
// The Interactive Developer Experience (devtools) Layer-B harness for a single
// tool (Requirement 7.9). This is the real command executed (through
// `CommandRunner`) by verify.mjs, and is also runnable standalone for debugging.
//
// For the requested `--tool` it:
//   1. BUILDS the @streetjs/devtools bundle (tsc) — idempotent.
//   2. RUNS the bundle's node:test suite (build succeeds + tests pass).
//   3. Renders the self-contained browser bundle and drives a REAL headless
//      browser over it (Chrome DevTools `--dump-dom`), asserting the tool's
//      content is produced AFTER the client JS executes:
//        • playground        → operations list + populated OpenAPI viewer
//        • route-explorer     → route tree with method + path per route (Req 7.2)
//        • dependency-graph   → SVG nodes/edges + summary (Req 7.3)
//
// Honest BLOCKED: the build + node:test suite (offline-verifiable evidence)
// ALWAYS runs. When NO headless browser is available the harness prints a SKIP
// line for the browser stage and exits 0 — the driver's prerequisite probe is
// what records the honest BLOCKED status, so the offline suite stays green
// (Testing Strategy → Honest BLOCKED). A build/test failure, or a real headless
// assertion failure, exits non-zero so it fails CI.
//
// Usage:
//   node scripts/devtools/headless.mjs --tool playground|route-explorer|dependency-graph
//
// _Design: Components → Interactive Developer Experience; Testing Strategy →
//  Layer B + Honest BLOCKED. Requirements: 7.9_

import { rmSync } from 'node:fs';
import {
  DEVTOOLS_TOOLS,
  ensureBuilt,
  runDevtoolsTests,
  resolveBrowserBinary,
  renderBundleToTempFile,
  dumpDom,
  assertTool,
} from './lib.mjs';

function parseArgs(argv) {
  let tool;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tool') tool = argv[++i];
  }
  return { tool };
}

const VALID_TOOLS = DEVTOOLS_TOOLS.map((t) => t.tool);

export async function runHeadless(tool) {
  if (!VALID_TOOLS.includes(tool)) {
    throw new Error(`--tool must be one of: ${VALID_TOOLS.join(', ')} (got ${tool ?? '<none>'})`);
  }

  // Step 1 — build the bundle (offline-verifiable evidence; always runs).
  const build = ensureBuilt();
  if (!build.ok) {
    console.error(`[devtools:${tool}] BUILD FAILED\n${build.output}`);
    return 1;
  }
  console.log(`[devtools:${tool}] build ok (${build.built ? 'compiled' : 'cached'})`);

  // Step 2 — run the bundle's node:test suite (offline-verifiable evidence).
  const tests = runDevtoolsTests();
  if (!tests.ok) {
    console.error(`[devtools:${tool}] TESTS FAILED\n${tests.output}`);
    return 1;
  }
  console.log(`[devtools:${tool}] node:test suite passed`);

  // Step 3 — real headless-browser assertion. When no browser is available,
  // SKIP cleanly (exit 0); the driver's prerequisite probe records BLOCKED.
  const browser = resolveBrowserBinary();
  if (!browser) {
    console.log(`[devtools:${tool}] SKIP — headless browser unavailable (offline evidence recorded)`);
    return 0;
  }

  const { dir, url } = await renderBundleToTempFile();
  try {
    const { ok, dom, error } = dumpDom(browser, url);
    if (!ok) {
      console.error(`[devtools:${tool}] headless render failed: ${error}`);
      return 1;
    }
    const failures = assertTool(tool, dom);
    if (failures.length > 0) {
      console.error(`[devtools:${tool}] HEADLESS ASSERTIONS FAILED:\n - ${failures.join('\n - ')}`);
      return 1;
    }
    console.log(`[devtools:${tool}] headless browser verified (${browser})`);
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const { tool } = parseArgs(process.argv.slice(2));
  try {
    process.exitCode = await runHeadless(tool);
  } catch (err) {
    console.error(`[devtools] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
