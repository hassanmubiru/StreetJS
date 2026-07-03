// src/tests/regression.test.ts
// Regression suite — PINNED, FIXED reproductions of interruption points and
// failure patterns that must never regress.
//
// Validates: Requirements 27.1 (regression tests), guarding 4.1, 4.3, 13.1,
// 13.2, 14.3, 14.4, 20.3.
//
// Unlike the property suites (which explore the input space), every test here is
// a concrete, deterministic reproduction with EXACT assertions on invocation
// counters and Run_Status. Each pins one historically dangerous scenario across
// an engine "restart" (a fresh engine over the SAME store) so a reintroduced
// double-execution, spurious re-run, or resurrected-cancellation bug is caught:
//
//   1. Interruption frontier — a run parks on `ctx.events.waitFor`; a fresh
//      engine over the same store auto-resumes (replaying the journal) and then
//      an explicit resume after a delivered signal drives it to completion. The
//      pre-park activity must have run EXACTLY ONCE across all of it, and the
//      post-gate activity exactly once (no double-execution at the frontier).
//   2. Completed stays completed — a run completes; a second engine over the same
//      store must NOT re-run its activities (auto-resume skips terminal runs and
//      an explicit resume settles from persisted state), counters unchanged.
//   3. Cancelled stays cancelled — a run cancelled while `waiting` is never
//      resumed by a new engine over the same store; its post-wait activity never
//      runs and an explicit resume rejects with CancelledResumeError.
//
// Everything runs against the zero-dependency MemoryWorkflowStore and a
// deterministic injectable fake Clock, so the suite needs no external services.

import { test } from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { MemoryWorkflowStore } from "../store.js";
import { CancelledResumeError } from "../errors.js";
import type { WorkflowContext, WorkflowFunction } from "../types.js";

/**
 * A fixed, non-advancing fake Clock. A constant time source keeps the
 * reproductions fully deterministic and — crucially for the waiting scenarios —
 * guarantees a parking Timer's absolute expiry always sits in the future, so a
 * `waiting` run only ever advances through an explicit signal/resume, never by
 * wall-clock drift. No dependency on real time.
 */
const CLOCK: Clock = () => 1_000;

// ── 1. Interruption frontier: a completed activity is not double-executed ─────────

test("Regression: a run that parks on ctx.events.waitFor is auto-resumed by a fresh engine and completed after a signal WITHOUT re-executing the pre-park activity (Req 4.1, 4.3, 13.2, 20.3)", async () => {
  const store = new MemoryWorkflowStore();
  const runId = "regression-signal-gate";

  // Counters live OUTSIDE the Workflow_Function, so every real invocation of an
  // activity body is observable no matter how many engines drive/replay the run.
  const counters = { preGate: 0, postGate: 0 };

  const workflow: WorkflowFunction<null, string> = async (ctx: WorkflowContext): Promise<string> => {
    // Pre-park activity: sits BEFORE the wait, so it is `completed` and journaled
    // before the run ever parks. It must never run a second time on replay.
    const before = await ctx.activity(() => {
      counters.preGate += 1;
      return "A";
    });
    // The interruption frontier: the run parks as `waiting` on the named event.
    const payload = await ctx.events.waitFor<string>("go");
    // Post-gate activity: runs exactly once, only after the wait is satisfied.
    const after = await ctx.activity(() => {
      counters.postGate += 1;
      return "B";
    });
    return `${before}:${payload}:${after}`;
  };

  // ── First engine: start the run; it drives the pre-gate activity then parks. ──
  const engine1 = createWorkflow({ store, clock: CLOCK });
  engine1.define("signal-gate", workflow);
  await engine1.run<null, string>("signal-gate", null, { runId });

  assert.equal(await engine1.status(runId), "waiting", "the run must park as waiting on ctx.events.waitFor");
  assert.equal(counters.preGate, 1, "the pre-gate activity must have run exactly once before parking");
  assert.equal(counters.postGate, 0, "the post-gate activity must not run while the run is parked");
  await engine1.close();

  // ── Second (fresh) engine over the SAME store: registering the definition
  // triggers construction-time auto-resume, which replays the journal (reusing
  // the recorded pre-gate result) and re-parks on the wait. `list()` settles the
  // scheduled auto-resume drive deterministically. ─────────────────────────────
  const engine2 = createWorkflow({ store, clock: CLOCK });
  engine2.define("signal-gate", workflow);
  await engine2.list();

  assert.equal(await engine2.status(runId), "waiting", "auto-resume must leave the run parked as waiting");
  assert.equal(
    counters.preGate,
    1,
    "auto-resume must REPLAY the completed pre-gate activity, never re-invoke it (no double-execution at the frontier)",
  );
  assert.equal(counters.postGate, 0, "auto-resume must not run the post-gate activity while still parked");

  // Deliver the awaited signal; the coordinator resumes the run, which replays
  // the pre-gate activity (still no re-invocation), consumes the buffered signal
  // payload, runs the post-gate activity once, and completes.
  await engine2.signal(runId, "go", "PAYLOAD");

  // An explicit resume of the now-terminal run hands back a handle that settles
  // from persisted state without re-driving, exposing the recorded output.
  const resumed = await engine2.resume(runId);
  const result = await resumed.result();

  assert.equal(result, "A:PAYLOAD:B", "the completed run must return each recorded/awaited value in order");
  assert.equal(await engine2.status(runId), "completed", "the run must reach the completed terminal status");
  assert.equal(
    counters.preGate,
    1,
    "the pre-gate activity must have been invoked EXACTLY ONCE across start, auto-resume, signal, and explicit resume",
  );
  assert.equal(counters.postGate, 1, "the post-gate activity must have been invoked exactly once after the signal");
  await engine2.close();
});

// ── 2. A completed run stays completed and never re-runs its activities ───────────

test("Regression: a second engine over the same store does NOT re-run a completed run's activities; the run stays completed with unchanged counters (Req 13.2, 20.3)", async () => {
  const store = new MemoryWorkflowStore();
  const runId = "regression-completed-stays-completed";

  const counters = { first: 0, second: 0 };

  const workflow: WorkflowFunction<{ base: number }, number> = async (
    ctx: WorkflowContext,
    input: { base: number },
  ): Promise<number> => {
    const x = await ctx.activity(() => {
      counters.first += 1;
      return input.base + 1;
    });
    const y = await ctx.activity(() => {
      counters.second += 1;
      return x + 1;
    });
    return y;
  };

  // ── First engine: drive the run to completion. ────────────────────────────────
  const engine1 = createWorkflow({ store, clock: CLOCK });
  engine1.define("counter-run", workflow);
  const handle = await engine1.run<{ base: number }, number>("counter-run", { base: 40 }, { runId });

  assert.equal(await handle.result(), 42, "the run must complete with base + 2");
  assert.equal(await handle.status(), "completed", "the run must reach the completed terminal status");
  assert.equal(counters.first, 1, "the first activity must have run exactly once");
  assert.equal(counters.second, 1, "the second activity must have run exactly once");
  await engine1.close();

  // ── Second engine over the SAME store: auto-resume scans listIncomplete(),
  // which excludes the terminal `completed` run, so it is never re-driven. ──────
  const engine2 = createWorkflow({ store, clock: CLOCK });
  engine2.define("counter-run", workflow);
  await engine2.list();

  assert.equal(await engine2.status(runId), "completed", "auto-resume must leave the completed run completed");
  assert.equal(counters.first, 1, "auto-resume must not re-run the first activity of a completed run");
  assert.equal(counters.second, 1, "auto-resume must not re-run the second activity of a completed run");

  const persisted = await store.load(runId);
  assert.notEqual(persisted, null, "the completed run must remain persisted in the shared store");
  assert.equal(persisted?.status, "completed", "the persisted run must remain completed");

  // ── Explicit resume of the terminal run settles from persisted state without
  // re-driving, reproducing the same output and touching no activity body. ─────
  const resumed = await engine2.resume(runId);
  assert.equal(await resumed.result(), 42, "explicit resume of a completed run must reproduce the recorded output");
  assert.equal(counters.first, 1, "explicit resume must not re-run the first activity");
  assert.equal(counters.second, 1, "explicit resume must not re-run the second activity");
  await engine2.close();
});

// ── 3. A cancelled waiting run is never resumed by a new engine ───────────────────

test("Regression: a run cancelled while waiting is never resumed by a fresh engine over the same store; its post-wait activity never runs and an explicit resume rejects (Req 14.3, 14.4)", async () => {
  const store = new MemoryWorkflowStore();
  const runId = "regression-cancelled-stays-cancelled";

  // Increments only if the run ever advances PAST its wait — which a cancelled
  // run must never do. It must stay 0 forever.
  const counters = { postWait: 0 };

  const workflow: WorkflowFunction<null, string> = async (ctx: WorkflowContext): Promise<string> => {
    // Parks as `waiting`; the fixed Clock never advances, so the timer never
    // expires and the run only leaves `waiting` via an explicit resume — which
    // cancellation must forbid.
    await ctx.sleep(60_000);
    await ctx.activity(() => {
      counters.postWait += 1;
      return "ran";
    });
    return "done";
  };

  // ── First engine: start the run (parks waiting), then cancel it. ──────────────
  const engine1 = createWorkflow({ store, clock: CLOCK });
  engine1.define("sleep-gate", workflow);
  await engine1.run<null, string>("sleep-gate", null, { runId });

  assert.equal(await engine1.status(runId), "waiting", "the run must park as waiting on ctx.sleep");
  assert.equal(counters.postWait, 0, "the post-wait activity must not run while the run is parked");

  await engine1.cancel(runId);
  assert.equal(await engine1.status(runId), "cancelled", "cancel() must move the run to the cancelled terminal status");
  assert.equal(counters.postWait, 0, "cancellation must not run the post-wait activity");
  await engine1.close();

  // ── Second engine over the SAME store: construction-time auto-resume must
  // skip the cancelled (terminal) run entirely. ────────────────────────────────
  const engine2 = createWorkflow({ store, clock: CLOCK });
  engine2.define("sleep-gate", workflow);
  await engine2.list();

  assert.equal(await engine2.status(runId), "cancelled", "auto-resume must leave the cancelled run cancelled");
  assert.equal(counters.postWait, 0, "auto-resume must never re-drive a cancelled run's post-wait activity");

  const persisted = await store.load(runId);
  assert.notEqual(persisted, null, "the cancelled run must remain persisted in the shared store");
  assert.equal(persisted?.status, "cancelled", "the persisted run must remain cancelled");

  // ── An explicit resume of a cancelled run rejects with a descriptive
  // CancelledResumeError and runs no activity. ─────────────────────────────────
  await assert.rejects(
    engine2.resume(runId),
    (error: unknown) => error instanceof CancelledResumeError && error.runId === runId,
    "resume() of a cancelled run must reject with CancelledResumeError",
  );
  assert.equal(counters.postWait, 0, "a rejected resume must not run the post-wait activity");
  assert.equal(await engine2.status(runId), "cancelled", "the run must remain cancelled after a rejected resume");
  await engine2.close();
});
