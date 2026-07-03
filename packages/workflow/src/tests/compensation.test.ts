// Unit tests for compensation-failure continuation in the Compensator.
//
// Verifies Requirement 10.5: IF a Compensation_Action itself fails, THEN the
// Workflow_Engine records the compensation failure in the History and continues
// running the remaining Compensation_Actions.
//
// A WorkflowRun is built with multiple completed compensable CommandRecords.
// One registered rollback throws; the others succeed. After `compensate()`:
//   - a `compensation.failed` History event exists for the throwing activity,
//     carrying the serialized error;
//   - the other activities record `compensation.completed` events;
//   - the failing rollback still ran (its command is marked `compensated`);
//   - the remaining compensations ran regardless of failure order; and
//   - the run reaches the terminal `compensated` Run_Status.
//
// Uses the Node.js built-in test runner (node:test) and the zero-dependency
// MemoryWorkflowStore with a deterministic fake clock, so it needs no external
// services. Executed via `node --test dist/tests/*.test.js`.
//
// Requirements: 10.5

import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import { createCompensator } from "../compensator.js";
import { MemoryWorkflowStore } from "../store.js";
import type { CommandRecord, Compensation, HistoryEvent, WorkflowRun } from "../types.js";

/**
 * Build a valid `running` WorkflowRun whose commands are `completed`
 * compensable activities with distinct, strictly increasing `completedAt`
 * timestamps (so completion order — and its reverse — is unambiguous). The
 * recorded `result` of each command is its own `seq`, so a rollback can be
 * bound to that value. All fields are JSON-safe / structured-clone-friendly.
 */
function makeRun(seqs: readonly number[]): WorkflowRun {
  const commands: CommandRecord[] = seqs.map((seq, index) => ({
    seq,
    kind: "activity",
    status: "completed",
    attempts: 1,
    result: seq,
    startedAt: index * 10,
    completedAt: index * 10 + 5,
  }));

  const maxSeq = seqs.reduce((m, s) => Math.max(m, s), -1);

  return {
    runId: "run-compensation-failure",
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

/** A monotonic deterministic clock for stable History timestamps. */
function fakeClock(): Clock {
  let tick = 1_000;
  return () => tick++;
}

/** Collect every History event of a given type from a run. */
function eventsOfType<T extends HistoryEvent["type"]>(
  run: WorkflowRun,
  type: T,
): Extract<HistoryEvent, { type: T }>[] {
  return run.history.filter((e): e is Extract<HistoryEvent, { type: T }> => e.type === type);
}

test("a failing rollback is recorded as compensation.failed and the remaining compensations still run to compensated (Req 10.5)", async () => {
  const store = new MemoryWorkflowStore();
  const clock = fakeClock();

  // Three completed compensable activities. seq 1 (the middle one by completion
  // order) declares a rollback that throws; seq 0 and seq 2 succeed.
  const run = makeRun([0, 1, 2]);
  await store.save(run);

  const compensator = createCompensator({ run, store, clock });

  const observed: number[] = [];
  const failure = new Error("rollback boom");

  const succeed = (seq: number): Compensation<number> => (output) => {
    assert.equal(output, seq, "rollback received the wrong bound output");
    observed.push(seq);
  };
  const throwing: Compensation<number> = (output) => {
    assert.equal(output, 1, "rollback received the wrong bound output");
    observed.push(1);
    throw failure;
  };

  compensator.register(0, succeed(0), 0);
  compensator.register(1, throwing, 1);
  compensator.register(2, succeed(2), 2);

  const finalRun = await compensator.compensate();

  // The failing rollback is recorded as a single `compensation.failed` event
  // for the throwing activity (seq 1), carrying the serialized error.
  const failed = eventsOfType(finalRun, "compensation.failed");
  assert.equal(failed.length, 1, "expected exactly one compensation.failed event");
  assert.equal(failed[0]!.seq, 1, "the failure was recorded against the wrong activity");
  assert.equal(failed[0]!.error.message, "rollback boom");
  assert.equal(failed[0]!.error.name, "Error");

  // The two succeeding rollbacks each recorded a `compensation.completed` event,
  // and the throwing one did NOT.
  const completed = eventsOfType(finalRun, "compensation.completed");
  const completedSeqs = completed.map((e) => e.seq).sort((a, b) => a - b);
  assert.deepEqual(completedSeqs, [0, 2], "the surviving compensations were not both recorded");
  assert.ok(
    !completedSeqs.includes(1),
    "the throwing activity must not record a compensation.completed event",
  );

  // Every registered rollback ran exactly once (including the throwing one),
  // in reverse completion order (seq 2, then 1, then 0).
  assert.deepEqual(observed, [2, 1, 0], "compensations did not all run in reverse completion order");

  // The failing rollback still ran, so its command is marked compensated and is
  // never retried — alongside the successful ones.
  for (const seq of [0, 1, 2]) {
    const command = finalRun.commands.find((c) => c.seq === seq);
    assert.equal(command?.compensated, true, `command seq ${seq} was not marked compensated`);
  }

  // The run reached the terminal `compensated` Run_Status despite the failure.
  assert.equal(finalRun.status, "compensated", "run did not end in the compensated status");

  // The durable snapshot matches the returned run (persisted before completing).
  const persisted = await store.load(run.runId);
  assert.equal(persisted?.status, "compensated");
  assert.equal(eventsOfType(persisted!, "compensation.failed").length, 1);
});

test("a failing rollback in the LAST-run position still lets earlier-completed compensations finish (Req 10.5)", async () => {
  const store = new MemoryWorkflowStore();
  const clock = fakeClock();

  // Two compensable activities; the one that runs LAST in reverse order (seq 0,
  // the earliest completed) throws. The remaining compensation (seq 1) runs
  // first and must complete, and the run must still reach `compensated`.
  const run = makeRun([0, 1]);
  await store.save(run);

  const compensator = createCompensator({ run, store, clock });

  const observed: number[] = [];
  const throwing: Compensation<number> = () => {
    observed.push(0);
    throw new TypeError("late rollback failed");
  };
  const succeed: Compensation<number> = (output) => {
    observed.push(output);
  };

  compensator.register(0, throwing, 0);
  compensator.register(1, succeed, 1);

  const finalRun = await compensator.compensate();

  // Reverse completion order: seq 1 (later) runs first, then seq 0 (which throws).
  assert.deepEqual(observed, [1, 0]);

  const failed = eventsOfType(finalRun, "compensation.failed");
  assert.equal(failed.length, 1);
  assert.equal(failed[0]!.seq, 0);
  assert.equal(failed[0]!.error.name, "TypeError");

  const completed = eventsOfType(finalRun, "compensation.completed");
  assert.deepEqual(completed.map((e) => e.seq), [1]);

  assert.equal(finalRun.status, "compensated");
});
