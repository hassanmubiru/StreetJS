// src/tests/parallel-order.property.test.ts
// Property 8: Parallel execution is deterministically ordered.
// Feature: workflow-engine, Property 8
//
// Validates:
//   - Req 26.9: The property tests SHALL assert that parallel execution produces
//     results in a deterministic order for the same inputs (deterministic-parallel
//     property).
//   - Req 7.2: WHEN every Activity supplied to `ctx.parallel.all` settles
//     successfully, THE Workflow_Engine SHALL return the collected results in the
//     same positional order as the input collection.
//   - Req 7.4: WHEN `ctx.parallel.map` is called with a collection and a mapping
//     Activity, THE Workflow_Engine SHALL apply the mapping Activity to each
//     element and SHALL return the results in the same positional order as the
//     input collection.
//   - Req 7.6: WHEN a Workflow_Run containing a parallel operation is replayed
//     with the same inputs and the same recorded Activity results, THE
//     Workflow_Engine SHALL produce the same ordered results.
//
// For an arbitrary array of N values, a workflow runs both `ctx.parallel.all`
// and `ctx.parallel.map` over activities that each return their own input value.
// Each child activity awaits a *varying* number of microtask ticks before
// resolving so that the order in which the activities SETTLE deliberately
// differs from their positional order in the input (later positions settle
// first). Despite that scrambled settle order, the engine must collect results
// in the SAME positional order as the input collection (Req 7.2 / 7.4).
//
// Replay/run-determinism (Req 7.6): running the identical workflow twice over
// two FRESH MemoryWorkflowStores must yield byte-identical ordered results, so
// the deterministic positional ordering is reproducible for the same inputs.
//
// Everything runs against the zero-dependency default MemoryWorkflowStore and a
// deterministic injectable fake Clock, so the test needs no external services
// and the activity values stay pure/deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import type { Activity, ParallelInput, WorkflowContext } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A deterministic, monotonically increasing fake Clock. Each call returns a
 * strictly larger epoch value so run timestamps are well-ordered without ever
 * touching wall-clock time — the parallel ordering under test never depends on
 * clock values, only on the journal's positional collection.
 */
function makeMonotonicClock(): Clock {
  let now = 0;
  return () => {
    now += 1;
    return now;
  };
}

/** Await `n` microtask ticks, yielding the event loop `n` times. */
async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await Promise.resolve();
  }
}

/**
 * The output shape returned by the workflow under test: the results collected
 * from `ctx.parallel.all` and from `ctx.parallel.map` over the same input.
 */
interface ParallelOutput {
  readonly viaAll: readonly number[];
  readonly viaMap: readonly number[];
}

/**
 * Build a Workflow_Function over an input array of numbers. Each child activity
 * returns its own input value but resolves after a *reversed* number of
 * microtask ticks (position 0 waits the longest, the last position resolves
 * first) so the settle order is the reverse of the positional order. The engine
 * must still return results positionally (Req 7.2 / 7.4).
 */
function makeParallelWorkflow(): (ctx: WorkflowContext, input: readonly number[]) => Promise<ParallelOutput> {
  return async (ctx, input) => {
    const n = input.length;

    // `parallel.all`: one activity per position; later positions settle first.
    const activities: Activity<number>[] = input.map((value, index) => async () => {
      await ticks(n - index); // reversed jitter → scrambled settle order
      return value;
    });
    const viaAll = (await ctx.parallel.all(
      activities as unknown as ParallelInput<number[]>,
    )) as readonly number[];

    // `parallel.map`: mapper returns each element's value with the same reversed
    // settle jitter, exercising the positional-order guarantee of `map`.
    const viaMap = await ctx.parallel.map(input, (item, index) => async () => {
      await ticks(n - index);
      return item;
    });

    return { viaAll, viaMap };
  };
}

/** Run the workflow once over a fresh default store and return its output. */
async function runOnce(input: readonly number[]): Promise<ParallelOutput> {
  // No `store` configured → the default zero-dependency MemoryWorkflowStore.
  const engine = createWorkflow({ clock: makeMonotonicClock() });
  engine.define<readonly number[], ParallelOutput>("parallel-order-spec", makeParallelWorkflow());
  const handle = await engine.run<readonly number[], ParallelOutput>("parallel-order-spec", input);
  const output = await handle.result();
  await engine.close();
  return output;
}

// ── Generators ─────────────────────────────────────────────────────────────────

// An arbitrary array of N distinct-friendly values. Values may repeat; N spans
// the empty collection through a dozen elements. Positional order is what the
// property asserts, so the concrete values only need to be deterministic.
const inputArb = fc.array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
  minLength: 0,
  maxLength: 12,
});

// ── Property 8 ───────────────────────────────────────────────────────────────

test("Feature: workflow-engine, Property 8 — parallel.all/map collect results in input positional order despite scrambled settle order, and are reproducible across fresh runs", async () => {
  await fc.assert(
    fc.asyncProperty(inputArb, async (input) => {
      const expected = [...input];

      // ── Positional ordering (Req 7.2 / 7.4). ──
      const first = await runOnce(input);
      assert.deepEqual(
        [...first.viaAll],
        expected,
        `parallel.all results were not in input positional order: ${JSON.stringify(first.viaAll)}`,
      );
      assert.deepEqual(
        [...first.viaMap],
        expected,
        `parallel.map results were not in input positional order: ${JSON.stringify(first.viaMap)}`,
      );

      // ── Run/replay determinism (Req 7.6). ──
      // The identical workflow over a second FRESH store yields identical
      // ordered results for the same input.
      const second = await runOnce(input);
      assert.deepEqual(
        [...second.viaAll],
        [...first.viaAll],
        "parallel.all ordered results differed across two fresh runs of the same workflow",
      );
      assert.deepEqual(
        [...second.viaMap],
        [...first.viaMap],
        "parallel.map ordered results differed across two fresh runs of the same workflow",
      );
    }),
    { numRuns: 100 },
  );
});
