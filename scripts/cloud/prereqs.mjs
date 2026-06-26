// scripts/cloud/prereqs.mjs
//
// Prerequisite probes and binary-backed offline-verifiable artifacts for the
// Cloud Deployment Verifier (Requirements 2.14, 1.5).
//
//  • Prerequisite probes inspect the *environment* — are the required CLI
//    binaries on PATH (kubectl/helm/aws/gcloud/wrangler/func) and are the
//    required credentials present? The set of dependencies each target needs is
//    declared in @streetjs/core (`targetDependencies`), so this script only
//    decides "present or absent" and returns the FIRST missing dependency as a
//    `BlockedReason` (`{ missingPrerequisite, kind }`). The caller records the
//    target BLOCKED with that specific missing dependency id.
//
//  • Binary-backed offline artifacts (`helm lint`, `helm template`,
//    `wrangler deploy --dry-run`) need NO cloud credentials, only the tool. They
//    run when the tool is installed and layer onto the pure, zero-dependency
//    offline evidence produced by `runOfflineArtifacts` in core.
//
// Zero runtime dependencies: only Node core (`node:child_process`, `node:fs`).

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { targetDependencies } from 'streetjs';

/** True iff the given executable resolves on PATH (`command -v <bin>`). */
export function hasBinary(bin) {
  const r = spawnSync('command', ['-v', bin], { shell: true, encoding: 'utf8' });
  return r.status === 0 && String(r.stdout ?? '').trim() !== '';
}

/**
 * True iff the named credential is available. A credential id may be satisfied
 * either by an environment variable of that name or, for file-path credentials
 * like KUBECONFIG / GOOGLE_APPLICATION_CREDENTIALS, by the referenced file
 * existing.
 */
export function hasCredential(id) {
  const value = process.env[id];
  if (value === undefined || value === '') return false;
  // For path-style credentials, also require the file to exist when it looks
  // like a filesystem path.
  if ((id === 'KUBECONFIG' || id === 'GOOGLE_APPLICATION_CREDENTIALS') && value.includes('/')) {
    return existsSync(value);
  }
  return true;
}

/**
 * Probe the deploy-time prerequisites for a target in declared order and return
 * the FIRST missing one as a `BlockedReason`, or `null` when all prerequisites
 * are satisfied (Requirement 2.14 / 1.5).
 *
 * @param {string} target  A DeploymentTarget id.
 * @returns {{ missingPrerequisite: string, kind: 'runtime'|'credential' } | null}
 */
export function probeTargetPrerequisites(target) {
  for (const dep of targetDependencies(target)) {
    const present = dep.kind === 'runtime' ? hasBinary(dep.id) : hasCredential(dep.id);
    if (!present) {
      return { missingPrerequisite: dep.id, kind: dep.kind };
    }
  }
  return null;
}

/** Run one binary-backed offline check; returns an OfflineCheckResult shape. */
function runBinaryCheck(name, bin, args, cwd) {
  if (!hasBinary(bin)) {
    return { name, passed: false, errors: [`${bin} not installed (offline check skipped)`], skipped: true };
  }
  const r = spawnSync(bin, args, { encoding: 'utf8', cwd });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim();
  return {
    name,
    passed: r.status === 0,
    errors: r.status === 0 ? [] : [output || `${bin} exited with status ${r.status}`],
  };
}

/**
 * Run the binary-backed offline-verifiable artifacts for a target — the checks
 * that need a CLI tool but NO cloud credentials. These complement the pure
 * offline evidence from `runOfflineArtifacts` in core. A check whose tool is
 * absent is reported as skipped (passed=false, skipped=true) rather than a hard
 * failure, so a credential-free environment without the tool installed is still
 * honestly recorded.
 *
 * @param {string} target
 * @param {{ repoRoot?: string }} [opts]
 * @returns {Array<{name:string,passed:boolean,errors:string[],skipped?:boolean}>}
 */
export function runBinaryOfflineArtifacts(target, opts = {}) {
  const repoRoot = opts.repoRoot ?? process.cwd();
  const checks = [];
  switch (target) {
    case 'kubernetes': {
      const chartDir = `${repoRoot}/infra/helm/street`;
      if (existsSync(chartDir)) {
        checks.push(runBinaryCheck('helm-lint', 'helm', ['lint', chartDir]));
        checks.push(runBinaryCheck('helm-template', 'helm', ['template', 'street', chartDir]));
      }
      break;
    }
    case 'cloudflare-workers': {
      const cfg = `${repoRoot}/infra/examples/cloudflare/wrangler.toml`;
      if (existsSync(cfg)) {
        checks.push(runBinaryCheck('wrangler-dry-run', 'npx', ['wrangler', 'deploy', '--dry-run', '--config', cfg]));
      }
      break;
    }
    default:
      // Other targets have no additional binary-backed offline artifacts.
      break;
  }
  return checks;
}
