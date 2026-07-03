// Unit tests for the @streetjs/workflow/redis RedisWorkflowStore, exercised
// against a fully in-process RedisLike fake (no Redis server required).
//
// These tests pin the behaviour that makes RedisWorkflowStore substitutable for
// MemoryWorkflowStore (Requirements 12.2, 12.5):
//   - save/load round-trip through the JSON snapshot, including a Uint8Array
//     activity result surviving the tagged base64 (`__u8b64__`) encoding
//   - index-set + non-terminal-set maintenance: saving a terminal run removes it
//     from the incomplete set, saving a non-terminal run keeps it there
//   - `list` reports every recorded run; `listIncomplete` returns only
//     non-terminal runs
//   - `append` adds an ordered History event to the persisted run
//   - WorkflowStore conformance: the same suite of operations that the memory
//     store satisfies produces the same observable results here, so the store is
//     drop-in substitutable
//
// Uses the Node.js built-in test runner (node:test) and is executed via
// `node --test dist/tests/*.test.js`.
//
// Requirements: 12.2, 12.5

import test from "node:test";
import assert from "node:assert/strict";

import { RedisWorkflowStore } from "../redis/index.js";
import type { RedisLike } from "../redis/index.js";
import { MemoryWorkflowStore } from "../store.js";
import { PersistenceError } from "../errors.js";
import type { RunStatus, WorkflowRun, WorkflowStore } from "../types.js";

/**
 * A minimal, fully in-process {@link RedisLike} fake. String values live in a
 * `Map<string, string>` and sets live in a `Map<string, Set<string>>`, exactly
 * matching the two data structures the store relies on. No network, no server.
 */
class FakeRedis implements RedisLike {
  readonly strings = new Map<string, string>();
  readonly sets = new Map<string, Set<string>>();

  async get(key: string): Promise<string | null> {
    return this.strings.has(key) ? this.strings.get(key)! : null;
  }

  async set(key: string, value: string): Promise<unknown> {
    this.strings.set(key, value);
    return "OK";
  }

  async del(key: string): Promise<unknown> {
    const had = this.strings.delete(key);
    this.sets.delete(key);
    return had ? 1 : 0;
  }

  async sAdd(key: string, member: string): Promise<unknown> {
    let set = this.sets.get(key);
    if (set === undefined) {
      set = new Set<string>();
      this.sets.set(key, set);
    }
    const existed = set.has(member);
    set.add(member);
    return existed ? 0 : 1;
  }

  async sRem(key: string, member: string): Promise<unknown> {
    const set = this.sets.get(key);
    if (set === undefined) {
      return 0;
    }
    return set.delete(member) ? 1 : 0;
  }

  async sMembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set === undefined ? [] : [...set];
  }
}

/**
 * Build a complete, valid {@link WorkflowRun} snapshot for testing, allowing
 * targeted overrides. Defaults are JSON-safe.
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

// ── save / load round-trip ──────────────────────────────────────────────────

test("load returns null for an unknown runId", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
  assert.equal(await store.load("does-not-exist"), null);
});

test("save then load round-trips an equal-by-value snapshot (Req 12.5)", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
  const run = makeRun();
  await store.save(run);

  const loaded = await store.load("run-1");
  assert.notEqual(loaded, null);
  assert.deepEqual(loaded, run);
});

test("save uses the default keyPrefix 'workflow:' for the run snapshot", async () => {
  const client = new FakeRedis();
  const store = new RedisWorkflowStore({ client });
  await store.save(makeRun({ runId: "abc" }));

  assert.ok(client.strings.has("workflow:run:abc"), "run stored at workflow:run:abc");
  assert.ok(client.sets.has("workflow:index"), "index set present");
});

test("a custom keyPrefix namespaces every key the store writes", async () => {
  const client = new FakeRedis();
  const store = new RedisWorkflowStore({ client, keyPrefix: "wf-test:" });
  await store.save(makeRun({ runId: "abc", status: "running" }));

  assert.ok(client.strings.has("wf-test:run:abc"));
  assert.deepEqual([...client.sets.get("wf-test:index")!], ["abc"]);
  assert.deepEqual([...client.sets.get("wf-test:incomplete")!], ["abc"]);
});

test("a Uint8Array activity result survives the JSON tagged base64 round-trip (Req 12.5)", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });

  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 42]);
  const run = makeRun({
    runId: "binary-run",
    commands: [
      {
        seq: 0,
        kind: "activity",
        status: "completed",
        attempts: 1,
        result: bytes,
      },
    ],
  });
  await store.save(run);

  const loaded = await store.load("binary-run");
  const result = loaded!.commands[0]!.result;
  assert.ok(result instanceof Uint8Array, "result restored as a Uint8Array");
  assert.deepEqual([...(result as Uint8Array)], [...bytes]);
});

test("save overwrites the snapshot for an existing runId", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
  await store.save(makeRun({ runId: "run-1", status: "running", nextSeq: 0 }));
  await store.save(makeRun({ runId: "run-1", status: "waiting", nextSeq: 5 }));

  const loaded = await store.load("run-1");
  assert.equal(loaded!.status, "waiting");
  assert.equal(loaded!.nextSeq, 5);
  assert.equal((await store.list()).length, 1);
});

// ── index-set + non-terminal-set maintenance ─────────────────────────────────

test("saving a non-terminal run keeps it in the incomplete set (Req 12.5)", async () => {
  const client = new FakeRedis();
  const store = new RedisWorkflowStore({ client });

  const nonTerminal: RunStatus[] = ["running", "waiting", "paused", "compensating"];
  for (const status of nonTerminal) {
    await store.save(makeRun({ runId: `nt-${status}`, status }));
  }

  const incompleteIds = [...client.sets.get("workflow:incomplete")!].sort();
  assert.deepEqual(incompleteIds, nonTerminal.map((s) => `nt-${s}`).sort());
  // All runs are also indexed.
  assert.equal(client.sets.get("workflow:index")!.size, nonTerminal.length);
});

test("saving a terminal run removes it from the incomplete set but keeps it indexed (Req 12.5)", async () => {
  const client = new FakeRedis();
  const store = new RedisWorkflowStore({ client });

  // Start non-terminal, then transition each to a terminal status.
  const terminal: RunStatus[] = ["completed", "failed", "compensated", "cancelled"];
  for (const status of terminal) {
    await store.save(makeRun({ runId: `t-${status}`, status: "running" }));
  }
  for (const status of terminal) {
    await store.save(makeRun({ runId: `t-${status}`, status }));
  }

  // The incomplete set is now empty; the index still holds every run.
  assert.equal(client.sets.get("workflow:incomplete")!.size, 0);
  assert.equal(client.sets.get("workflow:index")!.size, terminal.length);
});

// ── list / listIncomplete ─────────────────────────────────────────────────────

test("list reports the runId, definition, and status of every recorded run", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
  await store.save(makeRun({ runId: "run-a", definition: "alpha", status: "running" }));
  await store.save(makeRun({ runId: "run-b", definition: "beta", status: "completed" }));

  const summaries = await store.list();
  assert.equal(summaries.length, 2);

  const byId = new Map(summaries.map((s) => [s.runId, s]));
  assert.deepEqual(byId.get("run-a"), { runId: "run-a", definition: "alpha", status: "running" });
  assert.deepEqual(byId.get("run-b"), { runId: "run-b", definition: "beta", status: "completed" });
});

test("listIncomplete returns only non-terminal runs (Req 12.5)", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
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
  assert.deepEqual(ids, nonTerminal.map((s) => `nt-${s}`).sort());
  assert.equal((await store.list()).length, nonTerminal.length + terminal.length);
});

// ── append ─────────────────────────────────────────────────────────────────────

test("append adds an ordered History event to the persisted run", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
  await store.save(makeRun({ runId: "run-1" }));

  await store.append("run-1", { type: "timer.fired", at: 2_000, seq: 0 });
  await store.append("run-1", {
    type: "run.status",
    at: 3_000,
    from: "running",
    to: "waiting",
  });

  const loaded = await store.load("run-1");
  assert.equal(loaded!.history.length, 3);
  assert.deepEqual(loaded!.history[1], { type: "timer.fired", at: 2_000, seq: 0 });
  assert.deepEqual(loaded!.history[2], {
    type: "run.status",
    at: 3_000,
    from: "running",
    to: "waiting",
  });
});

test("append to an unknown run rejects with a descriptive PersistenceError", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });

  await assert.rejects(
    () => store.append("ghost", { type: "timer.fired", at: 1, seq: 0 }),
    (err: unknown) => {
      assert.ok(err instanceof PersistenceError, "expected a PersistenceError");
      assert.equal(err.operation, "append");
      assert.equal(err.runId, "ghost");
      assert.match(err.message, /ghost/);
      return true;
    },
  );
});

// ── WorkflowStore conformance (substitutable for MemoryWorkflowStore) ─────────

test("RedisWorkflowStore is observationally equivalent to MemoryWorkflowStore for the same operations (Req 12.2, 12.5)", async () => {
  const stores: WorkflowStore[] = [
    new MemoryWorkflowStore(),
    new RedisWorkflowStore({ client: new FakeRedis() }),
  ];

  // Drive an identical sequence of operations against each store and collect the
  // observable outputs; they must match exactly.
  async function drive(store: WorkflowStore): Promise<unknown> {
    await store.save(makeRun({ runId: "r1", definition: "alpha", status: "running" }));
    await store.save(makeRun({ runId: "r2", definition: "beta", status: "waiting" }));
    await store.save(makeRun({ runId: "r3", definition: "gamma", status: "completed" }));
    await store.append("r1", { type: "timer.fired", at: 5, seq: 0 });
    // Transition r2 to terminal.
    await store.save(makeRun({ runId: "r2", definition: "beta", status: "cancelled" }));

    const summaries = [...(await store.list())].sort((a, b) => a.runId.localeCompare(b.runId));
    const incompleteIds = (await store.listIncomplete()).map((r) => r.runId).sort();
    const r1 = await store.load("r1");
    const missing = await store.load("nope");

    return {
      name: typeof store.name === "string",
      summaries,
      incompleteIds,
      r1History: r1!.history,
      r1Status: r1!.status,
      missing,
    };
  }

  const [memoryResult, redisResult] = await Promise.all(stores.map(drive));
  assert.deepEqual(redisResult, memoryResult);
});

test("name is the stable 'redis' identifier surfaced to observability/health", () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
  assert.equal(store.name, "redis");
});

test("probe reports availability and the recorded run count", async () => {
  const store = new RedisWorkflowStore({ client: new FakeRedis() });
  await store.save(makeRun({ runId: "run-1" }));
  await store.save(makeRun({ runId: "run-2" }));

  const probe = await store.probe();
  assert.equal(probe.available, true);
  assert.match(probe.detail ?? "", /2 run/);
});
