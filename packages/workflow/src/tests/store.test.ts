// Unit tests for the @streetjs/workflow zero-dependency MemoryWorkflowStore.
//
// Verifies the durable-snapshot guarantees of the in-memory store:
//   - `save`/`load` deep-clone round-trip: the persisted snapshot is the single
//     source of truth, so mutating a loaded (or a previously saved) object never
//     bleeds into stored state (Req 11.3)
//   - `list` reports every recorded run's runId/definition/status
//   - `listIncomplete` filters out terminal runs and returns deep clones (Req 13.1)
//   - process-lifetime retention: a fresh store holds nothing (Req 13.5)
//   - persistence-failure state preservation: a snapshot that cannot be
//     structured-cloned rejects `save` with a descriptive `PersistenceError`
//     while leaving the last successfully persisted state unchanged (Req 11.5)
//
// Uses the Node.js built-in test runner (node:test) and is executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 11.3, 11.4, 11.5, 13.5

import test from "node:test";
import assert from "node:assert/strict";

import { MemoryWorkflowStore } from "../store.js";
import { PersistenceError } from "../errors.js";
import type { RunStatus, WorkflowRun } from "../types.js";

/**
 * Build a complete, valid {@link WorkflowRun} snapshot for testing, allowing
 * targeted overrides. Defaults are JSON-safe and structured-clone-friendly.
 */
function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const base: WorkflowRun = {
    runId: "run-1",
    definition: "order-processing",
    status: "running",
    input: { orderId: 42, items: ["a", "b"] },
    commands: [],
    nextSeq: 0,
    state: { step: "start" },
    pendingSignals: [],
    history: [{ type: "run.started", at: 1_000, input: { orderId: 42 } }],
    createdAt: 1_000,
    updatedAt: 1_000,
  };
  return { ...base, ...overrides };
}

test("load returns null for an unknown runId", async () => {
  const store = new MemoryWorkflowStore();
  assert.equal(await store.load("does-not-exist"), null);
});

test("a fresh store retains nothing (process-lifetime retention, Req 13.5)", async () => {
  const store = new MemoryWorkflowStore();
  assert.deepEqual(await store.list(), []);
  assert.deepEqual(await store.listIncomplete(), []);

  // A separate store instance shares no state: memory is per-process/per-store.
  const other = new MemoryWorkflowStore();
  await other.save(makeRun());
  assert.equal(await store.load("run-1"), null);
});

test("save then load round-trips an equal-by-value snapshot (Req 11.3)", async () => {
  const store = new MemoryWorkflowStore();
  const run = makeRun();
  await store.save(run);

  const loaded = await store.load("run-1");
  assert.notEqual(loaded, null);
  assert.deepEqual(loaded, run);
});

test("mutating the object passed to save does not affect stored state (deep clone on write, Req 11.3)", async () => {
  const store = new MemoryWorkflowStore();
  const run = makeRun();
  await store.save(run);

  // Mutate the caller's object after saving.
  (run.state as Record<string, unknown>).step = "MUTATED";
  (run.history as unknown[]).push({ type: "timer.fired", at: 2, seq: 0 });
  (run as { status: RunStatus }).status = "cancelled";

  const loaded = await store.load("run-1");
  assert.equal((loaded!.state as Record<string, unknown>).step, "start");
  assert.equal(loaded!.history.length, 1);
  assert.equal(loaded!.status, "running");
});

test("mutating the object returned from load does not affect stored state (deep clone on read, Req 11.3)", async () => {
  const store = new MemoryWorkflowStore();
  await store.save(makeRun());

  const first = await store.load("run-1");
  (first!.state as Record<string, unknown>).step = "MUTATED";
  (first!.history as unknown[]).length = 0;
  (first! as { nextSeq: number }).nextSeq = 999;

  const second = await store.load("run-1");
  assert.equal((second!.state as Record<string, unknown>).step, "start");
  assert.equal(second!.history.length, 1);
  assert.equal(second!.nextSeq, 0);
});

test("list reports the runId, definition, and status of every recorded run", async () => {
  const store = new MemoryWorkflowStore();
  await store.save(makeRun({ runId: "run-a", definition: "alpha", status: "running" }));
  await store.save(makeRun({ runId: "run-b", definition: "beta", status: "completed" }));

  const summaries = await store.list();
  assert.equal(summaries.length, 2);

  const byId = new Map(summaries.map((s) => [s.runId, s]));
  assert.deepEqual(byId.get("run-a"), {
    runId: "run-a",
    definition: "alpha",
    status: "running",
  });
  assert.deepEqual(byId.get("run-b"), {
    runId: "run-b",
    definition: "beta",
    status: "completed",
  });
});

test("save overwrites the snapshot for an existing runId", async () => {
  const store = new MemoryWorkflowStore();
  await store.save(makeRun({ runId: "run-1", status: "running", nextSeq: 0 }));
  await store.save(makeRun({ runId: "run-1", status: "completed", nextSeq: 5 }));

  const loaded = await store.load("run-1");
  assert.equal(loaded!.status, "completed");
  assert.equal(loaded!.nextSeq, 5);

  const summaries = await store.list();
  assert.equal(summaries.length, 1);
});

test("listIncomplete filters out every terminal run (Req 13.1)", async () => {
  const store = new MemoryWorkflowStore();
  const nonTerminal: RunStatus[] = ["running", "waiting", "paused", "compensating"];
  const terminal: RunStatus[] = ["completed", "failed", "compensated", "cancelled"];

  for (const status of nonTerminal) {
    await store.save(makeRun({ runId: `nt-${status}`, status }));
  }
  for (const status of terminal) {
    await store.save(makeRun({ runId: `t-${status}`, status }));
  }

  const incomplete = await store.listIncomplete();
  const ids = incomplete.map((r) => r.runId).sort();
  assert.deepEqual(
    ids,
    nonTerminal.map((s) => `nt-${s}`).sort(),
  );
  // Terminal runs remain recorded (only excluded from listIncomplete).
  assert.equal((await store.list()).length, nonTerminal.length + terminal.length);
});

test("listIncomplete returns deep clones that cannot mutate stored state", async () => {
  const store = new MemoryWorkflowStore();
  await store.save(makeRun({ runId: "run-1", status: "waiting" }));

  const [incomplete] = await store.listIncomplete();
  (incomplete!.state as Record<string, unknown>).step = "MUTATED";

  const loaded = await store.load("run-1");
  assert.equal((loaded!.state as Record<string, unknown>).step, "start");
});

test("save rejects with a descriptive PersistenceError when the snapshot cannot be cloned, leaving prior state unchanged (Req 11.5)", async () => {
  const store = new MemoryWorkflowStore();

  // Persist a good snapshot first — this is the "last successfully persisted state".
  await store.save(makeRun({ runId: "run-1", status: "running", nextSeq: 1 }));

  // A run whose input carries a function cannot be structured-cloned, so save
  // must reject and must not touch the previously persisted snapshot.
  const uncloneable = makeRun({
    runId: "run-1",
    status: "completed",
    nextSeq: 99,
    input: { work: () => "not cloneable" },
  });

  await assert.rejects(
    () => store.save(uncloneable),
    (err: unknown) => {
      assert.ok(err instanceof PersistenceError, "expected a PersistenceError");
      assert.equal(err.operation, "save");
      assert.equal(err.runId, "run-1");
      assert.match(err.message, /run-1/);
      return true;
    },
  );

  // The last successfully persisted state is preserved, unchanged.
  const loaded = await store.load("run-1");
  assert.equal(loaded!.status, "running");
  assert.equal(loaded!.nextSeq, 1);
});

test("a failed save of a new run leaves the store without that run (Req 11.5)", async () => {
  const store = new MemoryWorkflowStore();

  const uncloneable = makeRun({
    runId: "new-run",
    // A Promise in durable state also defeats structuredClone.
    state: { pending: Promise.resolve("x") },
  });

  await assert.rejects(() => store.save(uncloneable), PersistenceError);

  assert.equal(await store.load("new-run"), null);
  assert.deepEqual(await store.list(), []);
});
