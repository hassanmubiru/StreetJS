// src/tests/no-double-execution.property.test.ts
// Property 1: No double-execution of completed activities.
// Feature: workflow-engine, Property 1
//
// Validates: Requirements 26.2, 4.1, 4.3, 13.2, 20.3
//
// For any registered Workflow_Function of N activities, once an Activity has
// reached the `completed` state its underlying function is invoked EXACTLY ONCE
// across every subsequent resume/replay — never twice (Req 4.1, 4.3, 13.2). We
// prove this end-to-end through the public `createWorkflow` facade:
//
//   1. Drive a workflow of N activities to completion against a shared
//      MemoryWorkflowStore. Each activity increments a per-index invocation
//      counter that lives OUTSIDE the Workflow_Function, so any re-invocation on
//      a later replay is observable. After completion every counter must be 1.
//   2. Construct a SECOND engine over the SAME store and register the SAME
//      definition. Registration triggers construction-time auto-resume, which
//      scans `listIncomplete()` — a `completed` run is terminal and therefore
//      never returned, so it is never re-driven (Req 13.2). The counters must
//      stay exactly 1 and the persisted run must stay `completed`.
//   3. Construct a THIRD engine over the same store and call `resume(runId)`
//      explicitly. A terminal (non-cancelled) run settles from its persisted
//      state WITHOUT re-driving, so `result()` reproduces the same output and no
//      activity is re-invoked (Req 20.3 deterministic replay).
//
// Everything runs against the zero-dependency MemoryWorkflowStore and a
// deterministic injected fake Clock, so the test needs no external services.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { MemoryWorkflowStore } from "../store.js";
import type { WorkflowContext, WorkflowFunction } from "../types.js";

/**
 * A deterministic, strictly-monotonic fake Clock. The workflow engine reads the
 * Clock for `createdAt`/`updatedAt` and History timestamps; a monotonic source
 * keeps every recorded time distinct and the run fully deterministic across
 * replays (Req 20.3), with no dependency on wall-clock time.
 */
function makeFakeClock(start = 1_000): Clock {
  let now = start;
  return () => (now += 1);
}

/** Input shape for the counting workflow under test. */
interface CountingInput {
  readonly n: number;
  readonly base: number;
}

/**
 * Build the counting Workflow_Function bound to a shared `invocations` array.
 * The array is captured by closure and lives OUTSIDE the run, so every real
 * invocation of an activity body is observable from the test regardless of how
 * many engines drive/replay the run. On replay the Journal reuses each
 * `completed` command's recorded result and never calls the body again, so a
 * correctly-behaving engine leaves each counter at exactly 1.
 */
function makeCountingWorkflow(invocations: number[]): WorkflowFunction<CountingInput, number[]> {
  return async (ctx: WorkflowContext, input: CountingInput): Promise<number[]> => {
    const results: number[] = [];
    for (let i = 0; i < input.n; i += 1) {
      // Each activity increments its own per-index counter and returns a
      // deterministic value so replay is stable (Req 20.3).
      const value = await ctx.activity(() => {
        invocations[i] = (invocations[i] ?? 0) + 1;
        return input.base + i;
      });
      results.push(value);
    }
    return results;
  };
}

// ── Property 1 — completed activities are invoked exactly once across resumes ──────

test("Feature: workflow-engine, Property 1 — a completed activity's function is invoked exactly once across completion, auto-resume, and explicit resume", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 8 }), // N activities in the workflow
      fc.integer({ min: -1_000, max: 1_000 }), // base value each activity derives its result from
      async (n, base) => {
        const store = new MemoryWorkflowStore();
        const invocations: number[] = new Array<number>(n).fill(0);
        const fn = makeCountingWorkflow(invocations);
        const name = "counting-under-test";
        const runId = "run-under-test";
        const expected = Array.from({ length: n }, (_v, i) => base + i);

        // ── 1. Drive to completion on the first engine ─────────────────────────
        const engine1 = createWorkflow({ store, clock: makeFakeClock() });
        engine1.define(name, fn);
        const handle = await engine1.run<CountingInput, number[]>(name, { n, base }, { runId });
        const result = await handle.result();
        await engine1.close();

        assert.deepEqual(result, expected, "the completed run must return each activity's recorded result");
        assert.equal(await handle.status(), "completed", "the run must reach the completed terminal status");
        assert.ok(
          invocations.every((c) => c === 1),
          `after completion every activity must have been invoked exactly once; saw [${invocations.join(", ")}]`,
        );

        // ── 2. Fresh engine over the SAME store: auto-resume must not re-invoke ──
        // Registering the definition triggers construction-time auto-resume, which
        // scans listIncomplete(); a completed run is terminal and never returned,
        // so no activity is re-driven (Req 13.2). close() settles any scheduled
        // resume work deterministically.
        const engine2 = createWorkflow({ store, clock: makeFakeClock() });
        engine2.define(name, fn);
        await engine2.close();

        const persisted = await store.load(runId);
        assert.notEqual(persisted, null, "the run must remain persisted in the shared store");
        assert.equal(persisted?.status, "completed", "auto-resume must leave a completed run completed");
        assert.ok(
          invocations.every((c) => c === 1),
          `auto-resume over the same store must not re-invoke any completed activity; saw [${invocations.join(", ")}]`,
        );

        // ── 3. Explicit resume of the terminal run: still exactly once ──────────
        // A terminal (non-cancelled) run settles from its persisted state without
        // re-driving, so result() reproduces the same output and no activity body
        // runs again (Req 4.1, 4.3, 20.3).
        const engine3 = createWorkflow({ store, clock: makeFakeClock() });
        engine3.define(name, fn);
        const resumedHandle = await engine3.resume(runId);
        const resumedResult = await resumedHandle.result();
        await engine3.close();

        assert.deepEqual(
          resumedResult,
          expected,
          "explicit resume of a completed run must reproduce the same recorded results",
        );
        assert.ok(
          invocations.every((c) => c === 1),
          `explicit resume must not re-invoke any completed activity; saw [${invocations.join(", ")}]`,
        );
      },
    ),
    { numRuns: 100 },
  );
});
