// tests/deployment-report.test.ts
// Unit tests for the Cloud Deployment Verifier report status mapping
// (Requirements 2.11, 2.13, 2.14). `classifyTargetVerification()` re-classifies
// each per-target result against the published health/smoke bounds and
// `buildDeploymentReport()` rolls the results up with an ISO-8601 run timestamp.
//
// Covered here:
//  - VERIFIED  — all health/smoke bounds satisfied (Req 2.11)
//  - PARTIAL   — a health or smoke bound exceeded, with the failing output
//                retained in `boundViolations` (Req 2.13)
//  - BLOCKED   — a missing deployment dependency, recorded with the specific id,
//                taking precedence over the bounds (Req 2.14)
//  - report shape — one of the four statuses per target + ISO-8601 timestamp (Req 2.11)
//
// All checks run offline — no credentials, no network.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTargetVerification,
  buildDeploymentReport,
  HEALTH_LATENCY_BUDGET_MS,
  SMOKE_DURATION_BUDGET_MS,
  type TargetVerification,
  type SmokeResult,
  type DeploymentTarget,
} from '../cloud/deployment.js';
import type { VerificationStatus } from '../verification/status.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

/** A passing smoke run well within all bounds. */
function healthySmoke(overrides: Partial<SmokeResult> = {}): SmokeResult {
  return {
    passed: 12,
    failed: 0,
    errored: 0,
    durationMs: 42_000,
    output: 'all smoke cases passed',
    ...overrides,
  };
}

/** A target whose health probes are healthy and within the latency budget. */
function verifiableTarget(overrides: Partial<TargetVerification> = {}): TargetVerification {
  return {
    target: 'kubernetes',
    // Incoming status is irrelevant — classification recomputes it. Use a
    // deliberately stale value to prove the result is the authority.
    status: 'PARTIAL',
    health: { live: true, ready: true, maxLatencyMs: 1_200 },
    smoke: healthySmoke(),
    ...overrides,
  };
}

// ── VERIFIED mapping (Req 2.11) ──────────────────────────────────────────────────

describe('classifyTargetVerification — VERIFIED mapping (Req 2.11)', () => {
  it('maps a target with healthy probes and a clean smoke run to VERIFIED', () => {
    const tv = classifyTargetVerification(verifiableTarget());
    assert.equal(tv.status, 'VERIFIED');
  });

  it('clears any stale boundViolations when classifying VERIFIED', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({ boundViolations: ['a stale violation from a prior run'] }),
    );
    assert.equal(tv.status, 'VERIFIED');
    assert.equal(tv.boundViolations, undefined);
  });

  it('treats latency exactly at the budget as VERIFIED (boundary, inclusive)', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({ health: { live: true, ready: true, maxLatencyMs: HEALTH_LATENCY_BUDGET_MS } }),
    );
    assert.equal(tv.status, 'VERIFIED');
  });

  it('treats smoke duration exactly at the budget as VERIFIED (boundary, inclusive)', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({ smoke: healthySmoke({ durationMs: SMOKE_DURATION_BUDGET_MS }) }),
    );
    assert.equal(tv.status, 'VERIFIED');
  });

  it('is idempotent — re-classifying a VERIFIED result yields VERIFIED', () => {
    const once = classifyTargetVerification(verifiableTarget());
    const twice = classifyTargetVerification(once);
    assert.equal(twice.status, 'VERIFIED');
    assert.deepEqual(twice, once);
  });
});

// ── PARTIAL mapping + retained failing output (Req 2.13) ─────────────────────────

describe('classifyTargetVerification — PARTIAL mapping retains failing output (Req 2.13)', () => {
  it('maps an over-budget health latency to PARTIAL and retains the violation', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({
        health: { live: true, ready: true, maxLatencyMs: HEALTH_LATENCY_BUDGET_MS + 1 },
      }),
    );
    assert.equal(tv.status, 'PARTIAL');
    assert.ok(tv.boundViolations && tv.boundViolations.length > 0);
    assert.match(tv.boundViolations.join(';'), /health latency .*exceeded/);
  });

  it('maps an unhealthy probe to PARTIAL naming the specific endpoint', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({ health: { live: true, ready: false, maxLatencyMs: 800 } }),
    );
    assert.equal(tv.status, 'PARTIAL');
    assert.match(tv.boundViolations!.join(';'), /\/health\/ready did not report healthy/);
  });

  it('maps failed/errored smoke cases to PARTIAL retaining the counts', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({ smoke: healthySmoke({ failed: 2, errored: 1 }) }),
    );
    assert.equal(tv.status, 'PARTIAL');
    const joined = tv.boundViolations!.join(';');
    assert.match(joined, /2 smoke case\(s\) failed/);
    assert.match(joined, /1 smoke case\(s\) errored/);
  });

  it('maps an over-budget smoke duration to PARTIAL and retains the violation', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({ smoke: healthySmoke({ durationMs: SMOKE_DURATION_BUDGET_MS + 1 }) }),
    );
    assert.equal(tv.status, 'PARTIAL');
    assert.match(tv.boundViolations!.join(';'), /smoke duration .*exceeded/);
  });

  it('maps a missing smoke run to PARTIAL', () => {
    const tv = classifyTargetVerification(verifiableTarget({ smoke: undefined }));
    assert.equal(tv.status, 'PARTIAL');
    assert.match(tv.boundViolations!.join(';'), /smoke tests did not run/);
  });

  it('retains the smoke output on the PARTIAL result (failing output preserved)', () => {
    const output = 'case "checkout" failed: expected 200, got 503\nstderr: connection reset';
    const tv = classifyTargetVerification(
      verifiableTarget({ smoke: healthySmoke({ failed: 1, output }) }),
    );
    assert.equal(tv.status, 'PARTIAL');
    assert.equal(tv.smoke?.output, output, 'verbatim smoke output is retained in the report');
  });

  it('accumulates every exceeded bound in boundViolations', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({
        health: { live: false, ready: false, maxLatencyMs: HEALTH_LATENCY_BUDGET_MS + 100 },
        smoke: healthySmoke({ failed: 3, errored: 2, durationMs: SMOKE_DURATION_BUDGET_MS + 50 }),
      }),
    );
    assert.equal(tv.status, 'PARTIAL');
    // 2 health-endpoint + 1 health-latency + failed + errored + duration = 6 violations.
    assert.equal(tv.boundViolations!.length, 6);
  });

  it('is idempotent — re-classifying a PARTIAL result yields the same status and violations', () => {
    const once = classifyTargetVerification(
      verifiableTarget({ smoke: healthySmoke({ failed: 1 }) }),
    );
    const twice = classifyTargetVerification(once);
    assert.equal(twice.status, 'PARTIAL');
    assert.deepEqual(twice.boundViolations, once.boundViolations);
  });
});

// ── BLOCKED mapping (Req 2.14) ───────────────────────────────────────────────────

describe('classifyTargetVerification — BLOCKED mapping (Req 2.14)', () => {
  it('maps a set blockedReason to BLOCKED, recording the specific missing dependency', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({
        target: 'ecs',
        blockedReason: { missingPrerequisite: 'aws', kind: 'runtime' },
      }),
    );
    assert.equal(tv.status, 'BLOCKED');
    assert.equal(tv.blockedReason?.missingPrerequisite, 'aws');
    assert.equal(tv.blockedReason?.kind, 'runtime');
  });

  it('maps an incoming BLOCKED status to BLOCKED even without a reason', () => {
    const tv = classifyTargetVerification(verifiableTarget({ status: 'BLOCKED' }));
    assert.equal(tv.status, 'BLOCKED');
  });

  it('lets a missing dependency take precedence over exceeded bounds', () => {
    // Even with healthy bounds it would be VERIFIED — the missing dependency wins.
    const tv = classifyTargetVerification(
      verifiableTarget({
        blockedReason: { missingPrerequisite: 'KUBECONFIG', kind: 'credential' },
        health: { live: true, ready: true, maxLatencyMs: 100 },
        smoke: healthySmoke(),
      }),
    );
    assert.equal(tv.status, 'BLOCKED');
    assert.equal(tv.blockedReason?.missingPrerequisite, 'KUBECONFIG');
  });

  it('preserves NOT_IMPLEMENTED for a target with no generated assets', () => {
    const tv = classifyTargetVerification(
      verifiableTarget({ status: 'NOT_IMPLEMENTED' }),
    );
    assert.equal(tv.status, 'NOT_IMPLEMENTED');
  });
});

// ── Report roll-up shape (Req 2.11) ──────────────────────────────────────────────

describe('buildDeploymentReport — report shape (Req 2.11)', () => {
  const FOUR_STATUSES: VerificationStatus[] = ['VERIFIED', 'PARTIAL', 'BLOCKED', 'NOT_IMPLEMENTED'];

  it('records one of the four statuses per target and an ISO-8601 timestamp', () => {
    const results: TargetVerification[] = [
      verifiableTarget({ target: 'kubernetes' }), // → VERIFIED
      verifiableTarget({ target: 'cloudrun', smoke: healthySmoke({ failed: 1 }) }), // → PARTIAL
      verifiableTarget({
        target: 'ecs',
        blockedReason: { missingPrerequisite: 'aws', kind: 'runtime' },
      }), // → BLOCKED
      verifiableTarget({ target: 'lambda', status: 'NOT_IMPLEMENTED' }), // → NOT_IMPLEMENTED
    ];

    const report = buildDeploymentReport(results);

    assert.equal(report.targets.length, 4);
    for (const t of report.targets) {
      assert.ok(FOUR_STATUSES.includes(t.status), `unexpected status ${t.status}`);
    }

    // Timestamp is a valid, round-trippable ISO-8601 instant.
    assert.equal(typeof report.timestamp, 'string');
    assert.match(report.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/);
    assert.equal(new Date(report.timestamp).toISOString(), report.timestamp);
  });

  it('maps each target to the expected status across the four cases', () => {
    const report = buildDeploymentReport([
      verifiableTarget({ target: 'kubernetes' }),
      verifiableTarget({ target: 'cloudrun', smoke: healthySmoke({ failed: 1 }) }),
      verifiableTarget({
        target: 'ecs',
        blockedReason: { missingPrerequisite: 'aws', kind: 'runtime' },
      }),
      verifiableTarget({ target: 'lambda', status: 'NOT_IMPLEMENTED' }),
    ]);

    const byTarget = new Map<DeploymentTarget, VerificationStatus>(
      report.targets.map((t) => [t.target, t.status]),
    );
    assert.equal(byTarget.get('kubernetes'), 'VERIFIED');
    assert.equal(byTarget.get('cloudrun'), 'PARTIAL');
    assert.equal(byTarget.get('ecs'), 'BLOCKED');
    assert.equal(byTarget.get('lambda'), 'NOT_IMPLEMENTED');
  });

  it('retains the failing output of a PARTIAL target in the report (Req 2.13)', () => {
    const output = 'smoke: 1 failed (timeout after 5001ms on /api/orders)';
    const report = buildDeploymentReport([
      verifiableTarget({ target: 'cloudrun', smoke: healthySmoke({ failed: 1, output }) }),
    ]);
    const partial = report.targets.find((t) => t.target === 'cloudrun');
    assert.ok(partial);
    assert.equal(partial.status, 'PARTIAL');
    assert.ok(partial.boundViolations && partial.boundViolations.length > 0);
    assert.equal(partial.smoke?.output, output);
  });

  it('records a BLOCKED target with its specific missing dependency in the report (Req 2.14)', () => {
    const report = buildDeploymentReport([
      verifiableTarget({
        target: 'cloudflare-workers',
        blockedReason: { missingPrerequisite: 'CLOUDFLARE_API_TOKEN', kind: 'credential' },
      }),
    ]);
    const blocked = report.targets.find((t) => t.target === 'cloudflare-workers');
    assert.ok(blocked);
    assert.equal(blocked.status, 'BLOCKED');
    assert.equal(blocked.blockedReason?.missingPrerequisite, 'CLOUDFLARE_API_TOKEN');
  });

  it('produces an empty target list for no results', () => {
    const report = buildDeploymentReport([]);
    assert.deepEqual(report.targets, []);
    assert.match(report.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  });
});
