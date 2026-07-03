// src/tests/storage-idempotence.property.test.ts
// Property 10: Storage operations are idempotent within a run.
// Feature: workflow-engine, Property 10
//
// Validates: Requirements 26.11, 15.5
//
// For any `ctx.storage` operation invoked more than once with the SAME arguments
// within a single Workflow_Run, the observable stored state is the SAME as
// applying that operation exactly once. Concretely, the Storage_Bridge keys each
// mutating operation (`put`/`delete`/`move`/`copy`) by (operation, arguments) and
// applies the underlying effect at most once per key within a run, so:
//
//   1. Running a workflow that issues the same mutating storage operation K times
//      with identical arguments invokes the underlying StorageLike effect exactly
//      ONCE (at-most-once per (op, args) within the run).
//   2. The final observable stored state after K identical invocations equals the
//      state produced by applying that operation exactly once to the same seed.
//   3. Reads (`get`) carry no stored-state effect and never change the store.
//
// Everything runs against the zero-dependency MemoryWorkflowStore, a deterministic
// injectable Clock, and an in-process Map-backed StorageLike fake, so the test
// needs no external services.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { MemoryWorkflowStore } from "../store.js";
import type { StorageLike, WorkflowContext } from "../types.js";

// ── In-process Map-backed StorageLike fake ───────────────────────────────────────

const encoder = new TextEncoder();

/** Coerce string | Uint8Array content into raw bytes for storage. */
function toBytes(content: Uint8Array | string): Uint8Array {
  return typeof content === "string" ? encoder.encode(content) : content;
}

/** A per-operation invocation tally so a test can assert at-most-once application. */
interface CallCounts {
  put: number;
  get: number;
  delete: number;
  move: number;
  copy: number;
}

/**
 * A Map-backed {@link StorageLike} double that records every put/get/delete/
 * move/copy call and its effect on an in-process key→bytes store. It is a faithful
 * object store: `put` writes, `delete` removes, `move` relocates (copy + remove
 * source), `copy` duplicates, and `get` reports presence. Every call bumps the
 * matching {@link CallCounts} entry so the test can prove the bridge applied the
 * underlying effect at most once per (op, args) within a run.
 */
class FakeStorage implements StorageLike {
  readonly map = new Map<string, Uint8Array>();
  readonly calls: CallCounts = { put: 0, get: 0, delete: 0, move: 0, copy: 0 };

  constructor(seed?: Iterable<readonly [string, string]>) {
    if (seed !== undefined) {
      for (const [key, value] of seed) {
        this.map.set(key, toBytes(value));
      }
    }
  }

  async put(key: string, content: Uint8Array | string): Promise<unknown> {
    this.calls.put += 1;
    this.map.set(key, toBytes(content));
    return undefined;
  }

  async get(key: string): Promise<{ found: boolean; bytes?: Uint8Array }> {
    this.calls.get += 1;
    const bytes = this.map.get(key);
    return bytes === undefined ? { found: false } : { found: true, bytes };
  }

  async delete(key: string): Promise<void> {
    this.calls.delete += 1;
    this.map.delete(key);
  }

  async move(from: string, to: string): Promise<void> {
    this.calls.move += 1;
    const bytes = this.map.get(from);
    if (bytes !== undefined) {
      this.map.set(to, bytes);
      this.map.delete(from);
    }
  }

  async copy(from: string, to: string): Promise<void> {
    this.calls.copy += 1;
    const bytes = this.map.get(from);
    if (bytes !== undefined) {
      this.map.set(to, bytes);
    }
  }
}

/** A stable, comparable snapshot of a store's contents: sorted [key, hex] pairs. */
function snapshot(store: FakeStorage): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const [key, bytes] of store.map) {
    entries.push([key, Buffer.from(bytes).toString("hex")]);
  }
  entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return entries;
}

// ── The modeled mutating operation ───────────────────────────────────────────────

type Op =
  | { readonly kind: "put"; readonly key: string; readonly content: string }
  | { readonly kind: "delete"; readonly key: string }
  | { readonly kind: "move"; readonly from: string; readonly to: string }
  | { readonly kind: "copy"; readonly from: string; readonly to: string };

/** Apply an operation once directly to a store (the single-application reference). */
async function applyOnceDirect(store: FakeStorage, op: Op): Promise<void> {
  switch (op.kind) {
    case "put":
      await store.put(op.key, op.content);
      break;
    case "delete":
      await store.delete(op.key);
      break;
    case "move":
      await store.move(op.from, op.to);
      break;
    case "copy":
      await store.copy(op.from, op.to);
      break;
  }
}

/** Issue an operation through `ctx.storage` (the journaled, keyed bridge path). */
async function applyOnceViaCtx(ctx: WorkflowContext, op: Op): Promise<void> {
  switch (op.kind) {
    case "put":
      await ctx.storage.put(op.key, op.content);
      break;
    case "delete":
      await ctx.storage.delete(op.key);
      break;
    case "move":
      await ctx.storage.move(op.from, op.to);
      break;
    case "copy":
      await ctx.storage.copy(op.from, op.to);
      break;
  }
}

// ── Generators ───────────────────────────────────────────────────────────────────

// A small key alphabet so seeded keys and operation targets collide often, making
// move/copy/delete act on populated keys with meaningful frequency.
const keyArb = fc.constantFrom("a", "b", "c", "d", "e");
const contentArb = fc.string({ maxLength: 12 });
// Distinct-key seed map so pre-existing content exists for move/copy/delete.
const seedArb = fc.uniqueArray(fc.tuple(keyArb, contentArb), {
  minLength: 0,
  maxLength: 5,
  selector: ([key]) => key,
});
// Repeat the SAME op with the SAME arguments at least twice within the run.
const repeatArb = fc.integer({ min: 2, max: 6 });

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ kind: fc.constant("put" as const), key: keyArb, content: contentArb }),
  fc.record({ kind: fc.constant("delete" as const), key: keyArb }),
  fc.record({ kind: fc.constant("move" as const), from: keyArb, to: keyArb }),
  fc.record({ kind: fc.constant("copy" as const), from: keyArb, to: keyArb }),
);

/** The underlying-store call tally for a given op kind. */
function callsFor(store: FakeStorage, kind: Op["kind"]): number {
  return store.calls[kind];
}

// ── Property 10 — repeating the same op yields the single-application state ────────

test("Feature: workflow-engine, Property 10 — repeating the same ctx.storage operation with the same arguments within a run applies the underlying effect at most once and yields the single-application stored state", async () => {
  await fc.assert(
    fc.asyncProperty(seedArb, opArb, repeatArb, async (seed, op, repeat) => {
      const clock: Clock = () => 1_000;

      // ── Store A: run a workflow that issues the SAME op `repeat` times. ──
      const bridged = new FakeStorage(seed);
      const store = new MemoryWorkflowStore();
      const engine = createWorkflow({
        store,
        clock,
        autoResume: false,
        bridges: { storage: bridged },
      });
      engine.define("idempotence-spec", async (ctx: WorkflowContext) => {
        for (let i = 0; i < repeat; i += 1) {
          await applyOnceViaCtx(ctx, op);
        }
        return { done: true };
      });

      const handle = await engine.run("idempotence-spec", {});
      await handle.result();
      assert.equal(await engine.status(handle.runId), "completed", "the run must complete");

      // ── Store B: apply the SAME op exactly ONCE, directly, to the same seed. ──
      const reference = new FakeStorage(seed);
      await applyOnceDirect(reference, op);

      // (1) The bridge applied the underlying mutating effect at most once, no
      //     matter how many times the workflow issued the identical call.
      assert.equal(
        callsFor(bridged, op.kind),
        1,
        `the underlying ${op.kind} effect must be applied exactly once per (op, args) within the run`,
      );

      // (2) The observable stored state after K identical invocations equals the
      //     state produced by a single application (idempotence within a run).
      assert.deepEqual(
        snapshot(bridged),
        snapshot(reference),
        "K identical operations must leave the same observable stored state as one",
      );
    }),
    { numRuns: 100 },
  );
});

// ── Property 10 — reads are effect-free and repeated puts converge on last value ──

test("Feature: workflow-engine, Property 10 — repeated ctx.storage.get calls never mutate the store, and a repeated put with identical content is applied once", async () => {
  await fc.assert(
    fc.asyncProperty(seedArb, keyArb, contentArb, repeatArb, async (seed, key, content, repeat) => {
      const clock: Clock = () => 2_000;
      const bridged = new FakeStorage(seed);
      const store = new MemoryWorkflowStore();
      const engine = createWorkflow({
        store,
        clock,
        autoResume: false,
        bridges: { storage: bridged },
      });

      engine.define("read-write-spec", async (ctx: WorkflowContext) => {
        // Repeat an identical put: the underlying effect applies at most once.
        for (let i = 0; i < repeat; i += 1) {
          await ctx.storage.put(key, content);
        }
        // Interleave repeated reads of the same key: reads are never keyed and
        // never carry a stored-state effect (Req 15.5 — reads do not mutate).
        for (let i = 0; i < repeat; i += 1) {
          await ctx.storage.get(key);
        }
        return { done: true };
      });

      const handle = await engine.run("read-write-spec", {});
      await handle.result();

      // The identical put was applied exactly once despite `repeat` invocations.
      assert.equal(bridged.calls.put, 1, "an identical put is applied exactly once within a run");

      // The stored value at `key` equals the single put's content.
      const reference = new FakeStorage(seed);
      await reference.put(key, content);
      assert.deepEqual(
        snapshot(bridged),
        snapshot(reference),
        "the observable stored state equals a single application of the put",
      );
    }),
    { numRuns: 100 },
  );
});
