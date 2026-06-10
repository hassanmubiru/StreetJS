import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { CommandRunner } from '../src/verification/runner.js';
import {
  classify,
  type ClassifyInput,
  type VerificationStatus,
} from '../src/verification/status.js';

// Unit tests for task 1.7 — runner process behavior and the status enum.
//
// These are example/edge-case unit tests (node:test), complementing the
// property tests already covering the pure classifier. They assert:
//   (1) exactly the four Verification Statuses are valid membership (Req 1.1)
//   (2) CommandRunner kills a sleeping command at a small injected timeout and
//       records the BLOCKED-with-timeout outcome (Req 1.10, process side).

// ---------------------------------------------------------------------------
// (1) The four-status enum membership (Requirement 1.1)
// ---------------------------------------------------------------------------

describe('Verification status enum membership (Req 1.1)', () => {
  // The authoritative set: exactly four Verification Statuses, no more, no less.
  const FOUR_STATUSES: ReadonlySet<VerificationStatus> = new Set<VerificationStatus>([
    'VERIFIED',
    'PARTIAL',
    'BLOCKED',
    'NOT_IMPLEMENTED',
  ]);

  it('defines exactly four statuses', () => {
    assert.equal(FOUR_STATUSES.size, 4);
  });

  it('each of the four statuses is producible by the classifier, and nothing else is', () => {
    // NOT_IMPLEMENTED — no source code wins over everything (Req 1.6).
    const notImplemented: ClassifyInput = {
      hasSourceCode: false,
      evidence: { sourceCode: false, passingTests: false, documentation: false, artifact: false },
      blocked: null,
      commandExitCode: 0,
      timedOut: false,
    };

    // BLOCKED — a timeout forces BLOCKED (Req 1.10).
    const blocked: ClassifyInput = {
      hasSourceCode: true,
      evidence: { sourceCode: true, passingTests: false, documentation: false, artifact: true },
      blocked: null,
      commandExitCode: 137,
      timedOut: true,
    };

    // VERIFIED — all four evidence components present and a zero exit (Req 1.3).
    const verified: ClassifyInput = {
      hasSourceCode: true,
      evidence: { sourceCode: true, passingTests: true, documentation: true, artifact: true },
      blocked: null,
      commandExitCode: 0,
      timedOut: false,
    };

    // PARTIAL — source present, not blocked, but evidence incomplete (Req 1.4).
    const partial: ClassifyInput = {
      hasSourceCode: true,
      evidence: { sourceCode: true, passingTests: false, documentation: false, artifact: true },
      blocked: null,
      commandExitCode: 0,
      timedOut: false,
    };

    const produced = new Set<VerificationStatus>([
      classify(notImplemented),
      classify(blocked),
      classify(verified),
      classify(partial),
    ]);

    // Each individual mapping is exactly as expected.
    assert.equal(classify(notImplemented), 'NOT_IMPLEMENTED');
    assert.equal(classify(blocked), 'BLOCKED');
    assert.equal(classify(verified), 'VERIFIED');
    assert.equal(classify(partial), 'PARTIAL');

    // The set produced is exactly the four-status membership — no surprises.
    assert.deepEqual([...produced].sort(), [...FOUR_STATUSES].sort());
  });

  it('every classifier output is a member of the four-status set', () => {
    const cases: ClassifyInput[] = [
      {
        hasSourceCode: false,
        evidence: { sourceCode: true, passingTests: true, documentation: true, artifact: true },
        blocked: null,
        commandExitCode: 0,
        timedOut: false,
      },
      {
        hasSourceCode: true,
        evidence: { sourceCode: true, passingTests: true, documentation: true, artifact: true },
        blocked: { missingPrerequisite: 'kafka', kind: 'service' },
        commandExitCode: 0,
        timedOut: false,
      },
      {
        hasSourceCode: true,
        evidence: { sourceCode: true, passingTests: false, documentation: true, artifact: true },
        blocked: null,
        commandExitCode: 2,
        timedOut: false,
      },
    ];
    for (const input of cases) {
      assert.ok(FOUR_STATUSES.has(classify(input)));
    }
  });
});

// ---------------------------------------------------------------------------
// (2) CommandRunner kills a sleeping command at a small injected timeout
//     (Requirement 1.10 — process side)
// ---------------------------------------------------------------------------

describe('CommandRunner timeout kills a sleeping command (Req 1.10)', () => {
  let outDir: string | undefined;

  after(async () => {
    if (outDir) {
      await rm(outDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('terminates `sleep 5` at a small injected timeout and records BLOCKED-with-timeout', async () => {
    outDir = await mkdtemp(join(tmpdir(), 'street-runner-unit-'));

    const SLEEP_SECONDS = 5;
    const TIMEOUT_MS = 300;
    const runner = new CommandRunner();

    const start = Date.now();
    const { artifact, path } = await runner.run({
      capabilityId: 'test.runner.timeout',
      command: 'sleep',
      args: [String(SLEEP_SECONDS)],
      timeoutMs: TIMEOUT_MS,
      outDir,
    });
    const elapsedMs = Date.now() - start;

    // The runner killed the process: it completed WELL under the sleep duration.
    assert.ok(
      elapsedMs < SLEEP_SECONDS * 1000,
      `expected the run to finish before the ${SLEEP_SECONDS}s sleep, took ${elapsedMs}ms`,
    );

    // The process was killed for exceeding the injected timeout (Req 1.10).
    assert.equal(artifact.timedOut, true, 'expected timedOut to be true');
    assert.equal(artifact.status, 'BLOCKED', 'a timeout classifies the capability as BLOCKED');
    assert.ok(artifact.blockedReason, 'a BLOCKED artifact must record a blockedReason');
    assert.equal(artifact.blockedReason?.kind, 'timeout');
    assert.equal(artifact.blockedReason?.missingPrerequisite, 'timeout');

    // A killed command must never record a zero exit code (Req 1.9).
    assert.notEqual(artifact.exitCode, 0);

    // The artifact's recorded duration reflects the timeout, not the full sleep.
    assert.ok(
      artifact.durationMs < SLEEP_SECONDS * 1000,
      `expected durationMs < ${SLEEP_SECONDS * 1000}, got ${artifact.durationMs}`,
    );
    assert.ok(artifact.durationMs >= 0);

    // The artifact was persisted and is the same record returned in memory.
    const persisted = JSON.parse(await readFile(path, 'utf8')) as typeof artifact;
    assert.equal(persisted.capabilityId, 'test.runner.timeout');
    assert.equal(persisted.status, 'BLOCKED');
    assert.equal(persisted.timedOut, true);
    assert.equal(persisted.blockedReason?.kind, 'timeout');
  });
});
