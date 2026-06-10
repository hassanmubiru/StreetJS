#!/usr/bin/env node
// scripts/devtools/verify.mjs
//
// Interactive Developer Experience (devtools) Layer-B verification driver
// (Requirement 7.9).
//
// Drives the zero-dependency `CommandRunner` from @streetjs/core to execute the
// per-tool headless harness (headless.mjs) and emit one machine-readable
// Verification Artifact per tool:
//
//     verification-artifacts/devx/devx.playground.artifact.json
//     verification-artifacts/devx/devx.route-explorer.artifact.json
//     verification-artifacts/devx/devx.dependency-graph.artifact.json
//
// The driver passes a HEADLESS-BROWSER prerequisite probe to the runner: when no
// headless browser is available the runner classifies the run as an honest
// BLOCKED with the specific missing prerequisite (`headless-browser`) — never a
// mock, never a false VERIFIED (Req 1.5). When a browser IS available, the
// harness builds the bundle, runs its node:test suite, and drives a real
// headless browser over the rendered bundle; its exit code drives the VERIFIED
// (all evidence present + exit 0) vs PARTIAL classification.
//
// Evidence hints: the capability ships source (the bundle + harness) AND
// published documentation (the devtools README + the bundle embedded into the
// GitHub Pages docs site), so `documentation` is marked present; the runner
// derives the remaining components from the executed command.
//
// Exit code: the maximum artifact exit code across the three tools, so a genuine
// failure fails the CI step while an honest BLOCKED (skipped browser, exit 0)
// does not.
//
// _Design: Components → Interactive Developer Experience; Testing Strategy →
//  Layer B + Honest BLOCKED. Requirements: 7.9, 1.5_

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { CommandRunner } from 'streetjs';
import { REPO_ROOT, DEVTOOLS_TOOLS, probeHeadlessBrowser } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const HEADLESS_SCRIPT = resolve(HERE, 'headless.mjs');

export async function verifyDevtools({ outRoot = 'verification-artifacts' } = {}) {
  const outDir = resolve(outRoot, 'devx');
  const runner = new CommandRunner();
  const results = [];

  for (const { tool, capabilityId } of DEVTOOLS_TOOLS) {
    const { artifact, path } = await runner.run({
      capabilityId,
      command: `node ${JSON.stringify(HEADLESS_SCRIPT)} --tool ${tool}`,
      cwd: REPO_ROOT,
      // The single prerequisite: a usable headless browser. A missing browser
      // short-circuits the classification to BLOCKED with its specific id.
      prerequisites: [async () => probeHeadlessBrowser()],
      // The devtools README + the bundle embedded into the docs site are the
      // published docs for this capability.
      evidenceHints: { documentation: true },
      outDir,
    });
    results.push({ artifact, path });
  }

  return results;
}

async function main() {
  const results = await verifyDevtools();

  let worstExit = 0;
  for (const { artifact, path } of results) {
    console.log(`[devtools-verify] ${artifact.capabilityId}: ${artifact.status} (exit ${artifact.exitCode})`);
    if (artifact.blockedReason) {
      console.log(`[devtools-verify]   blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`);
    }
    console.log(`[devtools-verify]   artifact: ${path}`);
    worstExit = Math.max(worstExit, artifact.exitCode);
  }

  // Mirror the worst executed command exit code: an honest BLOCKED skip is exit
  // 0 (does not fail CI), a genuine failure is non-zero (fails CI).
  process.exitCode = worstExit;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[devtools-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
