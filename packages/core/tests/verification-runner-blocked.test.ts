import { afterEach, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import fc from 'fast-check';

import { CommandRunner } from '../src/verification/runner.js';
import type { BlockedReason } from '../src/verification/status.js';

// Layer A — pure decision-logic property test exercising the CommandRunner's
// BLOCKED path. This NEVER raises a capability to VERIFIED in production; it
// only verifies the runner's BLOCKED contract: when a prerequisite probe reports
// a missing prerequisite, OR when the command overruns its timeout, the emitted
// artifact MUST be BLOCKED and MUST preserve the exact missing-prerequisite
// identifier in `blockedReason` (Requirements 1.5, 1.10).

// A valid dotted capability id (matches the artifact schema's id pattern).
const CAPABILITY_ID = 'test.runner.blocked';

// A quick, portable command that exits 0 almost immediately. Using the Node
// executable (with an explicit arg vector ⇒ no shell) keeps this cross-platform.
const QUICK_OK_ARGS = ['-e', 'process.exit(0)'];

// A command that sleeps well past any small injected timeout so the runner must
// terminate it with SIGKILL and record a timeout.
const SLEEP_ARGS = ['-e', 'setTimeout(() => {}, 60_000)'];

// Generator for missing-prerequisite identifiers. Spans a wide range of strings
// — including unicode, whitespace, dotted ids, and punctuation — so the test
// proves the runner preserves the identifier verbatim rather than normalizing
// it. Constrained to non-empty (an empty id is not a meaningful prerequisite).
const prerequisiteIdArb = fc.string({ minLength: 1, maxLength: 64 });

const blockedKindArb = fc.constantFrom<BlockedReason['kind']>(
  'service',
  'credential',
  'runtime',
);

let outDir: string;

describe('Property 2: BLOCKED preserves the missing prerequisite', () => {
  before(async () => {
    outDir = await mkdtemp(join(tmpdir(), 'street-runner-blocked-'));
  });

  afterEach(async () => {
    // Nothing per-test to clean beyond the shared dir; artifacts are overwritten
    // atomically each run under the same capability id.
  });

  // Feature: platform-leadership-gaps, Property 2: BLOCKED preserves the missing prerequisite
  // Validates: Requirements 1.5, 1.10
  it('classifies BLOCKED and preserves the probed missing-prerequisite identifier verbatim (Req 1.5)', async () => {
    const runner = new CommandRunner();
    await fc.assert(
      fc.asyncProperty(
        prerequisiteIdArb,
        blockedKindArb,
        async (missingPrerequisite, kind) => {
          const probedReason: BlockedReason = { missingPrerequisite, kind };
          const { artifact } = await runner.run({
            capabilityId: CAPABILITY_ID,
            command: execPath,
            args: QUICK_OK_ARGS,
            // A prerequisite probe that reports the missing prerequisite.
            prerequisites: [async () => probedReason],
            outDir,
          });

          // The command itself exits 0, but a missing prerequisite must still
          // drive the status to BLOCKED (precedence: BLOCKED over VERIFIED/PARTIAL).
          assert.equal(artifact.status, 'BLOCKED');
          assert.ok(artifact.blockedReason, 'BLOCKED artifact must carry a blockedReason');
          // The exact identifier is preserved verbatim — no trimming, casing, or
          // other normalization.
          assert.equal(
            artifact.blockedReason?.missingPrerequisite,
            missingPrerequisite,
          );
          assert.equal(artifact.blockedReason?.kind, kind);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: platform-leadership-gaps, Property 2: BLOCKED preserves the missing prerequisite
  // Validates: Requirements 1.5, 1.10
  it('the first reported missing prerequisite wins when multiple probes report (Req 1.5)', async () => {
    const runner = new CommandRunner();
    await fc.assert(
      fc.asyncProperty(
        prerequisiteIdArb,
        prerequisiteIdArb,
        blockedKindArb,
        async (firstId, secondId, kind) => {
          const first: BlockedReason = { missingPrerequisite: firstId, kind };
          const second: BlockedReason = { missingPrerequisite: secondId, kind: 'service' };
          const { artifact } = await runner.run({
            capabilityId: CAPABILITY_ID,
            command: execPath,
            args: QUICK_OK_ARGS,
            prerequisites: [async () => first, async () => second],
            outDir,
          });

          assert.equal(artifact.status, 'BLOCKED');
          // The first probe's missing prerequisite is the one preserved.
          assert.equal(artifact.blockedReason?.missingPrerequisite, firstId);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: platform-leadership-gaps, Property 2: BLOCKED preserves the missing prerequisite
  // Validates: Requirements 1.5, 1.10
  it('records a timeout as the missing prerequisite when the command overruns (Req 1.10)', async () => {
    const runner = new CommandRunner();
    await fc.assert(
      fc.asyncProperty(
        // A range of small timeouts so the property holds independent of the
        // exact (short) deadline; all are far below the 60s sleep.
        fc.integer({ min: 20, max: 150 }),
        async (timeoutMs) => {
          const { artifact } = await runner.run({
            capabilityId: CAPABILITY_ID,
            command: execPath,
            args: SLEEP_ARGS,
            timeoutMs,
            outDir,
          });

          // A timeout is the canonical BLOCKED reason (Req 1.10): the run is
          // BLOCKED and the missing prerequisite is recorded as the timeout.
          assert.equal(artifact.status, 'BLOCKED');
          assert.equal(artifact.timedOut, true);
          assert.ok(artifact.blockedReason, 'a timed-out artifact must carry a blockedReason');
          assert.equal(artifact.blockedReason?.kind, 'timeout');
          assert.equal(artifact.blockedReason?.missingPrerequisite, 'timeout');
          // A terminated command must never record a zero exit code (Req 1.9).
          assert.notEqual(artifact.exitCode, 0);
        },
      ),
      { numRuns: 100 },
    );
  });

  // Feature: platform-leadership-gaps, Property 2: BLOCKED preserves the missing prerequisite
  // Validates: Requirements 1.5, 1.10
  it('a timeout takes precedence over a probed prerequisite as the recorded reason (Req 1.10)', async () => {
    const runner = new CommandRunner();
    await fc.assert(
      fc.asyncProperty(
        prerequisiteIdArb,
        blockedKindArb,
        fc.integer({ min: 20, max: 150 }),
        async (missingPrerequisite, kind, timeoutMs) => {
          const probedReason: BlockedReason = { missingPrerequisite, kind };
          const { artifact } = await runner.run({
            capabilityId: CAPABILITY_ID,
            command: execPath,
            args: SLEEP_ARGS,
            timeoutMs,
            prerequisites: [async () => probedReason],
            outDir,
          });

          // When the command times out, the recorded reason is the timeout, not
          // the probed prerequisite (Req 1.10 takes precedence as the reason).
          assert.equal(artifact.status, 'BLOCKED');
          assert.equal(artifact.timedOut, true);
          assert.equal(artifact.blockedReason?.kind, 'timeout');
          assert.equal(artifact.blockedReason?.missingPrerequisite, 'timeout');
        },
      ),
      { numRuns: 100 },
    );
  });

  // Cleanup the temp artifact directory once all properties have run.
  it('cleanup temp artifacts', async () => {
    await rm(outDir, { recursive: true, force: true });
  });
});
