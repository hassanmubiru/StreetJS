// tests/leadership-aggregator.test.ts
// Unit tests for the Platform Leadership exit-criteria aggregator
// (Requirements 12.1, 12.2, 12.3, 12.4, 12.5). `computeLeadership()` derives the
// classification SOLELY from recorded Verification Artifacts.
//
// Covered here:
//  - GRANTED  — every required capability has a VERIFIED artifact (Req 12.1)
//  - WITHHELD — a required capability is non-VERIFIED, recorded with its status (Req 12.2)
//  - WITHHELD — a required capability has no artifact, treated as not VERIFIED (Req 12.3)
//  - report shape — required + statuses, decision, ISO-8601 timestamp, provenance (Req 12.5)
//  - the required set is exactly PLATFORM_LEADERSHIP_CAPABILITIES
//
// All checks run offline — no credentials, no network.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeLeadership,
  PLATFORM_LEADERSHIP_CAPABILITIES,
  type ArtifactSource,
} from '../verification/aggregator.js';
import type { VerificationArtifact } from '../verification/artifact.js';
import type { VerificationStatus } from '../verification/status.js';

// ── Fixtures ───────────────────────────────────────────────────────────────────

function artifact(
  capabilityId: string,
  status: VerificationStatus,
): VerificationArtifact {
  return {
    schemaVersion: 1,
    capabilityId,
    status,
    evidence: {
      sourceCode: status === 'VERIFIED',
      passingTests: status === 'VERIFIED',
      documentation: status === 'VERIFIED',
      artifact: status === 'VERIFIED',
    },
    command: `verify ${capabilityId}`,
    exitCode: status === 'VERIFIED' ? 0 : 1,
    timestamp: '2025-01-01T00:00:00.000Z',
    generator: { tool: 'test', version: '1.0.0' },
    ...(status === 'BLOCKED'
      ? { blockedReason: { missingPrerequisite: 'svc', kind: 'service' as const } }
      : {}),
  };
}

/** A full set of VERIFIED artifacts for every required capability. */
function allVerified(): VerificationArtifact[] {
  return PLATFORM_LEADERSHIP_CAPABILITIES.map((id) => artifact(id, 'VERIFIED'));
}

const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('computeLeadership — Platform Leadership exit criteria', () => {
  it('grants when every required capability is VERIFIED (Req 12.1)', () => {
    const report = computeLeadership(allVerified());
    assert.equal(report.decision, 'GRANTED');
    assert.equal(report.withheld.length, 0);
    assert.equal(report.required.length, PLATFORM_LEADERSHIP_CAPABILITIES.length);
    assert.ok(report.required.every((c) => c.status === 'VERIFIED' && c.hasArtifact));
  });

  it('records exactly the required capability set (Req 12.5)', () => {
    const report = computeLeadership(allVerified());
    assert.deepEqual(
      report.required.map((c) => c.capabilityId),
      [...PLATFORM_LEADERSHIP_CAPABILITIES],
    );
  });

  it('withholds and records a non-VERIFIED capability with its status (Req 12.2)', () => {
    const artifacts = allVerified();
    // Demote one required capability to PARTIAL.
    const target = PLATFORM_LEADERSHIP_CAPABILITIES[1];
    artifacts[1] = artifact(target, 'PARTIAL');

    const report = computeLeadership(artifacts);
    assert.equal(report.decision, 'WITHHELD');
    assert.equal(report.withheld.length, 1);
    assert.deepEqual(report.withheld[0], {
      capabilityId: target,
      status: 'PARTIAL',
      hasArtifact: true,
    });
  });

  it('treats a missing artifact as not VERIFIED and withholds (Req 12.3)', () => {
    const target = PLATFORM_LEADERSHIP_CAPABILITIES[0];
    // Provide every required capability EXCEPT the first.
    const artifacts = allVerified().filter((a) => a.capabilityId !== target);

    const report = computeLeadership(artifacts);
    assert.equal(report.decision, 'WITHHELD');
    const missing = report.required.find((c) => c.capabilityId === target);
    assert.ok(missing);
    assert.equal(missing.hasArtifact, false);
    assert.notEqual(missing.status, 'VERIFIED');
    assert.ok(report.withheld.some((c) => c.capabilityId === target && !c.hasArtifact));
  });

  it('ignores artifacts that are not required capabilities', () => {
    const artifacts = [...allVerified(), artifact('extra.capability', 'VERIFIED')];
    const report = computeLeadership(artifacts);
    assert.equal(report.decision, 'GRANTED');
    assert.equal(report.required.length, PLATFORM_LEADERSHIP_CAPABILITIES.length);
    assert.ok(!report.required.some((c) => c.capabilityId === 'extra.capability'));
  });

  it('emits an ISO-8601 timestamp and records artifact provenance (Req 12.4, 12.5)', () => {
    const sources: ArtifactSource[] = PLATFORM_LEADERSHIP_CAPABILITIES.map((id) => ({
      artifact: artifact(id, 'VERIFIED'),
      path: `verification-artifacts/${id}.artifact.json`,
    }));
    const report = computeLeadership(sources);
    assert.match(report.timestamp, ISO_8601);
    assert.equal(report.computedFrom.length, PLATFORM_LEADERSHIP_CAPABILITIES.length);
    assert.ok(report.computedFrom.every((p) => p.endsWith('.artifact.json')));
  });

  it('is deterministic in decision for the same artifacts (injected clock)', () => {
    const clock = new Date('2025-06-01T12:00:00.000Z');
    const a = computeLeadership(allVerified(), clock);
    const b = computeLeadership(allVerified(), clock);
    assert.deepEqual(a, b);
  });
});

// ── Roll-up capability resolution (design → Exit-Criteria set) ──────────────────
//
// `cloud.deploy`, `plugins.ecosystem`, and `kafka.chaos` are roll-ups: they hold
// no artifact of their own. They are VERIFIED only when every member artifact a
// verifier actually emits is VERIFIED, where members are matched by id prefix
// (`cloud.deploy.<target>`, `plugin.<id>`, `kafka.coldstart` / `kafka.chaos.<scenario>`).

describe('computeLeadership — roll-up capability resolution', () => {
  /** All required capabilities VERIFIED, but the roll-ups expressed via members. */
  function allVerifiedViaMembers(): VerificationArtifact[] {
    const out: VerificationArtifact[] = [];
    for (const id of PLATFORM_LEADERSHIP_CAPABILITIES) {
      if (id === 'cloud.deploy') {
        out.push(artifact('cloud.deploy.kubernetes', 'VERIFIED'));
        out.push(artifact('cloud.deploy.cloudrun', 'VERIFIED'));
      } else if (id === 'plugins.ecosystem') {
        out.push(artifact('plugin.redis', 'VERIFIED'));
        out.push(artifact('plugin.s3', 'VERIFIED'));
      } else if (id === 'kafka.chaos') {
        out.push(artifact('kafka.coldstart', 'VERIFIED'));
        out.push(artifact('kafka.chaos.broker-restart', 'VERIFIED'));
      } else {
        out.push(artifact(id, 'VERIFIED'));
      }
    }
    return out;
  }

  it('GRANTS when every roll-up member is VERIFIED (no bare roll-up artifact present)', () => {
    const report = computeLeadership(allVerifiedViaMembers());
    assert.equal(report.decision, 'GRANTED');
    for (const id of ['cloud.deploy', 'plugins.ecosystem', 'kafka.chaos']) {
      const entry = report.required.find((c) => c.capabilityId === id);
      assert.ok(entry);
      assert.equal(entry.status, 'VERIFIED');
      assert.equal(entry.hasArtifact, true);
    }
  });

  it('WITHHOLDS a roll-up when any single member is not VERIFIED', () => {
    const artifacts = allVerifiedViaMembers().filter(
      (a) => a.capabilityId !== 'plugin.s3',
    );
    artifacts.push(artifact('plugin.s3', 'BLOCKED'));

    const report = computeLeadership(artifacts);
    assert.equal(report.decision, 'WITHHELD');
    const eco = report.required.find((c) => c.capabilityId === 'plugins.ecosystem');
    assert.ok(eco);
    assert.equal(eco.status, 'BLOCKED'); // most severe non-VERIFIED member surfaces
    assert.equal(eco.hasArtifact, true);
  });

  it('treats a roll-up with no members as not VERIFIED (hasArtifact=false)', () => {
    const artifacts = allVerifiedViaMembers().filter(
      (a) => !a.capabilityId.startsWith('kafka.'),
    );
    const report = computeLeadership(artifacts);
    assert.equal(report.decision, 'WITHHELD');
    const kafka = report.required.find((c) => c.capabilityId === 'kafka.chaos');
    assert.ok(kafka);
    assert.equal(kafka.hasArtifact, false);
    assert.equal(kafka.status, 'NOT_IMPLEMENTED');
  });

  it('a directly-recorded roll-up artifact takes precedence over member resolution', () => {
    // Members say BLOCKED, but a bare cloud.deploy VERIFIED artifact wins.
    const artifacts = allVerifiedViaMembers();
    artifacts.push(artifact('cloud.deploy.ecs', 'BLOCKED'));
    artifacts.push(artifact('cloud.deploy', 'VERIFIED'));

    const report = computeLeadership(artifacts);
    const cloud = report.required.find((c) => c.capabilityId === 'cloud.deploy');
    assert.ok(cloud);
    assert.equal(cloud.status, 'VERIFIED');
  });
});
