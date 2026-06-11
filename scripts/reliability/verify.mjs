#!/usr/bin/env node
// scripts/reliability/verify.mjs
//
// Kafka cold-start + chaos Layer-B verification driver (Requirements 9.4–9.8,
// task 15.5).
//
// Drives the zero-dependency `CommandRunner` from @streetjs/core to execute the
// parameterized chaos harness (kafka-cold-start.sh) at the full-scale targets —
// 100 cold starts and 100 broker restarts plus the network-interruption,
// connection-loss, and slow-broker scenarios — against a real `apache/kafka:3.7.1`
// (KRaft) broker in Docker, and emit one machine-readable Verification Artifact
// per capability under verification-artifacts/kafka/:
//
//     kafka.coldstart.artifact.json
//     kafka.chaos.broker-restart.artifact.json
//     kafka.chaos.network-interruption.artifact.json
//     kafka.chaos.connection-loss.artifact.json
//     kafka.chaos.slow-broker.artifact.json
//
// Each artifact records the parameter values (cold-start / restart-cycle
// counts, slow-broker delay, broker address), the pass count, the lost-message
// count, and an ISO-8601 timestamp (Req 9.8).
//
// Honest BLOCKED (Requirement 1.5 / Testing Strategy → Honest BLOCKED): when no
// broker is reachable AND no usable container runtime + Kafka image is present
// to boot one, the driver records every capability as an honest BLOCKED with the
// specific missing prerequisite — never a mock, never a false VERIFIED — and
// exits 0 (a BLOCKED skip does not fail CI). A genuine suite failure exits
// non-zero and fails the CI step.
//
// _Design: Testing Strategy → Layer B + Honest BLOCKED. Requirements: 9.4, 9.5,
//  9.6, 9.7, 9.8, 1.5_

import { readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  CommandRunner,
  classify,
  validateArtifact,
  FULL_SCALE_COLD_STARTS,
  FULL_SCALE_RESTART_CYCLES,
  SLOW_BROKER_MIN_DELAY_MS,
} from 'streetjs';

import {
  REPO_ROOT,
  DEFAULT_BROKERS,
  probeKafkaPrerequisites,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CHAOS_SCRIPT = resolve(HERE, 'kafka-cold-start.sh');

/** The producing tool recorded in every artifact's `generator` field. */
const GENERATOR = { tool: 'street-kafka-chaos-verify', version: '1' };

/**
 * The capabilities this driver emits, each bound to the chaos-harness scenario
 * that produces its evidence. `kafka.coldstart` is the cold-start capability;
 * the remaining four are the chaos fault scenarios (Req 9.3/9.5/9.6/9.7).
 */
export const CHAOS_CAPABILITIES = [
  { capabilityId: 'kafka.coldstart', scenario: 'cold-start' },
  { capabilityId: 'kafka.chaos.broker-restart', scenario: 'broker-restart' },
  { capabilityId: 'kafka.chaos.network-interruption', scenario: 'network-interruption' },
  { capabilityId: 'kafka.chaos.connection-loss', scenario: 'connection-loss' },
  { capabilityId: 'kafka.chaos.slow-broker', scenario: 'slow-broker' },
];

/**
 * Build the per-capability Verification Artifacts from a chaos run.
 *
 * Pure and container-free: given the harness's machine-readable `summary`
 * (or null), the executed `command`, the run `outcome` (exitCode / timedOut /
 * durationMs), the declared `params`, and an optional `blockedReason`, it
 * returns one artifact per capability. Status is assigned by the shared
 * `classify()` engine — never by hand — so the precedence
 * NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL is honored (Req 1.2).
 *
 * Each scenario is classified independently using a per-scenario effective exit
 * code (0 when that scenario passed with zero lost messages, else 1), so one
 * failing scenario does not drag a genuinely-passing scenario below VERIFIED.
 *
 * @returns {Array<{ capabilityId: string, artifact: import('streetjs').VerificationArtifact }>}
 */
export function buildChaosArtifacts({ summary, command, outcome, params, blockedReason = null, documentation = true }) {
  const timestamp = new Date().toISOString();
  const timedOut = !!outcome?.timedOut;
  const durationMs = outcome?.durationMs ?? 0;
  const runExit = outcome?.exitCode ?? 0;

  return CHAOS_CAPABILITIES.map(({ capabilityId, scenario }) => {
    const scen = summary?.scenarios?.[scenario] ?? null;
    const ran = !!scen?.ran;
    const scenarioOk = !!scen?.ok;
    const passCount = Number(scen?.pass ?? 0);
    const total = Number(scen?.total ?? 0);
    const lostMessages = Number(scen?.lost ?? 0);
    const produced = Number(scen?.produced ?? 0);
    const deliveredToCommitted = Number(scen?.deliveredToCommitted ?? 0);

    // When BLOCKED, preserve the real command exit; otherwise derive a
    // per-scenario effective exit so each capability is judged on its own run.
    const effectiveExit = blockedReason ? runExit : ran && scenarioOk ? 0 : 1;
    const passingTests = !blockedReason && !timedOut && ran && scenarioOk;

    const evidence = {
      sourceCode: true,
      passingTests,
      documentation,
      artifact: true,
    };

    const status = classify({
      hasSourceCode: true,
      evidence,
      blocked: blockedReason,
      commandExitCode: effectiveExit,
      timedOut,
    });

    const artifact = {
      schemaVersion: 1,
      capabilityId,
      status,
      evidence,
      command,
      exitCode: effectiveExit,
      timestamp,
      durationMs,
      timedOut,
      ...(blockedReason ? { blockedReason } : {}),
      details: {
        scenario,
        parameters: params,
        ran,
        passCount,
        total,
        lostMessages,
        produced,
        deliveredToCommitted,
      },
      generator: GENERATOR,
    };

    return { capabilityId, artifact };
  });
}

/**
 * Run the Kafka cold-start + chaos suite at the requested scale and emit the
 * per-capability artifacts. Returns the artifacts and the overall exit code the
 * CLI should mirror.
 */
export async function verifyKafkaChaos({
  outRoot = 'verification-artifacts',
  coldStarts = Number(process.env.COLD_STARTS ?? FULL_SCALE_COLD_STARTS),
  restartCycles = Number(process.env.RESTART_CYCLES ?? FULL_SCALE_RESTART_CYCLES),
  accountCount = Number(process.env.ACCOUNT_COUNT ?? 50),
  slowBrokerMs = Math.max(SLOW_BROKER_MIN_DELAY_MS, Number(process.env.SLOW_BROKER_MS ?? SLOW_BROKER_MIN_DELAY_MS)),
  brokers = DEFAULT_BROKERS,
  // A full-scale 100/100 infra suite far exceeds the generic 300s default, so a
  // deliberately generous bound is used here (configurable). On overrun the
  // runner records `timedOut` and the artifact is BLOCKED (Req 1.10).
  timeoutMs = Number(process.env.CHAOS_TIMEOUT_MS ?? 4 * 60 * 60 * 1000),
} = {}) {
  const outDir = resolve(outRoot, 'kafka');
  const params = { coldStarts, restartCycles, accountCount, slowBrokerMs, brokers };

  // Honest prerequisite probe up front: when the suite cannot run, do not spawn
  // a doomed broker bring-up — record every capability BLOCKED and skip.
  const blockedReason = await probeKafkaPrerequisites({ brokers });

  const command = `COLD_STARTS=${coldStarts} RESTART_CYCLES=${restartCycles} bash ${CHAOS_SCRIPT}`;

  if (blockedReason) {
    const artifacts = buildChaosArtifacts({
      summary: null,
      command,
      outcome: { exitCode: 0, timedOut: false, durationMs: 0 },
      params,
      blockedReason,
    });
    await writeArtifacts(artifacts, outDir);
    return { artifacts, exitCode: 0, blockedReason };
  }

  // Run the real suite through CommandRunner (atomic write + timeout). The
  // canonical kafka.coldstart artifact it writes is replaced below with the
  // per-scenario breakdown folded from the harness summary.
  const summaryPath = join(tmpdir(), `kafka-chaos-summary-${process.pid}-${randomBytes(4).toString('hex')}.json`);
  const runner = new CommandRunner();
  const { artifact: runArtifact } = await runner.run({
    capabilityId: 'kafka.coldstart',
    command: `bash ${JSON.stringify(CHAOS_SCRIPT)}`,
    cwd: REPO_ROOT,
    env: {
      COLD_STARTS: String(coldStarts),
      RESTART_CYCLES: String(restartCycles),
      ACCOUNT_COUNT: String(accountCount),
      SLOW_BROKER_MS: String(slowBrokerMs),
      KAFKA_BROKERS: brokers,
      CHAOS_SUMMARY_PATH: summaryPath,
    },
    timeoutMs,
    evidenceHints: { documentation: true },
    outDir,
  });

  const summary = readSummary(summaryPath);
  rmSync(summaryPath, { force: true });

  const artifacts = buildChaosArtifacts({
    summary,
    command,
    outcome: {
      exitCode: runArtifact.exitCode,
      timedOut: runArtifact.timedOut,
      durationMs: runArtifact.durationMs,
    },
    params,
    blockedReason: runArtifact.timedOut
      ? { kind: 'timeout', missingPrerequisite: 'timeout' }
      : null,
  });
  await writeArtifacts(artifacts, outDir);

  // Mirror the suite's real exit code so a genuine failure fails the CI step.
  return { artifacts, exitCode: runArtifact.exitCode, blockedReason: null };
}

/** Read and parse the harness summary JSON, or return null when absent/invalid. */
function readSummary(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** Validate then atomically write each capability artifact under `outDir`. */
async function writeArtifacts(artifacts, outDir) {
  for (const { capabilityId, artifact } of artifacts) {
    const check = validateArtifact(artifact);
    if (!check.valid) {
      throw new Error(`built an invalid artifact for '${capabilityId}': ${check.errors.join('; ')}`);
    }
    const path = join(outDir, `${capabilityId}.artifact.json`);
    await CommandRunner.writeArtifactAtomic(path, artifact);
  }
}

async function main() {
  const { artifacts, exitCode, blockedReason } = await verifyKafkaChaos();

  for (const { capabilityId, artifact } of artifacts) {
    const d = artifact.details ?? {};
    let line = `[kafka-chaos-verify] ${capabilityId}: ${artifact.status}`;
    if (artifact.blockedReason) {
      line += ` (blocked: ${artifact.blockedReason.kind}/${artifact.blockedReason.missingPrerequisite})`;
    } else if (d.ran) {
      line += ` (pass ${d.passCount}/${d.total}, lost ${d.lostMessages})`;
    }
    console.log(line);
  }
  console.log(`[kafka-chaos-verify]   artifacts: ${resolve('verification-artifacts', 'kafka')}/`);
  if (blockedReason) {
    console.log(`[kafka-chaos-verify]   BLOCKED — missing prerequisite '${blockedReason.missingPrerequisite}' (honest skip, exit 0)`);
  }

  process.exitCode = exitCode;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`[kafka-chaos-verify] ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
