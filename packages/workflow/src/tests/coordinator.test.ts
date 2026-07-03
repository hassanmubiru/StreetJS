// Unit tests for the @streetjs/workflow SignalTimerCoordinator covering the two
// "continue-without-waiting" fast paths:
//
//   1. Immediate-continue timers (Req 9.6): a zero/negative sleep and a past
//      `waitUntil` are already expired, so the run continues WITHOUT entering the
//      `waiting` Run_Status. `evaluateSleep(0)`/`evaluateSleep(<0)` and
//      `evaluateWaitUntil(past)` report `expired: true`, and `timerOutcome` for an
//      already-expired timer yields a `completed` CommandOutcome carrying a
//      `timer.fired` History event — never a `waiting` outcome.
//
//   2. Early-signal buffering (Req 17.2): a signal delivered before its matching
//      `waitFor` is buffered into the run's `pendingSignals` (`outcome: "buffered"`)
//      with a `signal.received` History event, and a later `waitFor` consumes it via
//      `tryConsumePending` — returning the buffered payload and marking the signal
//      `consumed` — WITHOUT the run ever entering `waiting`.
//
// Everything runs against the zero-dependency MemoryWorkflowStore and a
// deterministic injectable fake Clock, so the test needs no external services.
//
// Requirements: 9.6, 17.2

import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import { SignalTimerCoordinator } from "../coordinator.js";
import { MemoryWorkflowStore } from "../store.js";
import type { WorkflowRun } from "../types.js";

/**
 * A deterministic, injectable fake Clock whose current time can be advanced by
 * the test. Every timer decision and timestamp in the coordinator flows through
 * this, so behaviour is fully reproducible with no wall-clock dependency.
 */
function fakeClock(start = 1_000): { clock: Clock; set: (t: number) => void; advance: (dt: number) => void } {
  let now = start;
  return {
    clock: () => now,
    set: (t: number) => {
      now = t;
    },
    advance: (dt: number) => {
      now += dt;
    },
  };
}

/**
 * Build a minimal valid `running` WorkflowRun. All fields are JSON-safe /
 * structured-clone-friendly so the MemoryWorkflowStore can persist them.
 */
function makeRun(runId: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const base: WorkflowRun = {
    runId,
    definition: "coordinator-under-test",
    status: "running",
    input: null,
    commands: [],
    nextSeq: 0,
    state: {},
    pendingSignals: [],
    history: [{ type: "run.started", at: 0, input: null }],
    createdAt: 0,
    updatedAt: 0,
  };
  return { ...base, ...overrides };
}

// ── 1. Immediate-continue timers (Req 9.6) ───────────────────────────────────────

test("evaluateSleep(0) is already expired and continues without waiting (Req 9.6)", () => {
  const { clock } = fakeClock(5_000);
  const coordinator = new SignalTimerCoordinator({ store: new MemoryWorkflowStore(), clock });

  const decision = coordinator.evaluateSleep(0);
  assert.equal(decision.expired, true, "a zero-duration sleep must be already expired");
  assert.equal(decision.expiresAt, 5_000, "expiresAt for a zero sleep is now");
});

test("evaluateSleep with a negative duration is already expired (Req 9.6)", () => {
  const { clock } = fakeClock(5_000);
  const coordinator = new SignalTimerCoordinator({ store: new MemoryWorkflowStore(), clock });

  const decision = coordinator.evaluateSleep(-1_000);
  assert.equal(decision.expired, true, "a negative-duration sleep must be already expired");
  assert.equal(decision.expiresAt, 4_000, "expiresAt is now + durationMs even when negative");
});

test("evaluateSleep with a positive duration parks (not expired) (Req 9.6)", () => {
  const { clock } = fakeClock(5_000);
  const coordinator = new SignalTimerCoordinator({ store: new MemoryWorkflowStore(), clock });

  const decision = coordinator.evaluateSleep(1_000);
  assert.equal(decision.expired, false, "a future sleep must not be already expired");
  assert.equal(decision.expiresAt, 6_000, "expiresAt is now + durationMs");
});

test("evaluateWaitUntil with a past absolute time is already expired (Req 9.6)", () => {
  const { clock } = fakeClock(5_000);
  const coordinator = new SignalTimerCoordinator({ store: new MemoryWorkflowStore(), clock });

  const past = coordinator.evaluateWaitUntil(4_000);
  assert.equal(past.expired, true, "a past waitUntil must be already expired");
  assert.equal(past.expiresAt, 4_000, "expiresAt is the requested absolute time");

  // The current instant is also treated as "not later than now" → expired.
  const nowInstant = coordinator.evaluateWaitUntil(5_000);
  assert.equal(nowInstant.expired, true, "a waitUntil equal to now must be already expired");
});

test("evaluateWaitUntil with a future absolute time parks (not expired) (Req 9.6)", () => {
  const { clock } = fakeClock(5_000);
  const coordinator = new SignalTimerCoordinator({ store: new MemoryWorkflowStore(), clock });

  const future = coordinator.evaluateWaitUntil(6_000);
  assert.equal(future.expired, false, "a future waitUntil must not be already expired");
  assert.equal(future.expiresAt, 6_000, "expiresAt is the requested absolute time");
});

test("timerOutcome for an already-expired timer is a completed outcome with a timer.fired event, NOT waiting (Req 9.6)", () => {
  const { clock } = fakeClock(5_000);
  const coordinator = new SignalTimerCoordinator({ store: new MemoryWorkflowStore(), clock });

  const outcome = coordinator.timerOutcome({ seq: 3, now: 5_000, expiresAt: 4_000 });

  assert.equal(outcome.status, "completed", "an expired timer must complete immediately, never wait");
  assert.notEqual(outcome.status, "waiting");
  // A completed outcome carries no waiting bookkeeping.
  assert.equal("runStatus" in outcome ? outcome.runStatus : undefined, undefined);
  if (outcome.status === "completed") {
    assert.equal(outcome.result, undefined, "an expired timer completes with an undefined result");
  }
  assert.deepEqual(
    outcome.history,
    [{ type: "timer.fired", at: 5_000, seq: 3 }],
    "an expired timer records a single timer.fired History event",
  );
});

test("timerOutcome for a future timer is a waiting outcome carrying the absolute expiry (Req 9.6 boundary)", () => {
  const { clock } = fakeClock(5_000);
  const coordinator = new SignalTimerCoordinator({ store: new MemoryWorkflowStore(), clock });

  const outcome = coordinator.timerOutcome({ seq: 7, now: 5_000, expiresAt: 9_000 });

  assert.equal(outcome.status, "waiting", "a future timer must park the run as waiting");
  if (outcome.status === "waiting") {
    assert.equal(outcome.timerExpiresAt, 9_000, "the absolute expiry is preserved on the waiting outcome");
    assert.equal(outcome.runStatus, "waiting", "the run transitions to the waiting Run_Status");
  }
  assert.deepEqual(
    outcome.history,
    [{ type: "timer.set", at: 5_000, seq: 7, expiresAt: 9_000 }],
    "a future timer records a single timer.set History event",
  );
});

// ── 2. Early-signal buffering (Req 17.2) ──────────────────────────────────────────

test("a signal delivered before any waitFor is buffered into pendingSignals (Req 17.2)", async () => {
  const store = new MemoryWorkflowStore();
  const { clock } = fakeClock(2_000);

  let resumeCount = 0;
  const coordinator = new SignalTimerCoordinator({
    store,
    clock,
    onResume: () => {
      resumeCount += 1;
    },
  });

  // A plain `running` run that is NOT waiting for anything yet.
  const run = makeRun("run-early");
  await store.save(run);

  const result = await coordinator.deliverSignal("run-early", "approval", { ok: true });

  assert.equal(result.outcome, "buffered", "an early signal with no active wait must be buffered");
  assert.notEqual(result.outcome, "resumed");
  assert.equal(resumeCount, 0, "buffering an early signal must not resume the run");

  // The signal is persisted, unconsumed, in the durable snapshot.
  const persisted = await store.load("run-early");
  assert.notEqual(persisted, null);
  assert.equal(persisted!.status, "running", "the run must not enter the waiting Run_Status");
  assert.equal(persisted!.pendingSignals.length, 1, "the delivered signal must be buffered");
  const buffered = persisted!.pendingSignals[0]!;
  assert.equal(buffered.name, "approval");
  assert.deepEqual(buffered.payload, { ok: true });
  assert.equal(buffered.consumed, false, "the buffered signal starts unconsumed");
  assert.equal(buffered.receivedAt, 2_000, "the signal records the Clock time it was received");

  // A signal.received History event is appended.
  const received = persisted!.history.filter((event) => event.type === "signal.received");
  assert.equal(received.length, 1, "delivery records exactly one signal.received event");
});

test("a later waitFor consumes a buffered early signal without entering waiting (Req 17.2)", async () => {
  const store = new MemoryWorkflowStore();
  const { clock } = fakeClock(2_000);

  let resumeCount = 0;
  const coordinator = new SignalTimerCoordinator({
    store,
    clock,
    onResume: () => {
      resumeCount += 1;
    },
  });

  const run = makeRun("run-consume");
  await store.save(run);

  // Signal arrives early, before the workflow reaches its waitFor.
  const delivery = await coordinator.deliverSignal("run-consume", "payment", { amount: 42 });
  assert.equal(delivery.outcome, "buffered");

  // Later, the workflow reaches `ctx.events.waitFor("payment")`: it consumes the
  // buffered signal directly instead of parking.
  const loaded = (await store.load("run-consume"))!;
  const consumption = await coordinator.tryConsumePending(loaded, "payment");

  assert.equal(consumption.consumed, true, "the buffered signal must be found and consumed");
  assert.deepEqual(consumption.payload, { amount: 42 }, "consumption returns the buffered payload");
  assert.equal(consumption.run.status, "running", "consuming must NOT enter the waiting Run_Status");
  assert.equal(resumeCount, 0, "consuming a buffered signal never triggers a resume");

  // The signal is now marked consumed in the durable snapshot.
  const persisted = await store.load("run-consume");
  assert.equal(persisted!.pendingSignals.length, 1, "the buffered signal remains recorded");
  assert.equal(persisted!.pendingSignals[0]!.consumed, true, "the signal is marked consumed");
});

test("tryConsumePending reports no match when nothing was buffered for the name (Req 17.2)", async () => {
  const store = new MemoryWorkflowStore();
  const { clock } = fakeClock(2_000);
  const coordinator = new SignalTimerCoordinator({ store, clock });

  const run = makeRun("run-nomatch");
  await store.save(run);

  const consumption = await coordinator.tryConsumePending(run, "never-delivered");
  assert.equal(consumption.consumed, false, "no buffered signal → nothing consumed");
  assert.equal(consumption.payload, undefined, "no payload when nothing is consumed");
  assert.equal(consumption.run.status, "running", "the run is returned unchanged, still running");
});

test("a buffered signal is consumed exactly once by successive waitFor attempts (Req 17.2)", async () => {
  const store = new MemoryWorkflowStore();
  const { clock } = fakeClock(2_000);
  const coordinator = new SignalTimerCoordinator({ store, clock });

  const run = makeRun("run-once");
  await store.save(run);

  await coordinator.deliverSignal("run-once", "kick", { n: 1 });

  const first = await coordinator.tryConsumePending((await store.load("run-once"))!, "kick");
  assert.equal(first.consumed, true, "the first waitFor consumes the buffered signal");

  // A second waitFor for the same name finds no unconsumed signal.
  const second = await coordinator.tryConsumePending((await store.load("run-once"))!, "kick");
  assert.equal(second.consumed, false, "the signal is taken exactly once; a second waitFor finds none");
});
