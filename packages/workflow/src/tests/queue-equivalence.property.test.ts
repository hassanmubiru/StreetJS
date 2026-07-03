// src/tests/queue-equivalence.property.test.ts
// Property 11: Queue-backed and direct activities are observationally equivalent.
// Feature: workflow-engine, Property 11
//
// Validates: Requirements 26.12, 16.2, 16.5
//
// For any deterministic Activity that produces a recorded result, executing it
// through the Queue_Bridge (an activity configured `viaQueue: true` against a
// wired `QueueLike` whose `execute` runs the activity) and executing it directly
// (no queue bridge / `viaQueue: false`) produce EQUIVALENT observable results and
// the same terminal Run_Status (Req 16.2, 16.5).
//
// We prove this end-to-end through the public `createWorkflow` facade. The SAME
// registered Workflow_Function of N deterministic activities is driven twice from
// the SAME input against fresh MemoryWorkflowStores and a deterministic injected
// Clock:
//
//   1. DIRECT run — no `bridges.queue` is configured and every activity uses
//      `viaQueue: false`, so each activity runs directly (Req 16.4).
//   2. QUEUE-BACKED run — a `bridges.queue` is wired to an in-process QueueLike
//      fake whose `execute(fn)` runs `fn` with an AbortSignal and returns its
//      result, and every activity uses `viaQueue: true`, so each activity is
//      routed through the Queue_Bridge (Req 16.2).
//
// The two runs must agree on the resolved workflow output, the terminal
// Run_Status, and the ordered recorded Activity results in the journal — i.e. the
// two execution paths are observationally equivalent (Req 16.5). Everything runs
// against the zero-dependency MemoryWorkflowStore and a deterministic fake Clock,
// so the test needs no external services.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { MemoryWorkflowStore } from "../store.js";
import type {
  QueueLike,
  WorkflowContext,
  WorkflowFunction,
  WorkflowRun,
} from "../types.js";

/**
 * A deterministic, strictly-monotonic fake Clock. Using a monotonic source for
 * both runs keeps each run fully deterministic without any dependency on
 * wall-clock time; the terminal status and recorded results — the observable
 * quantities this property compares — do not depend on the absolute timestamps.
 */
function makeFakeClock(start = 1_000): Clock {
  let now = start;
  return () => (now += 1);
}

/**
 * An in-process {@link QueueLike} fake. `dispatch` returns a deterministic jobId
 * (unused by this property, but part of the structural contract), and `execute`
 * runs the supplied activity thunk with a real {@link AbortSignal} and returns
 * its result — exactly how `@streetjs/queue` would run a `viaQueue` activity
 * (Req 16.2). It records how many activities it executed so the test can assert
 * the queue path was actually exercised.
 */
function makeQueueFake(): QueueLike & { readonly executed: () => number } {
  let jobs = 0;
  let executed = 0;
  return {
    async dispatch(_job: string, _payload: unknown): Promise<string> {
      jobs += 1;
      return `job-${jobs}`;
    },
    async execute<Out>(activity: (signal: AbortSignal) => Promise<Out>): Promise<Out> {
      executed += 1;
      const controller = new AbortController();
      return activity(controller.signal);
    },
    executed: () => executed,
  };
}

/** Input shape for the deterministic workflow under test. */
interface DerivedInput {
  readonly n: number;
  readonly base: number;
  readonly factor: number;
  /** Whether each activity opts into queue execution for this run. */
  readonly viaQueue: boolean;
}

/**
 * A workflow of N deterministic activities. Each activity derives its result
 * purely from the input (`base + i * factor`), so the recorded result depends
 * only on the input and not on which execution path (direct vs queue) ran it —
 * which is precisely what makes the two runs comparable. The workflow output is
 * the ordered tuple of per-activity results.
 *
 * Each activity is issued with `{ viaQueue: input.viaQueue }`; the Executor routes
 * it through the wired Queue_Bridge when `viaQueue` is true and the bridge
 * supports `execute`, and otherwise runs it directly (Req 16.2, 16.4).
 */
function makeDerivedWorkflow(): WorkflowFunction<DerivedInput, number[]> {
  return async (ctx: WorkflowContext, input: DerivedInput): Promise<number[]> => {
    const results: number[] = [];
    for (let i = 0; i < input.n; i += 1) {
      const value = await ctx.activity(() => input.base + i * input.factor, {
        viaQueue: input.viaQueue,
      });
      results.push(value);
    }
    return results;
  };
}

/**
 * Project the observable outcome of a persisted run: the terminal Run_Status and
 * the ordered recorded results of every `activity` command in the journal. Two
 * runs are observationally equivalent iff these projections are deep-equal.
 */
function project(run: WorkflowRun | null): { status: string | null; activityResults: unknown[] } {
  if (run === null) {
    return { status: null, activityResults: [] };
  }
  const activityResults = run.commands
    .filter((c) => c.kind === "activity")
    .map((c) => c.result);
  return { status: run.status, activityResults };
}

// ── Property 11 — queue-backed and direct activities are equivalent ────────────────

test("Feature: workflow-engine, Property 11 — an activity produces observationally equivalent results whether it runs directly or through the Queue_Bridge", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.integer({ min: 1, max: 8 }), // N activities in the workflow
      fc.integer({ min: -1_000, max: 1_000 }), // base value each activity derives from
      fc.integer({ min: -50, max: 50 }), // per-index derivation factor
      async (n, base, factor) => {
        const fn = makeDerivedWorkflow();
        const name = "derived-under-test";
        const expected = Array.from({ length: n }, (_v, i) => base + i * factor);

        // ── DIRECT run: no queue bridge, viaQueue:false ────────────────────────
        const directStore = new MemoryWorkflowStore();
        const directEngine = createWorkflow({ store: directStore, clock: makeFakeClock() });
        directEngine.define(name, fn);
        const directHandle = await directEngine.run<DerivedInput, number[]>(
          name,
          { n, base, factor, viaQueue: false },
          { runId: "direct-run" },
        );
        const directResult = await directHandle.result();
        const directStatus = await directHandle.status();
        const directRun = await directStore.load("direct-run");
        await directEngine.close();

        // ── QUEUE-BACKED run: wired QueueLike, viaQueue:true ───────────────────
        const queueFake = makeQueueFake();
        const queueStore = new MemoryWorkflowStore();
        const queueEngine = createWorkflow({
          store: queueStore,
          clock: makeFakeClock(),
          bridges: { queue: queueFake },
        });
        queueEngine.define(name, fn);
        const queueHandle = await queueEngine.run<DerivedInput, number[]>(
          name,
          { n, base, factor, viaQueue: true },
          { runId: "queue-run" },
        );
        const queueResult = await queueHandle.result();
        const queueStatus = await queueHandle.status();
        const queueRun = await queueStore.load("queue-run");
        await queueEngine.close();

        // ── Observational equivalence ──────────────────────────────────────────
        // The workflow output resolves identically on both paths and matches the
        // input-derived expectation.
        assert.deepEqual(directResult, expected, "the direct run must return each activity's derived result");
        assert.deepEqual(
          queueResult,
          directResult,
          "the queue-backed run must resolve the same workflow output as the direct run",
        );

        // Both runs reach the same terminal Run_Status.
        assert.equal(directStatus, "completed", "the direct run must reach the completed terminal status");
        assert.equal(
          queueStatus,
          directStatus,
          "the queue-backed run must reach the same terminal Run_Status as the direct run",
        );

        // The ordered recorded Activity results in the journal agree, so the two
        // execution paths are observationally equivalent (Req 16.5).
        assert.deepEqual(
          project(queueRun),
          project(directRun),
          "the recorded terminal status and Activity results must be identical across execution paths",
        );

        // Sanity: the queue path was actually exercised — every activity was
        // routed through the bridge's `execute` (Req 16.2), confirming this was a
        // genuine queue-backed run rather than an accidental direct fallback.
        assert.equal(
          queueFake.executed(),
          n,
          "every viaQueue activity must have been executed through the Queue_Bridge",
        );
      },
    ),
    { numRuns: 100 },
  );
});
