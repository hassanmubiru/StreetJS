// scripts/tests/kind-verify.test.mjs
//
// Layer-B kind-cluster integration verification for the Kubernetes target
// (Requirements 2.9, 2.10). Two concerns are covered:
//
//  1. Honest BLOCKED (offline-verifiable, runs everywhere): when a kind
//     prerequisite (`docker`/`kind`/`kubectl`/`helm`) is absent, `verifyKind()`
//     records the target BLOCKED with the SPECIFIC missing prerequisite id and
//     STILL attaches the credential-free offline evidence — never a mock, never
//     PARTIAL/VERIFIED.
//
//  2. The real kind-cluster run (Layer B): when a kind cluster is reachable,
//     deploy the Helm chart and assert the pod reaches `1/1 Running`, the health
//     endpoints return 200, and smoke completes with 0 failed / 0 errored. When
//     kind is NOT reachable, the test SKIPS (never fails) — mirroring the repo's
//     `kafka.integration.test.ts` convention — so the offline suite stays green
//     while the artifact honestly records BLOCKED.
//
// Run: node --test scripts/tests/kind-verify.test.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  KIND_PREREQUISITES,
  probeKindPrerequisites,
  verifyKind,
} from '../cloud/kind-verify.mjs';

/** kind is "reachable" only when every prerequisite binary is present. */
function kindReachable() {
  return probeKindPrerequisites() === null;
}

describe('kind prerequisites', () => {
  it('declares docker, kind, kubectl, and helm in probe order', () => {
    assert.deepEqual(
      KIND_PREREQUISITES.map((d) => d.id),
      ['docker', 'kind', 'kubectl', 'helm'],
    );
    for (const dep of KIND_PREREQUISITES) {
      assert.equal(dep.kind, 'runtime');
      assert.ok(dep.description.length > 0);
    }
  });

  it('probe returns the first missing dependency, or null when all present', () => {
    const missing = probeKindPrerequisites();
    if (missing === null) {
      // Every binary present — nothing to assert beyond the null contract.
      assert.equal(kindReachable(), true);
    } else {
      // The reported missing dep must be a declared prerequisite.
      assert.ok(KIND_PREREQUISITES.some((d) => d.id === missing.id));
      assert.equal(missing.kind, 'runtime');
    }
  });
});

describe('verifyKind — honest BLOCKED with offline evidence (no infra)', () => {
  it('records BLOCKED on the specific missing prerequisite when kind is unreachable', async (t) => {
    if (kindReachable()) {
      t.skip('kind prerequisites present; BLOCKED path not exercised here');
      return;
    }

    const result = await verifyKind();

    // Honest BLOCKED — never a mock, never PARTIAL/VERIFIED (Req 2.14 / 1.5).
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.target, 'kubernetes');
    assert.ok(result.blockedReason, 'a BLOCKED target must record a blockedReason');

    // The recorded prerequisite is the SPECIFIC first-missing binary.
    const expected = probeKindPrerequisites();
    assert.equal(result.blockedReason.missingPrerequisite, expected.id);
    assert.equal(result.blockedReason.kind, 'runtime');

    // Offline-verifiable evidence still ran and is attached, so a BLOCKED
    // capability shows concrete executed progress (Req 2.14).
    assert.ok(result.offlineArtifacts, 'BLOCKED must still attach offline evidence');
    assert.ok(result.offlineArtifacts.checks.length > 0, 'offline checks must have run');
    // The pure manifest validation must be among the executed offline checks.
    assert.ok(
      result.offlineArtifacts.checks.some((c) => c.name === 'validateDeploymentManifest'),
      'manifest validation must run as offline evidence',
    );
    // The generated k8s manifest must pass structural validation offline.
    const manifestCheck = result.offlineArtifacts.checks.find((c) => c.name === 'validateDeploymentManifest');
    assert.equal(manifestCheck.passed, true, manifestCheck.errors.join('; '));
  });
});

describe('verifyKind — real kind cluster (Layer B; basis for VERIFIED)', () => {
  it('deploys to kind and meets the live health + smoke bounds', async (t) => {
    if (!kindReachable()) {
      t.skip('kind cluster prerequisites not reachable (docker/kind/kubectl/helm)');
      return;
    }

    // A real cluster create + build + deploy + verify can take minutes.
    t.timeout?.(15 * 60 * 1000);

    const result = await verifyKind({ cluster: 'street-verify-test' });

    assert.equal(result.target, 'kubernetes');
    // VERIFIED is earned only by the live bounds: pod 1/1 Running, health 200,
    // smoke 0 fail / 0 error (Req 2.9, 2.10).
    assert.equal(result.status, 'VERIFIED', `expected VERIFIED, got ${result.status}`);
    assert.equal(result.health.live, true);
    assert.equal(result.health.ready, true);
    assert.ok(result.health.maxLatencyMs <= 5_000, 'health must respond within 5s per request');
    assert.ok(result.smoke, 'a verified target must carry smoke results');
    assert.equal(result.smoke.failed, 0);
    assert.equal(result.smoke.errored, 0);
    assert.ok(result.smoke.durationMs <= 300_000, 'smoke must complete within 300s');
  });
});
