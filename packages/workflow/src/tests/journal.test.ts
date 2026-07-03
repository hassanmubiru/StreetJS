// Unit tests for the @streetjs/workflow Journal record/replay flow.
//
// Verifies the core journaled, deterministic-replay guarantees of `Journal`:
//   - first-execution record-then-persist ordering (write-before-advance): the
//     effect runs and the run is persisted with its recorded command BEFORE
//     `process()` returns control to the caller (Req 4.3, 20.3)
//   - replay returns recorded outcomes without re-executing the effect: a second
//     Journal constructed over the persisted run returns the recorded result and
//     never re-invokes the effect thunk (Req 4.3, 13.2, 20.3)
//   - monotonic `seq` allocation across multiple journaled commands (Req 20.3)
//
// Uses the Node.js built-in test runner (node:test) and is executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 4.3, 13.2, 20.3

import test from "node:test";
import assert from "node:assert/strict";

import { Journal } from "../journal.js";
import { MemoryWorkflowStore } from "../store.js";
import type { CommandOutcome, JournalExecuteInfo } from "../journal.js";
import type { WorkflowRun, WorkflowStore } from "../types.js";

/**
 * Build a complete, valid initial {@link WorkflowRun} snapshot for testing,
 * allowing targeted overrides. Defaults are JSON-safe / structured-clone-friendly
 * and represent a fresh, running run with an empty journal.
 */
function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const base: WorkflowRun = {
    runId: "run-1",
    definition: "order-processing",
    status: "running",
    input: { orderId: 42 },
    commands: [],
    nextSeq: 0,
    state: {},
    pendingSignals: [],
    history: [{ type: "run.started", at: 0, input: { orderId: 42 } }],
    createdAt: 0,
    updatedAt: 0,
  };
  return { ...base, ...overrides };
}

/**
 * A {@link WorkflowStore} decorator that delegates to a real
 * {@link MemoryWorkflowStore} while appending an entry to a shared `log` on
 * every `save`, so tests can assert the effect-then-persist ordering.
 */
function spyStore(log: string[]): { store: WorkflowStore; saves: WorkflowRun[] } {
  const inner = new MemoryWorkflowStore();
  const saves: WorkflowRun[] = [];
  const store: WorkflowStore = {
    name: inner.name,
    async save(run) {
      log.push("save");
      saves.push(run);
      await inner.save(run);
    },
    load: (runId) => inner.load(runId),
    append: (runId, event) => inner.append(runId, event),
    list: () => inner.list(),
    listIncomplete: () => inner.listIncomplete(),
    probe: () => inner.probe(),
  };
  return { store, saves };
}

test("first execution runs the effect and persists the record BEFORE returning (write-before-advance, Req 4.3/20.3)", async () => {
  const log: string[] = [];
  const { store, saves } = spyStore(log);
  await store.save(makeRun());
  log.length = 0; // ignore the setup save

  let t = 0;
  const clock = () => t;
  const journal = new Journal({ run: makeRun(), store, clock });

  const result = await journal.process<number>({
    kind: "activity",
    metadata: { name: "charge" },
    execute: (info: JournalExecuteInfo): CommandOutcome => {
      log.push("effect");
      t = 5; // advance the clock so settledAt differs from startedAt
      assert.equal(info.seq, 0, "first command is assigned seq 0");
      return { status: "completed", result: 99 };
    },
  });

  assert.equal(result, 99);
  // Ordering: the effect ran, then the run was persisted, all before process() resolved.
  assert.deepEqual(log, ["effect", "save"]);

  // The persisted snapshot carries the recorded command (write happened, not just advance).
  assert.equal(saves.length, 1);
  const persisted = saves[0]!;
  assert.equal(persisted.commands.length, 1);
  assert.deepEqual(
    { seq: persisted.commands[0]!.seq, kind: persisted.commands[0]!.kind, status: persisted.commands[0]!.status },
    { seq: 0, kind: "activity", status: "completed" },
  );
  assert.equal(persisted.commands[0]!.result, 99);

  // And the store durably holds the command before control returned to us.
  const loaded = await store.load("run-1");
  assert.equal(loaded!.commands.length, 1);
  assert.equal(loaded!.commands[0]!.result, 99);
  assert.equal(loaded!.nextSeq, 1);
});

test("replay returns the recorded outcome without re-executing the effect (Req 4.3/13.2/20.3)", async () => {
  const store = new MemoryWorkflowStore();
  await store.save(makeRun());

  let liveInvocations = 0;
  let t = 0;
  const clock = () => t;

  // First drive: execute live and record the outcome.
  const first = new Journal({ run: makeRun(), store, clock });
  const firstResult = await first.process<string>({
    kind: "activity",
    execute: (): CommandOutcome => {
      liveInvocations += 1;
      return { status: "completed", result: "charged" };
    },
  });
  assert.equal(firstResult, "charged");
  assert.equal(liveInvocations, 1);

  // Second drive: a fresh Journal over the persisted run must REPLAY.
  const persistedRun = await store.load("run-1");
  assert.notEqual(persistedRun, null);
  const replay = new Journal({ run: persistedRun!, store, clock });

  let replayInvocations = 0;
  const replayResult = await replay.process<string>({
    kind: "activity",
    execute: (): CommandOutcome => {
      replayInvocations += 1; // must never run on replay
      return { status: "completed", result: "SHOULD-NOT-HAPPEN" };
    },
  });

  // The recorded result is returned verbatim and the effect thunk was not called.
  assert.equal(replayResult, "charged");
  assert.equal(replayInvocations, 0, "the effect thunk must not run on replay");
  assert.equal(liveInvocations, 1, "no additional live execution occurred");
});

test("seq is allocated monotonically across multiple commands (Req 20.3)", async () => {
  const store = new MemoryWorkflowStore();
  await store.save(makeRun());

  let t = 0;
  const clock = () => t;
  const journal = new Journal({ run: makeRun(), store, clock });

  const observedSeqs: number[] = [];
  for (let i = 0; i < 3; i += 1) {
    await journal.process<number>({
      kind: "activity",
      execute: (info: JournalExecuteInfo): CommandOutcome => {
        observedSeqs.push(info.seq);
        t += 1;
        return { status: "completed", result: i };
      },
    });
  }

  // Effects saw strictly increasing seqs starting at 0.
  assert.deepEqual(observedSeqs, [0, 1, 2]);

  // The persisted run reflects the same monotonic sequence and advanced nextSeq.
  const persisted = journal.run;
  assert.deepEqual(persisted.commands.map((c) => c.seq), [0, 1, 2]);
  assert.equal(persisted.nextSeq, 3);
});
