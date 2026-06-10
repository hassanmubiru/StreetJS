#!/usr/bin/env node
// scripts/enterprise/verify.mjs
//
// Enterprise Console APIs Layer B verification driver (Requirement 6.10).
//
// Drives the zero-dependency `CommandRunner` from @streetjs/core to execute the
// enterprise console END-TO-END suite (e2e.mjs) against a running app + a real
// PostgreSQL container, and emit exactly one machine-readable Verification
// Artifact:
//
//     verification-artifacts/enterprise/enterprise.api.artifact.json
//
// The artifact records the executed command, the command exit code, and the
// passed/failed test counts (Req 6.10). The CommandRunner produces the command,
// exit code, status, and atomic-write machinery; this driver then folds the
// suite's pass/fail counts (written by e2e.mjs to enterprise.api.summary.json)
// into the artifact's `details` and re-writes it atomically.
//
// The driver passes a CONTAINER-RUNTIME prerequisite probe to the runner: when
// no container runtime is available the runner classifies the run as an honest
// BLOCKED with the specific missing prerequisite (docker / docker-daemon /
// docker-image:postgres:16-alpine) — never a mock, never a false VERIFIED
// (Req 1.5). When a container IS available, e2e.mjs starts PostgreSQL and the
// running app and drives the full console surface; its exit code drives the
// VERIFIED (all evidence present + exit 0) vs PARTIAL classification.
//
// Evidence hints: the capability ships source (the console handlers + harness)
// AND published documentation (the OpenAPI spec + enterprise console docs from
// task 10.4), so `documentation` is marked present.
//
// Exit code: mirrors the artifact's command exit code, so a genuine suite
// failure fails the CI step while an honest BLOCKED (skipped suite, exit 0)
// does not.
//
// _Design: Components → Enterprise Console APIs; Testing Strategy → Layer B +
//  Honest BLOCKED. Requirements: 6.10, 1.5_

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { CommandRunner } from 'streetjs';

import { REPO_ROOT, probeContainerPrerequisites } from './lib.mjs';
import { SUMMARY_PATH } from './e2e.mjs';

const CAPABILITY_ID = 'enterprise.api';

const HERE = dirname(fileURLToPath(import.meta.url));
const E2E_SCRIPT = resolve(HERE, 'e2e.mjs');

/** Read the suite summary (pass/fail counts) e2e.mjs wrote, if present. */
function readSummary() {
  if (!existsSync(SUMMARY_PATH)) return null;
  try {
    return JSON.parse(readFileSync(SUMMARY_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export async function verifyEnterpriseApi({ outRoot = 'verification-artifacts' } = {}) {
  const outDir = resolve(outRoot, 'enterprise');
  const runner = new CommandRunner();

  const { artifact, path } = await runner.run({
    capabilityId: CAPABILITY_ID,
    command: `node ${JSON.stringify(E2E_SCRIPT)}`,
    cwd: REPO_ROOT,
    // The single prerequisite: a usable container runtime for PostgreSQL. A
    // missing runtime short-circuits the classification to BLOCKED with its id.
    prerequisites: [async () => probeContainerPrerequisites()],
    // The OpenAPI spec + enterprise console docs are published docs (task 10.4).
    evidenceHints: { documentation: true },
    outDir,
  });

  // Fold the suite's passed/failed counts into the artifact (Req 6.10): the
  // artifact must include the executed command, exit code, AND the passed/failed
  // test counts. We re-write atomically through the same path so the artifact
  // stays the single machine-readable record.
  const summary = readSummary();
  if (summary) {
    artifact.details = {
      ...(artifact.details ?? {}),
      suite: 'enterprise-console-e2e',
      passed: summary.passed ?? 0,
      failed: summary.failed ?? 0,
      total: summary.total ?? 0,
      ...(summary.status ? { suiteStatus: summary.status } : {}),
      ...(summary.skipped ? { skipped: summary.skipped } : {}),
    };
    await CommandRunner.writeArtifactAtomic(path, artifact);
  }

  return { artifact, path };
}

async function main() {
  const { artifact, path } = await verifyEnterpriseApi();

  const d = artifact.details ?? {};
  console.log(`[enterprise-verify] ${artifact.capabilityId}: ${artifact.status} (exit ${artifact.exitCode})`);
  if (artifact.blockedReason) {
    console.log(`[enterprise-verify]   blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite}`);
  }
  if (d.total !== undefined) {
    console.log(`[enterprise-verify]   tests: ${d.passed}/${d.total} passed, ${d.failed} failed`);
  }
  console.log(`[enterprise-verify]   artifact: ${path}`);

  // Mirror the executed command's exit code: an honest BLOCKED skip is exit 0
  // (does not fail CI), a genuine suite failure is non-zero (fails CI).
  process.exitCode = artifact.exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[enterprise-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
