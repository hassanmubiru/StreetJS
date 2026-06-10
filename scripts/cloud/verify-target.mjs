#!/usr/bin/env node
// scripts/cloud/verify-target.mjs
//
// Deploy → verify one Deployment Target, then write its per-target
// `TargetVerification` result for the cross-target roll-up. This mirrors the
// design's "deploy → verify" sequence:
//
//   1. (optional) run the provider deploy command (DEPLOY_CMD / --deploy-cmd)
//   2. probe `/health/live` + `/health/ready` (≤ 5s each, Req 2.9)
//   3. run the smoke checks (≤ 300s, 0 failed / 0 errored, Req 2.10)
//   4. classify the target against the bounds via @streetjs/core
//      (`classifyTargetVerification`): PARTIAL with retained failing output when
//      a bound is exceeded (Req 2.13); BLOCKED with the missing dependency when
//      the instance is unreachable (Req 2.14)
//
// The result is written to:
//   verification-artifacts/cloud/targets/<target>.json
//
// Usage:
//   node scripts/cloud/verify-target.mjs --target kubernetes --base-url https://<url>
//   DEPLOY_CMD="kubectl apply -k deploy/k8s" node scripts/cloud/verify-target.mjs \
//     --target kubernetes --base-url https://<url> --checks scripts/cloud/checks.json
//
// Exit code mirrors the target status: 0 for VERIFIED, 1 otherwise (so CI fails
// on PARTIAL/BLOCKED) — the artifact is always written.

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { classifyTargetVerification } from 'streetjs';
import { probeHealth, runSmoke, loadSmokeChecks, parseFlags } from './lib.mjs';

const SUPPORTED_TARGETS = [
  'kubernetes',
  'cloudrun',
  'ecs',
  'lambda',
  'azure-functions',
  'gcf',
  'cloudflare-workers',
];

/** Run the optional deploy command; returns { ok, output }. */
function runDeploy(deployCmd) {
  if (!deployCmd) return { ok: true, output: '(no deploy command; verifying an existing instance)' };
  const r = spawnSync(deployCmd, { shell: true, encoding: 'utf8' });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, output };
}

export async function verifyTarget(opts) {
  const { target, baseUrl, deployCmd, checksPath } = opts;

  // No reachable instance ⇒ BLOCKED with the specific missing dependency (Req 2.14).
  if (!baseUrl) {
    return classifyTargetVerification({
      target,
      status: 'BLOCKED',
      health: { live: false, ready: false, maxLatencyMs: 0 },
      blockedReason: { missingPrerequisite: 'BASE_URL', kind: 'service' },
    });
  }

  // Step 1 — deploy (optional). A failed deploy ⇒ BLOCKED on the deploy command.
  const deploy = runDeploy(deployCmd);
  if (!deploy.ok) {
    return classifyTargetVerification({
      target,
      status: 'BLOCKED',
      health: { live: false, ready: false, maxLatencyMs: 0 },
      blockedReason: { missingPrerequisite: deployCmd, kind: 'runtime' },
      smoke: { passed: 0, failed: 0, errored: 1, durationMs: 0, output: deploy.output },
    });
  }

  // Step 2 — health probes (≤ 5s each, Req 2.9).
  const { health, log: healthLog } = await probeHealth(baseUrl);

  // Step 3 — smoke checks (≤ 300s, 0 failed/0 errored, Req 2.10).
  const checks = loadSmokeChecks(checksPath);
  const smoke = await runSmoke(baseUrl, checks);
  smoke.output = `${healthLog}\n${smoke.output}`.trim();

  // Step 4 — classify against the bounds (PARTIAL retains failing output, Req 2.13).
  return classifyTargetVerification({ target, status: 'PARTIAL', health, smoke });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const target = flags.target;
  const baseUrl = flags['base-url'] ?? process.env.BASE_URL;
  const deployCmd = flags['deploy-cmd'] ?? process.env.DEPLOY_CMD;
  const checksPath = flags.checks;
  const outRoot = flags.out ?? 'verification-artifacts';

  if (!target || !SUPPORTED_TARGETS.includes(target)) {
    console.error(`[cloud-verify] --target must be one of: ${SUPPORTED_TARGETS.join(', ')}`);
    process.exitCode = 2;
    return;
  }

  const result = await verifyTarget({ target, baseUrl, deployCmd, checksPath });

  const outPath = resolve(outRoot, 'cloud', 'targets', `${target}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`[cloud-verify] ${target}: ${result.status}`);
  if (result.blockedReason) {
    console.log(`[cloud-verify]   blocked: ${result.blockedReason.kind}/${result.blockedReason.missingPrerequisite}`);
  }
  for (const v of result.boundViolations ?? []) console.log(`[cloud-verify]   bound exceeded: ${v}`);
  console.log(`[cloud-verify]   result: ${outPath}`);

  process.exitCode = result.status === 'VERIFIED' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[cloud-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
