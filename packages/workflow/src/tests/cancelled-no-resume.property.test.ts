// src/tests/cancelled-no-resume.property.test.ts
// Property 2: Cancelled runs never auto-resume.
// Feature: workflow-engine, Property 2
//
// Validates: Requirements 26.3, 14.3, 14.4
//
// For any Workflow_Run cancelled while parked as `waiting`, neither
// construction-time auto-resume nor an explicit `resume` re-drives the run or
// invokes any Activity: the run's Run_Status stays `cancelled`, no Activity that
// sits after the parking point ever executes, and `resume` rejects with a
// descriptive CancelledResumeError (Req 14.3, 14.4; the cancellation-safety
// property of Req 26.3).
//
// The property generates N runs, parks each as `waiting` (arbitrarily on a
// `ctx.sleep` Timer or on `ctx.events.waitFor`), cancels an arbitrary subset,
// then constructs a BRAND-NEW engine over the SAME MemoryWorkflowStore and
// re-registers the definition — which triggers construction-time auto-resume
// (Req 14.4). Because `listIncomplete` excludes terminal runs and `cancelled` is
// terminal, the cancelled runs must never be re-driven. A per-run Activity
// invocation counter (that must not increase for a cancelled run) proves no
// Activity runs, and an explicit `resume` on each cancelled run must reject with
// CancelledResumeError (Req 14.3).
//
// Everything runs against the zero-dependency MemoryWorkflowStore and a
// deterministic injected fake Clock that never advances, so the parking Timers
// never expire and the test needs no external services and no real time.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { MemoryWorkflowStore } from "../store.js";
import { CancelledResumeError } from "../errors.js";
import type { WorkflowContext, WorkflowFunction } from "../types.js";

/** How a run parks itself as `waiting`. */
type ParkMode = "timer" | "event";

/** Per-run generated spec: how it parks, whether it is cancelled, its Timer delay. */
interface RunSpec {
  readonly mode: ParkMode;
  readonly cancel: boolean;
  readonly duration: number;
}

const DEFINITION = "cancel-park-workflow";

// ── Property 2 ────────────────────────────────────────────────────────────────────

test("Feature: workflow-engine, Property 2 — a cancelled run never auto-resumes, never runs an activity, and rejects an explicit resume", async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(
        fc.record({
          mode: fc.constantFrom<ParkMode>("timer", "event"),
          cancel: fc.boolean(),
          duration: fc.integer({ min: 1, max: 1_000_000 }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
      async (rawSpecs) => {
        // Guarantee the core assertions actually run: at least one run is cancelled.
        const specs: RunSpec[] = rawSpecs.map((spec) => ({ ...spec }));
        if (!specs.some((spec) => spec.cancel)) {
          specs[0] = { ...(specs[0] as RunSpec), cancel: true };
        }

        // A deterministic fake Clock that never advances, so every parking Timer
        // stays in the future and no `waiting` run ever completes on its own.
        const now = 1_000;
        const clock: Clock = () => now;

        // The single durable store shared by both engine instances (the "restart").
        const store = new MemoryWorkflowStore();

        // Per-runId Activity invocation counter. The Activity sits AFTER the
        // parking point, so it must be 0 for any run that never advances past its
        // wait — and must stay 0 for a cancelled run forever (Req 14.3, 14.4).
        const invocations = new Map<string, number>();

        // The workflow parks first (Timer or event), then runs an Activity that
        // records its own invocation keyed by runId. A cancelled run must never
        // reach the Activity.
        const workflow: WorkflowFunction<RunSpec, string> = async (
          ctx: WorkflowContext,
          input: RunSpec,
        ): Promise<string> => {
          if (input.mode === "timer") {
            await ctx.sleep(input.duration);
          } else {
            await ctx.events.waitFor<unknown>(`event-${ctx.metadata.runId}`);
          }
          await ctx.activity(() => {
            const runId = ctx.metadata.runId;
            invocations.set(runId, (invocations.get(runId) ?? 0) + 1);
            return "activity-ran";
          });
          return "completed";
        };

        // ── First engine: start every run and park it as `waiting`. ──────────────
        const engine1 = createWorkflow({ store, clock });
        engine1.define(DEFINITION, workflow);

        const runIds: string[] = specs.map((_, index) => `run-${index}`);
        for (let i = 0; i < specs.length; i += 1) {
          const runId = runIds[i] as string;
          await engine1.run(DEFINITION, specs[i] as RunSpec, { runId });
          // Parked before the Activity: waiting, and no Activity has executed.
          assert.equal(
            await engine1.status(runId),
            "waiting",
            `run ${runId} should be parked as waiting after start`,
          );
          assert.equal(
            invocations.get(runId) ?? 0,
            0,
            `run ${runId} must not have executed its post-park activity while waiting`,
          );
        }

        // Cancel the generated subset; each must report the terminal `cancelled`
        // Run_Status (assertion (a); Req 14.2).
        const cancelledIds = runIds.filter((_, i) => (specs[i] as RunSpec).cancel);
        for (const runId of cancelledIds) {
          await engine1.cancel(runId);
          assert.equal(
            await engine1.status(runId),
            "cancelled",
            `run ${runId} should be cancelled after cancel()`,
          );
          assert.equal(
            invocations.get(runId) ?? 0,
            0,
            `cancelled run ${runId} must not have executed any activity`,
          );
        }
        await engine1.close();

        // Snapshot the (zero) invocation counts of the cancelled runs so we can
        // assert construction-time auto-resume never increases them.
        const beforeResume = new Map<string, number>(
          cancelledIds.map((runId) => [runId, invocations.get(runId) ?? 0]),
        );

        // ── Second engine over the SAME store: re-registering the definition
        // triggers construction-time auto-resume (Req 14.4). ─────────────────────
        const engine2 = createWorkflow({ store, clock });
        engine2.define(DEFINITION, workflow);
        // `list()` settles every scheduled auto-resume drive deterministically.
        await engine2.list();

        // Assertion (b): a cancelled run is NEVER re-driven — its status stays
        // `cancelled` and no post-park Activity executes (counter unchanged).
        for (const runId of cancelledIds) {
          assert.equal(
            await engine2.status(runId),
            "cancelled",
            `cancelled run ${runId} must remain cancelled after auto-resume`,
          );
          assert.equal(
            invocations.get(runId) ?? 0,
            beforeResume.get(runId),
            `auto-resume must not re-drive cancelled run ${runId} (activity counter increased)`,
          );
        }

        // Assertion (c): an explicit `resume` on a cancelled run rejects with a
        // descriptive CancelledResumeError and invokes no Activity (Req 14.3).
        for (const runId of cancelledIds) {
          await assert.rejects(
            engine2.resume(runId),
            (error: unknown) =>
              error instanceof CancelledResumeError && error.runId === runId,
            `resume(${runId}) on a cancelled run should reject with CancelledResumeError`,
          );
          assert.equal(
            invocations.get(runId) ?? 0,
            beforeResume.get(runId),
            `explicit resume must not invoke any activity for cancelled run ${runId}`,
          );
          assert.equal(
            await engine2.status(runId),
            "cancelled",
            `cancelled run ${runId} must remain cancelled after a rejected resume`,
          );
        }
        await engine2.close();
      },
    ),
    { numRuns: 100 },
  );
});
