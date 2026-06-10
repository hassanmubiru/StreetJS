import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import {
  classify,
  type ClassifyInput,
  type VerificationStatus,
} from '../src/verification/status.js';

// Layer A — pure decision-logic property test. This NEVER raises a capability
// to VERIFIED in production; it only verifies the classifier's contract.

// A generator that intelligently spans the entire ClassifyInput space:
//  - hasSourceCode (both),
//  - all four evidence flags (independently boolean),
//  - blocked (absent / null / a well-formed BlockedReason),
//  - commandExitCode (zero AND non-zero, both signs),
//  - timedOut (both).
const evidenceArb = fc.record({
  sourceCode: fc.boolean(),
  passingTests: fc.boolean(),
  documentation: fc.boolean(),
  artifact: fc.boolean(),
});

const blockedArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(null),
  fc.record({
    missingPrerequisite: fc.string({ minLength: 1 }),
    kind: fc.constantFrom('service', 'credential', 'runtime', 'timeout'),
  }),
);

// Span zero and non-zero exit codes (and negative codes) so both the VERIFIED
// path (exit 0) and the PARTIAL-on-failure path (non-zero) are exercised.
const exitCodeArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 255 }),
  fc.integer({ min: -255, max: -1 }),
);

const classifyInputArb: fc.Arbitrary<ClassifyInput> = fc.record({
  hasSourceCode: fc.boolean(),
  evidence: evidenceArb,
  blocked: blockedArb,
  commandExitCode: exitCodeArb,
  timedOut: fc.boolean(),
});

// Independent reference implementation of the REQUIRED precedence
// NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL (Req 1.2). Mirrors the spec's
// stated rules without copying the implementation's control flow.
function expectedStatus(input: ClassifyInput): VerificationStatus {
  if (!input.hasSourceCode) return 'NOT_IMPLEMENTED'; // Req 1.6
  if (input.timedOut || input.blocked != null) return 'BLOCKED'; // Req 1.5 / 1.10
  const e = input.evidence;
  const allEvidence = e.sourceCode && e.passingTests && e.documentation && e.artifact;
  if (allEvidence && input.commandExitCode === 0) return 'VERIFIED'; // Req 1.3
  return 'PARTIAL'; // Req 1.4 / 1.9
}

const FOUR_STATUSES: ReadonlySet<VerificationStatus> = new Set([
  'VERIFIED',
  'PARTIAL',
  'BLOCKED',
  'NOT_IMPLEMENTED',
]);

// Feature: platform-leadership-gaps, Property 1: Status classification is deterministic and honors precedence
// Validates: Requirements 1.2, 1.3, 1.4, 1.6, 1.9, 1.10
describe('Property 1: status classification is deterministic and honors precedence', () => {
  it('always returns exactly one of the four statuses (Req 1.1)', () => {
    fc.assert(
      fc.property(classifyInputArb, (input) => {
        assert.ok(FOUR_STATUSES.has(classify(input)));
      }),
      { numRuns: 200 },
    );
  });

  it('is deterministic: the same input yields the same status', () => {
    fc.assert(
      fc.property(classifyInputArb, (input) => {
        // A structurally-identical clone must classify identically.
        const clone: ClassifyInput = {
          hasSourceCode: input.hasSourceCode,
          evidence: { ...input.evidence },
          blocked: input.blocked == null ? input.blocked : { ...input.blocked },
          commandExitCode: input.commandExitCode,
          timedOut: input.timedOut,
        };
        const a = classify(input);
        const b = classify(input);
        const c = classify(clone);
        assert.equal(a, b);
        assert.equal(a, c);
      }),
      { numRuns: 200 },
    );
  });

  it('honors the precedence NOT_IMPLEMENTED → BLOCKED → VERIFIED → PARTIAL (Req 1.2)', () => {
    fc.assert(
      fc.property(classifyInputArb, (input) => {
        assert.equal(classify(input), expectedStatus(input));
      }),
      { numRuns: 200 },
    );
  });

  it('NOT_IMPLEMENTED wins when there is no source code, regardless of all else (Req 1.6)', () => {
    fc.assert(
      fc.property(classifyInputArb, (input) => {
        const noSource: ClassifyInput = { ...input, hasSourceCode: false };
        assert.equal(classify(noSource), 'NOT_IMPLEMENTED');
      }),
      { numRuns: 200 },
    );
  });

  it('BLOCKED wins over VERIFIED/PARTIAL whenever timed out or blocked, given source (Req 1.5/1.10)', () => {
    fc.assert(
      fc.property(
        classifyInputArb,
        fc.boolean(),
        (input, useTimeout) => {
          const blockedInput: ClassifyInput = {
            ...input,
            hasSourceCode: true,
            ...(useTimeout
              ? { timedOut: true }
              : {
                  timedOut: false,
                  blocked: { missingPrerequisite: 'svc', kind: 'service' },
                }),
          };
          assert.equal(classify(blockedInput), 'BLOCKED');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('VERIFIED requires all four evidence components AND a zero exit code (Req 1.3)', () => {
    fc.assert(
      fc.property(classifyInputArb, (input) => {
        const candidate: ClassifyInput = {
          ...input,
          hasSourceCode: true,
          timedOut: false,
          blocked: null,
        };
        const e = candidate.evidence;
        const allEvidence =
          e.sourceCode && e.passingTests && e.documentation && e.artifact;
        if (classify(candidate) === 'VERIFIED') {
          assert.ok(allEvidence, 'VERIFIED implies all four evidence present');
          assert.equal(candidate.commandExitCode, 0, 'VERIFIED implies exit code 0');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('a non-zero exit code never yields VERIFIED; with source/not-blocked it is PARTIAL (Req 1.9)', () => {
    fc.assert(
      fc.property(
        evidenceArb,
        fc.oneof(fc.integer({ min: 1, max: 255 }), fc.integer({ min: -255, max: -1 })),
        (evidence, nonZeroExit) => {
          const input: ClassifyInput = {
            hasSourceCode: true,
            evidence,
            blocked: null,
            commandExitCode: nonZeroExit,
            timedOut: false,
          };
          const status = classify(input);
          assert.notEqual(status, 'VERIFIED');
          assert.equal(status, 'PARTIAL');
        },
      ),
      { numRuns: 200 },
    );
  });

  it('falls back to PARTIAL when there is source, no block, but evidence is incomplete (Req 1.4)', () => {
    fc.assert(
      fc.property(classifyInputArb, (input) => {
        const candidate: ClassifyInput = {
          ...input,
          hasSourceCode: true,
          timedOut: false,
          blocked: null,
          commandExitCode: 0,
        };
        const e = candidate.evidence;
        const allEvidence =
          e.sourceCode && e.passingTests && e.documentation && e.artifact;
        if (!allEvidence) {
          assert.equal(classify(candidate), 'PARTIAL');
        }
      }),
      { numRuns: 200 },
    );
  });
});
