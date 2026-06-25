#!/usr/bin/env node
// scripts/cloud/kind-verify.mjs
//
// Layer-B kind-cluster integration verification for the Kubernetes Deployment
// Target (Requirements 2.9, 2.10). This is the only path that can raise
// `cloud.deploy.kubernetes` to VERIFIED: it deploys the generated manifests +
// the Helm chart to a *real* local kind cluster, then asserts the live bounds:
//
//   • the application pod reaches `1/1 Running`
//   • `/health/live` and `/health/ready` each return HTTP 200 within 5s (Req 2.9)
//   • the smoke checks complete within 300s with 0 failed / 0 errored (Req 2.10)
//
// Honest BLOCKED (zero-trust evidence standard): a kind cluster needs the
// `docker`, `kind`, `kubectl`, and `helm` binaries. When any is unreachable the
// verifier does NOT fail and does NOT mock — it records the target BLOCKED with
// the SPECIFIC missing prerequisite id, while STILL running and attaching the
// credential-free offline-verifiable artifacts (manifest validation, Helm chart
// structure, and — when the tool is present — `helm lint`/`helm template`) so
// progress stays provable. This mirrors the repo's integration-test convention
// of skipping, not failing, when infrastructure is absent.
//
// The result is written, in the same `TargetVerification` shape the cross-target
// roll-up (`build-report.mjs`) consumes, to:
//   verification-artifacts/cloud/targets/kubernetes.json
//
// Usage:
//   node scripts/cloud/kind-verify.mjs
//   node scripts/cloud/kind-verify.mjs --cluster street-verify --image street-app:verify \
//     --checks scripts/cloud/checks.json --keep-cluster
//
// Exit code: 0 when the target is VERIFIED, 1 otherwise (PARTIAL/BLOCKED) so a
// CI step fails on a degraded deployment — the artifact is ALWAYS written.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import {
  runOfflineArtifacts,
  blockedTargetWithOfflineEvidence,
  classifyTargetVerification,
} from 'streetjs';
import { probeHealth, runSmoke, loadSmokeChecks, parseFlags } from './lib.mjs';
import { hasBinary, runBinaryOfflineArtifacts } from './prereqs.mjs';

/**
 * The deploy-time prerequisites a kind-cluster verification needs, in probe
 * order. Each is an executable on PATH (`kind`) or the container engine kind
 * runs on (`docker`). The FIRST missing one is recorded as the BLOCKED
 * prerequisite id (Req 2.14 / 1.5).
 *
 * @type {Array<{ id: string, kind: 'runtime', description: string }>}
 */
export const KIND_PREREQUISITES = [
  { id: 'docker', kind: 'runtime', description: 'Container engine that backs the kind cluster nodes' },
  { id: 'kind', kind: 'runtime', description: 'Kubernetes-in-Docker CLI used to create the local cluster' },
  { id: 'kubectl', kind: 'runtime', description: 'Kubernetes CLI used to wait for the pod and port-forward' },
  { id: 'helm', kind: 'runtime', description: 'Helm CLI used to install the chart' },
];

/**
 * Probe the kind-cluster prerequisites in order and return the FIRST missing one
 * as a `DependencyDescriptor`, or `null` when every prerequisite is present.
 *
 * @returns {{ id: string, kind: 'runtime', description: string } | null}
 */
export function probeKindPrerequisites() {
  for (const dep of KIND_PREREQUISITES) {
    if (!hasBinary(dep.id)) return dep;
  }
  return null;
}

/** Run a command synchronously, returning `{ ok, output }`. */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', ...opts });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return { ok: r.status === 0, output, status: r.status };
}

/**
 * Wait until the application pod reports `1/1 Running` (one ready container of
 * one) within the deadline, polling `kubectl get pods`. Returns `{ ok, output }`.
 */
function waitForPodRunning(selector, namespace, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  let last = '';
  do {
    const r = run('kubectl', [
      'get', 'pods', '-l', selector, '-n', namespace,
      '-o', 'jsonpath={range .items[*]}{.status.phase} {.status.containerStatuses[*].ready}{"\\n"}{end}',
    ]);
    last = r.output;
    // Each line is e.g. "Running true" — require Running with every container ready.
    const lines = last.split('\n').map((l) => l.trim()).filter(Boolean);
    const allRunningReady =
      lines.length > 0 &&
      lines.every((l) => l.startsWith('Running') && !l.includes('false'));
    if (allRunningReady) return { ok: true, output: `pod 1/1 Running: ${last}` };
    if (Date.now() >= deadline) break;
    spawnSync('sleep', ['2']);
  } while (Date.now() < deadline);
  return { ok: false, output: `pod did not reach 1/1 Running within deadline (last: ${last || 'no pods'})` };
}

/**
 * Deploy the Helm chart to a real kind cluster and verify the live bounds.
 * Runs only when every prerequisite is present (the caller guarantees this).
 * The cluster is always torn down in `finally` unless `keepCluster` is set.
 *
 * @returns {Promise<import('streetjs').TargetVerification>}
 */
export async function deployAndVerify(opts) {
  const {
    cluster = 'street-verify',
    image = 'street-app:verify',
    namespace = 'default',
    repoRoot = process.cwd(),
    checksPath,
    keepCluster = false,
    localPort = 18080,
  } = opts;

  const log = [];
  const note = (line) => { log.push(line); };
  let portForward;

  const blockedOnStep = (stepId, output) =>
    classifyTargetVerification({
      target: 'kubernetes',
      status: 'BLOCKED',
      health: { live: false, ready: false, maxLatencyMs: 0 },
      blockedReason: { missingPrerequisite: stepId, kind: 'runtime' },
      smoke: { passed: 0, failed: 0, errored: 1, durationMs: 0, output: `${log.join('\n')}\n${output}`.trim() },
    });

  try {
    // 1. Create the kind cluster.
    note(`$ kind create cluster --name ${cluster}`);
    const create = run('kind', ['create', 'cluster', '--name', cluster, '--wait', '120s']);
    note(create.output);
    if (!create.ok) return blockedOnStep('kind-create-cluster', create.output);

    // 2. Build the application image and load it into the cluster.
    note(`$ docker build -t ${image} -f ${repoRoot}/infra/docker/Dockerfile ${repoRoot}`);
    const build = run('docker', ['build', '-t', image, '-f', `${repoRoot}/infra/docker/Dockerfile`, repoRoot]);
    note(build.output);
    if (!build.ok) return blockedOnStep('docker-build', build.output);

    note(`$ kind load docker-image ${image} --name ${cluster}`);
    const load = run('kind', ['load', 'docker-image', image, '--name', cluster]);
    note(load.output);
    if (!load.ok) return blockedOnStep('kind-load-image', load.output);

    // 3. Install the Helm chart, pinning the locally loaded image (never pull),
    //    a single replica with autoscaling disabled, and lazy DB init so the
    //    no-DB deployment serves health (Req 2.12).
    const chartDir = resolve(repoRoot, 'infra/helm/street');
    const [repo, tag] = image.includes(':') ? image.split(':') : [image, 'latest'];
    note(`$ helm install street ${chartDir} (image ${repo}:${tag}, pullPolicy=Never)`);
    const install = run('helm', [
      'install', 'street', chartDir,
      '--namespace', namespace,
      '--set', `image.repository=${repo}`,
      '--set', `image.tag=${tag}`,
      '--set', 'image.pullPolicy=Never',
      '--set', 'autoscaling.enabled=false',
      '--set', 'replicaCount=1',
      '--set', 'env.DB_INIT_MODE=lazy',
      '--wait', '--timeout', '180s',
    ]);
    note(install.output);
    if (!install.ok) return blockedOnStep('helm-install', install.output);

    // 4. Assert the pod reaches 1/1 Running.
    const pod = waitForPodRunning('app.kubernetes.io/name=street', namespace, 180_000);
    note(pod.output);
    if (!pod.ok) {
      return classifyTargetVerification({
        target: 'kubernetes',
        status: 'PARTIAL',
        health: { live: false, ready: false, maxLatencyMs: 0 },
        smoke: { passed: 0, failed: 0, errored: 1, durationMs: 0, output: log.join('\n') },
      });
    }

    // 5. Port-forward the service so health + smoke can reach the live pod.
    note(`$ kubectl port-forward svc/street ${localPort}:80`);
    portForward = spawn('kubectl', ['port-forward', `svc/street`, `${localPort}:80`, '-n', namespace], {
      stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 4_000)); // give the forward a moment to bind

    const baseUrl = `http://127.0.0.1:${localPort}`;

    // 6. Health probes (≤ 5s each, Req 2.9).
    const { health, log: healthLog } = await probeHealth(baseUrl);
    note(healthLog);

    // 7. Smoke checks (≤ 300s, 0 failed / 0 errored, Req 2.10).
    const checks = loadSmokeChecks(checksPath);
    const smoke = await runSmoke(baseUrl, checks);
    smoke.output = `${log.join('\n')}\n${smoke.output}`.trim();

    // 8. Classify against the live bounds — VERIFIED only when health + smoke
    //    both pass; PARTIAL with retained failing output otherwise (Req 2.13).
    return classifyTargetVerification({ target: 'kubernetes', status: 'PARTIAL', health, smoke });
  } finally {
    if (portForward && !portForward.killed) portForward.kill('SIGKILL');
    if (!keepCluster) {
      const del = run('kind', ['delete', 'cluster', '--name', cluster]);
      if (!del.ok) console.error(`[kind-verify] cluster teardown failed: ${del.output}`);
    }
  }
}

/**
 * Verify the Kubernetes target against a real kind cluster, or record an honest
 * BLOCKED (with offline evidence) when a prerequisite is missing.
 *
 * @returns {Promise<import('streetjs').TargetVerification>}
 */
export async function verifyKind(opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const cfg = {
    name: opts.name ?? 'street-app',
    image: opts.image ?? 'street-app:verify',
    port: opts.port ?? 3000,
  };

  const missing = probeKindPrerequisites();
  if (missing) {
    // Still gather the credential-free offline evidence so a BLOCKED capability
    // shows concrete executed progress (Req 2.14 / 1.5).
    const offline = runOfflineArtifacts('kubernetes', cfg);
    const binaryChecks = runBinaryOfflineArtifacts('kubernetes', { repoRoot });
    if (binaryChecks.length > 0) {
      offline.checks = [...offline.checks, ...binaryChecks];
      offline.allPassed = offline.checks.every((c) => c.passed || c.skipped === true);
    }
    return blockedTargetWithOfflineEvidence('kubernetes', missing, offline);
  }

  return deployAndVerify({
    cluster: opts.cluster,
    image: cfg.image,
    namespace: opts.namespace,
    repoRoot,
    checksPath: opts.checksPath,
    keepCluster: opts.keepCluster,
    localPort: opts.localPort,
  });
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const outRoot = flags.out ?? 'verification-artifacts';

  const result = await verifyKind({
    cluster: flags.cluster,
    image: flags.image,
    namespace: flags.namespace,
    repoRoot: flags['repo-root'] ?? process.cwd(),
    checksPath: flags.checks,
    keepCluster: flags['keep-cluster'] === true,
    localPort: flags.port ? Number(flags.port) : undefined,
  });

  const outPath = resolve(outRoot, 'cloud', 'targets', 'kubernetes.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log(`[kind-verify] kubernetes: ${result.status}`);
  if (result.blockedReason) {
    console.log(`[kind-verify]   blocked: ${result.blockedReason.kind}/${result.blockedReason.missingPrerequisite}`);
  }
  const offline = result.offlineArtifacts;
  if (offline) {
    const passed = offline.checks.filter((c) => c.passed).length;
    console.log(`[kind-verify]   offline evidence: ${passed}/${offline.checks.length} checks passed`);
    for (const c of offline.checks) {
      if (!c.passed && c.skipped !== true) console.log(`[kind-verify]     FAIL ${c.name}: ${c.errors.join('; ')}`);
      if (c.skipped) console.log(`[kind-verify]     SKIP ${c.name}: ${c.errors.join('; ')}`);
    }
  }
  for (const v of result.boundViolations ?? []) console.log(`[kind-verify]   bound exceeded: ${v}`);
  console.log(`[kind-verify]   result: ${outPath}`);

  process.exitCode = result.status === 'VERIFIED' ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[kind-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
