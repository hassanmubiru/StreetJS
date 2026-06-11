// scripts/tests/kafka-chaos-harness.test.mjs
//
// Unit tests for the Kafka cold-start + chaos Layer-B verification harness
// (Requirements 9.4–9.8, task 15.5). These exercise the harness's pure,
// container-free logic:
//
//   • buildChaosArtifacts turns a machine-readable chaos-run summary into one
//     well-formed Verification Artifact per capability (kafka.coldstart +
//     kafka.chaos.*), each carrying the parameter values, pass count, and
//     lost-message count (Req 9.8) and each passing the core schema validator.
//   • status is assigned by the shared classify() engine: an all-pass full-scale
//     run is VERIFIED, a scenario that lost messages is PARTIAL (independently
//     of the other scenarios), and a missing prerequisite is an honest BLOCKED
//     that preserves the specific missing prerequisite (Req 1.5).
//   • the Kafka prerequisite probe returns either null (the suite can run) or a
//     well-formed BlockedReason `{ missingPrerequisite, kind }`.
//
// The real 100/100 run against a live broker is Layer B and is covered by the
// kafka.coldstart / kafka.chaos.* Verification Artifacts produced through
// CommandRunner; it is intentionally NOT run here so the unit suite stays green
// without a broker or container runtime.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { validateArtifact, FULL_SCALE_COLD_STARTS, FULL_SCALE_RESTART_CYCLES } from 'streetjs';
import { buildChaosArtifacts, CHAOS_CAPABILITIES } from '../reliability/verify.mjs';
import { probeKafkaPrerequisites } from '../reliability/lib.mjs';

const PARAMS = {
  coldStarts: FULL_SCALE_COLD_STARTS,
  restartCycles: FULL_SCALE_RESTART_CYCLES,
  accountCount: 50,
  slowBrokerMs: 5000,
  brokers: '127.0.0.1:9092',
};

/** A full-scale, all-pass, zero-loss summary as the harness would emit it. */
function passingSummary() {
  return {
    coldStarts: FULL_SCALE_COLD_STARTS,
    restartCycles: FULL_SCALE_RESTART_CYCLES,
    failures: 0,
    totalProduced: 250,
    totalLost: 0,
    scenarios: {
      'cold-start': { ran: true, ok: true, pass: 100, total: 100, produced: 50, deliveredToCommitted: 50, lost: 0 },
      'broker-restart': { ran: true, ok: true, pass: 100, total: 100, produced: 50, deliveredToCommitted: 50, lost: 0 },
      'network-interruption': { ran: true, ok: true, pass: 1, total: 1, produced: 50, deliveredToCommitted: 50, lost: 0 },
      'connection-loss': { ran: true, ok: true, pass: 1, total: 1, produced: 50, deliveredToCommitted: 50, lost: 0 },
      'slow-broker': { ran: true, ok: true, pass: 1, total: 1, produced: 50, deliveredToCommitted: 50, lost: 0 },
    },
  };
}

describe('kafka chaos harness — pure artifact logic', () => {
  it('emits exactly one VERIFIED, schema-valid artifact per capability for an all-pass full-scale run', () => {
    const artifacts = buildChaosArtifacts({
      summary: passingSummary(),
      command: 'bash scripts/reliability/kafka-cold-start.sh',
      outcome: { exitCode: 0, timedOut: false, durationMs: 123456 },
      params: PARAMS,
    });

    assert.equal(artifacts.length, CHAOS_CAPABILITIES.length);
    const ids = artifacts.map((a) => a.capabilityId);
    assert.deepEqual(ids, CHAOS_CAPABILITIES.map((c) => c.capabilityId));

    for (const { capabilityId, artifact } of artifacts) {
      const check = validateArtifact(artifact);
      assert.equal(check.valid, true, `artifact for ${capabilityId} should be schema-valid: ${check.errors.join('; ')}`);
      assert.equal(artifact.status, 'VERIFIED', `${capabilityId} should be VERIFIED on an all-pass run`);
      assert.equal(artifact.exitCode, 0);
      // Parameter values + lost-message count recorded (Req 9.8).
      assert.equal(artifact.details.lostMessages, 0, `${capabilityId} must record 0 lost messages`);
      assert.equal(artifact.details.parameters.coldStarts, 100);
      assert.equal(artifact.details.parameters.restartCycles, 100);
      assert.equal(typeof artifact.timestamp, 'string');
    }

    // The cold-start + broker-restart pass counts reflect the full-scale targets.
    const coldstart = artifacts.find((a) => a.capabilityId === 'kafka.coldstart');
    assert.equal(coldstart.details.passCount, 100);
    assert.equal(coldstart.details.total, 100);
    const restart = artifacts.find((a) => a.capabilityId === 'kafka.chaos.broker-restart');
    assert.equal(restart.details.passCount, 100);
  });

  it('classifies a lost-message scenario as PARTIAL without dragging down the passing scenarios', () => {
    const summary = passingSummary();
    summary.scenarios['slow-broker'] = { ran: true, ok: false, pass: 0, total: 1, produced: 50, deliveredToCommitted: 47, lost: 3 };
    summary.failures = 1;

    // The whole suite exits non-zero, but each scenario is judged on its own run.
    const artifacts = buildChaosArtifacts({
      summary,
      command: 'bash scripts/reliability/kafka-cold-start.sh',
      outcome: { exitCode: 1, timedOut: false, durationMs: 1000 },
      params: PARAMS,
    });

    const slow = artifacts.find((a) => a.capabilityId === 'kafka.chaos.slow-broker');
    assert.equal(slow.status, 'PARTIAL', 'a scenario that lost messages must not be VERIFIED');
    assert.equal(slow.details.lostMessages, 3, 'the lost-message count is recorded exactly');
    assert.equal(slow.exitCode, 1);

    const coldstart = artifacts.find((a) => a.capabilityId === 'kafka.coldstart');
    assert.equal(coldstart.status, 'VERIFIED', 'a passing scenario stays VERIFIED even when another fails');
  });

  it('records an honest BLOCKED preserving the missing prerequisite when no broker is available', () => {
    const blockedReason = { missingPrerequisite: 'kafka-broker', kind: 'service' };
    const artifacts = buildChaosArtifacts({
      summary: null,
      command: 'bash scripts/reliability/kafka-cold-start.sh',
      outcome: { exitCode: 0, timedOut: false, durationMs: 0 },
      params: PARAMS,
      blockedReason,
    });

    for (const { capabilityId, artifact } of artifacts) {
      const check = validateArtifact(artifact);
      assert.equal(check.valid, true, `blocked artifact for ${capabilityId} should be schema-valid: ${check.errors.join('; ')}`);
      assert.equal(artifact.status, 'BLOCKED', `${capabilityId} should be BLOCKED with no broker`);
      assert.equal(artifact.blockedReason.missingPrerequisite, 'kafka-broker');
      assert.equal(artifact.blockedReason.kind, 'service');
      // Parameter values are still recorded so a BLOCKED run shows what it would run.
      assert.equal(artifact.details.parameters.coldStarts, 100);
      assert.equal(artifact.details.ran, false);
    }
  });

  it('records BLOCKED with the timeout prerequisite when the run is timed out', () => {
    const artifacts = buildChaosArtifacts({
      summary: null,
      command: 'bash scripts/reliability/kafka-cold-start.sh',
      outcome: { exitCode: 137, timedOut: true, durationMs: 14400000 },
      params: PARAMS,
      blockedReason: { kind: 'timeout', missingPrerequisite: 'timeout' },
    });
    for (const { artifact } of artifacts) {
      assert.equal(artifact.status, 'BLOCKED');
      assert.equal(artifact.timedOut, true);
      assert.equal(artifact.blockedReason.kind, 'timeout');
    }
  });

  it('probeKafkaPrerequisites returns null or a well-formed BlockedReason', async () => {
    const result = await probeKafkaPrerequisites({ brokers: '127.0.0.1:9092' });
    if (result === null) return; // a broker or a usable container runtime is present

    assert.equal(typeof result.missingPrerequisite, 'string');
    assert.ok(result.missingPrerequisite.length > 0, 'missing prerequisite id must be non-empty');
    assert.ok(['runtime', 'service'].includes(result.kind), `kind must be runtime|service, got ${result.kind}`);
  });
});
