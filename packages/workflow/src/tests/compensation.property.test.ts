// src/tests/compensation.property.test.ts
// Property 3: Compensation is exactly-once in reverse completion order.
// Feature: workflow-engine, Property 3
//
// Validates: Requirements 26.4, 10.2, 10.3, 10.4
//
// For any Workflow_Run whose commands are a set of `completed` compensable
// activities (each with a distinct completedAt defining a strict completion
// order), when the Compensator runs `compensate()` the property asserts that:
//
//   1. every REGISTERED rollback runs EXACTLY ONCE — no command `seq` is
//      observed twice, and the set of observed seqs equals the set of
//      registered seqs (Req 26.4, 10.2);
//   2. the observed rollback order is the EXACT REVERSE of completion order,
//      i.e. registered activities sorted by `completedAt` descending
//      (Req 10.2 "reverse completion order");
//   3. `completed` activities that declared NO Compensation_Action are SKIPPED
//      while the remaining registered activities still compensate (Req 10.4);
//   4. the run reaches the terminal `compensated` Run_Status (Req 10.3).
//
// The test runs against the zero-dependency `MemoryWorkflowStore` and a
// deterministic fake clock, so it needs no external services. Generators
// produce distinct `completedAt` timestamps (via a unique array) so the
// completion order — and therefore its reverse — is unambiguous, and force at
// least one activity to be compensable so a compensation actually runs.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createCompensator } from "../compensator.js";
import { MemoryWorkflowStore } from "../store.js";
import type { Compensation, CommandRecord, WorkflowRun } from "../types.js";

// ── Model ──────────────────────────────────────────────────────────────────────

/** One generated completed activity: its journaled seq, when it completed, and
 * whether it declared a Compensation_Action to register. */
interface ActivitySpec {
  readonly seq: number;
  readonly completedAt: number;
  readonly hasCompensation: boolean;
}

/**
 * Generate N completed compensable activities with DISTINCT completedAt values
 * (so completion order is a strict total order) and a per-activity flag for
 * whether it declares a compensation. At least one activity is compensable so a
 * compensation run is actually triggered (Req 10.2).
 */
const activitiesArb: fc.Arbitrary<readonly ActivitySpec[]> = fc
  .uniqueArray(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 12 })
  .chain((completedAts) =>
    fc
      .array(fc.boolean(), { minLength: completedAts.length, maxLength: completedAts.length })
      .map((flags) => {
        // Force at least one compensable activity so `compensate()` has a target.
        const hasCompensation = flags.some(Boolean) ? flags : flags.map((_, i) => i === 0);
        return completedAts.map<ActivitySpec>((completedAt, index) => ({
          // Assign seq independently of completedAt ordering so the reverse-order
          // assertion genuinely exercises the completedAt sort, not a seq sort.
          seq: index,
          completedAt,
          hasCompensation: hasCompensation[index] ?? false,
        }));
      }),
  );

/** Build a valid `running` WorkflowRun whose commands are the given completed
 * compensable activities. All fields are JSON-safe / structured-clone-friendly. */
function makeRun(specs: readonly ActivitySpec[]): WorkflowRun {
  const commands: CommandRecord[] = specs.map((spec) => ({
    seq: spec.seq,
    kind: "activity",
    status: "completed",
    attempts: 1,
    result: spec.seq,
    startedAt: spec.completedAt - 1,
    completedAt: spec.completedAt,
  }));

  const maxSeq = specs.reduce((m, s) => Math.max(m, s.seq), -1);

  return {
    runId: "run-compensation",
    definition: "saga-under-test",
    status: "running",
    input: null,
    commands,
    nextSeq: maxSeq + 1,
    state: {},
    pendingSignals: [],
    history: [{ type: "run.started", at: 0, input: null }],
    createdAt: 0,
    updatedAt: 0,
  };
}

// ── Property 3 ───────────────────────────────────────────────────────────────

test("Feature: workflow-engine, Property 3 — compensation runs every registered rollback exactly once, in reverse completion order, skipping non-compensable activities, ending compensated", async () => {
  await fc.assert(
    fc.asyncProperty(activitiesArb, async (specs) => {
      const store = new MemoryWorkflowStore();
      // Deterministic, monotonic fake clock for History timestamps.
      let tick = 1_000;
      const clock: Clock = () => tick++;

      const run = makeRun(specs);
      await store.save(run);

      const compensator = createCompensator({ run, store, clock });

      // Records the seq of each rollback in the exact order it was invoked.
      const observed: number[] = [];
      const registeredSeqs: number[] = [];
      for (const spec of specs) {
        if (!spec.hasCompensation) {
          continue;
        }
        registeredSeqs.push(spec.seq);
        const rollback: Compensation<number> = (output) => {
          // The bound output is the command's recorded result (its seq).
          assert.equal(output, spec.seq, "rollback received the wrong bound output");
          observed.push(spec.seq);
        };
        compensator.register(spec.seq, rollback, spec.seq);
      }

      const finalRun = await compensator.compensate();

      // (1) Exactly-once: no seq observed twice, and the observed set equals the
      //     registered set (every registered rollback ran, nothing extra ran).
      assert.equal(
        new Set(observed).size,
        observed.length,
        `a rollback ran more than once: ${observed.join(",")}`,
      );
      assert.deepEqual(
        [...observed].sort((a, b) => a - b),
        [...registeredSeqs].sort((a, b) => a - b),
        "the set of rolled-back activities did not match the set of registered compensations",
      );

      // (2) Reverse completion order: registered activities sorted by completedAt
      //     descending (completion order is ascending completedAt).
      const expectedOrder = specs
        .filter((s) => s.hasCompensation)
        .slice()
        .sort((a, b) => b.completedAt - a.completedAt)
        .map((s) => s.seq);
      assert.deepEqual(
        observed,
        expectedOrder,
        "rollbacks did not run in reverse completion order",
      );

      // (3) Non-compensable activities were skipped: none of them appears in the
      //     observed rollbacks, yet the remaining registered ones all ran.
      const skipped = specs.filter((s) => !s.hasCompensation).map((s) => s.seq);
      for (const seq of skipped) {
        assert.ok(!observed.includes(seq), `a non-compensable activity (seq ${seq}) was compensated`);
      }

      // (4) The run reached the terminal `compensated` Run_Status.
      assert.equal(finalRun.status, "compensated", "run did not end in the compensated status");
    }),
    { numRuns: 100 },
  );
});
