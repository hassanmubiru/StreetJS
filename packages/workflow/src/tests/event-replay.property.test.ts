// src/tests/event-replay.property.test.ts
// Property 9: Event-replay preserves terminal state and results.
// Feature: workflow-engine, Property 9
//
// Validates: Requirements 26.10, 13.1, 13.3, 20.2, 20.3, 3.2
//
// For any arbitrary DETERMINISTIC Workflow_Run — a sequence of activities that
// each return a value derived purely from the running accumulator, ending with a
// typed output — replaying the run from its persisted History produces the SAME
// terminal Run_Status and the SAME recorded results as the original
// uninterrupted run, WITHOUT re-invoking any Activity that already reached the
// `completed` state:
//
//   1. Replay via a fresh Journal over the persisted snapshot returns each
//      recorded Activity outcome verbatim without running the effect thunk (the
//      invocation counter stays 0), and the reconstructed result sequence equals
//      the results recorded on the first run (Req 20.3, 13.3).
//   2. Resuming the persisted terminal run through a fresh Workflow_Engine over
//      the same store reconstructs the identical terminal Run_Status and typed
//      `output` from recorded state, again invoking no Activity (Req 13.1, 13.2,
//      3.2).
//   3. Running the identical workflow twice from the same input, the same
//      injected (fake) Clock, and Activities returning the same results yields the
//      same ordered History and the same terminal Run_Status (Req 20.2).
//
// Everything runs against the zero-dependency MemoryWorkflowStore and a
// deterministic injectable Clock, so the test needs no external services.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { Journal } from "../journal.js";
import { MemoryWorkflowStore } from "../store.js";
import type { CommandOutcome } from "../journal.js";
import type { WorkflowContext, WorkflowRun } from "../types.js";

// ── Deterministic workflow model ─────────────────────────────────────────────────

/** A single pure step applied to the running accumulator inside one Activity. */
interface Step {
  readonly op: "add" | "mul" | "xor";
  readonly n: number;
}

/** The typed output a completed run of the modeled workflow produces. */
interface WorkflowOutput {
  readonly final: number;
  readonly results: readonly number[];
  readonly count: number;
}

/**
 * Apply one step to the accumulator. All arithmetic is coerced to a 32-bit
 * integer so results are deterministic and structured-clone-safe (no floats).
 */
function applyStep(acc: number, step: Step): number {
  switch (step.op) {
    case "add":
      return (acc + step.n) | 0;
    case "mul":
      return Math.trunc(acc * step.n) | 0;
    case "xor":
      return acc ^ step.n;
    default:
      return acc;
  }
}

/** A mutable invocation counter so a test can assert Activities are (not) run. */
interface Counter {
  count: number;
}

/**
 * Build a deterministic Workflow_Function: a straight-line sequence of
 * activities, each returning a value derived purely from the previous
 * accumulator, ending with a typed {@link WorkflowOutput}. Every Activity
 * invocation bumps `counter` so a caller can prove replay re-invokes nothing.
 */
function makeWorkflow(steps: readonly Step[], counter: Counter) {
  return async (ctx: WorkflowContext, input: { seed: number }): Promise<WorkflowOutput> => {
    let acc = input.seed;
    const results: number[] = [];
    for (const step of steps) {
      const captured = acc;
      acc = await ctx.activity(() => {
        counter.count += 1;
        return applyStep(captured, step);
      });
      results.push(acc);
    }
    return { final: acc, results, count: steps.length };
  };
}

/** The absolute activity results recorded on a persisted run, in `seq` order. */
function recordedActivityResults(run: WorkflowRun): unknown[] {
  return run.commands.filter((command) => command.kind === "activity").map((command) => command.result);
}

// ── Generators ───────────────────────────────────────────────────────────────────

const stepArb: fc.Arbitrary<Step> = fc.record({
  op: fc.constantFrom("add", "mul", "xor"),
  n: fc.integer({ min: -1_000, max: 1_000 }),
});

// 0 steps is a valid edge (immediate completion, no journaled commands).
const stepsArb = fc.array(stepArb, { minLength: 0, maxLength: 8 });
const seedArb = fc.integer({ min: -1_000, max: 1_000 });

// ── Property 9 — replay reconstructs terminal state + results, no re-execution ────

test("Feature: workflow-engine, Property 9 — replaying a persisted run reconstructs the terminal status, output, and recorded results without re-invoking activities", async () => {
  await fc.assert(
    fc.asyncProperty(seedArb, stepsArb, async (seed, steps) => {
      const store = new MemoryWorkflowStore();
      // A fixed injected Clock keeps every timestamp deterministic.
      const clock: Clock = () => 1_000;

      // ── First (uninterrupted) run through the engine. ──
      const firstCounter: Counter = { count: 0 };
      const engine = createWorkflow({ store, clock, autoResume: false });
      engine.define("replay-spec", makeWorkflow(steps, firstCounter));

      const handle = await engine.run<{ seed: number }, WorkflowOutput>("replay-spec", { seed });
      const output = await handle.result();
      const status = await engine.status(handle.runId);

      assert.equal(status, "completed", "the deterministic run must complete");
      assert.equal(
        firstCounter.count,
        steps.length,
        "each activity runs exactly once on the first (live) execution",
      );

      const persisted = await store.load(handle.runId);
      assert.notEqual(persisted, null, "the completed run must be persisted");
      const persistedRun = persisted as WorkflowRun;
      const recorded = recordedActivityResults(persistedRun);
      assert.equal(
        recorded.length,
        steps.length,
        "one activity command is recorded per step",
      );
      // The recorded results are exactly the running accumulator values.
      assert.deepEqual(recorded, output.results);

      // ── (1) Replay via a fresh Journal returns recorded outcomes, no re-run. ──
      const replayCounter: Counter = { count: 0 };
      const replayJournal = new Journal({ run: persistedRun, store, clock });
      const reconstructed: unknown[] = [];
      for (let i = 0; i < steps.length; i += 1) {
        const value = await replayJournal.process<number>({
          kind: "activity",
          execute: (): CommandOutcome => {
            // Reached only if the journal re-executes a completed command — which
            // it must NOT do on replay (Req 20.3, 13.2).
            replayCounter.count += 1;
            return { status: "completed", result: Number.NaN };
          },
        });
        reconstructed.push(value);
      }

      assert.equal(
        replayCounter.count,
        0,
        "replay must NOT re-invoke any completed activity",
      );
      assert.deepEqual(
        reconstructed,
        recorded,
        "replay reconstructs the identical recorded activity results",
      );

      // ── (2) Resume through a fresh engine reconstructs terminal state. ──
      const resumeCounter: Counter = { count: 0 };
      const resumedEngine = createWorkflow({ store, clock, autoResume: false });
      resumedEngine.define("replay-spec", makeWorkflow(steps, resumeCounter));

      const resumedHandle = await resumedEngine.resume(handle.runId);
      const resumedOutput = (await resumedHandle.result()) as WorkflowOutput;
      const resumedStatus = await resumedEngine.status(handle.runId);

      assert.equal(
        resumeCounter.count,
        0,
        "resuming a terminal run reconstructs from recorded state without re-invoking activities",
      );
      assert.equal(resumedStatus, status, "resumed terminal Run_Status is identical");
      assert.deepEqual(resumedOutput, output, "resumed typed output is identical (Req 3.2)");
    }),
    { numRuns: 100 },
  );
});

// ── Property 9 — determinism: same input + clock + results → same History (20.2) ──

test("Feature: workflow-engine, Property 9 — the identical workflow run twice from the same input and Clock yields the same ordered History and terminal Run_Status", async () => {
  await fc.assert(
    fc.asyncProperty(seedArb, stepsArb, async (seed, steps) => {
      // A single shared fixed Clock, so both runs observe identical time.
      const clock: Clock = () => 42_000;

      async function runOnce(runId: string): Promise<{ history: readonly unknown[]; status: string | null; output: WorkflowOutput }> {
        const store = new MemoryWorkflowStore();
        const counter: Counter = { count: 0 };
        const engine = createWorkflow({ store, clock, autoResume: false });
        engine.define("determinism-spec", makeWorkflow(steps, counter));
        const handle = await engine.run<{ seed: number }, WorkflowOutput>(
          "determinism-spec",
          { seed },
          { runId },
        );
        const output = await handle.result();
        const status = await engine.status(handle.runId);
        const persisted = (await store.load(handle.runId)) as WorkflowRun;
        return { history: persisted.history, status, output };
      }

      // Distinct runIds prove History is independent of the identifier; the
      // runId does not appear in any HistoryEvent.
      const first = await runOnce("run-A");
      const second = await runOnce("run-B");

      assert.equal(first.status, "completed");
      assert.equal(second.status, first.status, "terminal Run_Status must match across runs");
      assert.deepEqual(second.output, first.output, "typed output must match across runs");
      assert.deepEqual(
        second.history,
        first.history,
        "the ordered History must be identical for the same input + Clock + activity results",
      );
    }),
    { numRuns: 100 },
  );
});
