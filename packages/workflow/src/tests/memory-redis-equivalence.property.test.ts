// src/tests/memory-redis-equivalence.property.test.ts
// Property 12: Memory and Redis stores are observationally equivalent.
// Feature: workflow-engine, Property 12
//
// Validates: Requirements 26.13, 12.2, 12.5
//
// For any arbitrary DETERMINISTIC Workflow_Run — a straight-line sequence of
// activities that each return a value derived purely from the running
// accumulator, ending with a typed output — driving the IDENTICAL workflow
// against the zero-dependency MemoryWorkflowStore and against the
// RedisWorkflowStore (backed by a fully in-process RedisLike fake, no Redis
// server) produces the SAME observable Run_Status, the SAME recorded Activity
// results, the SAME typed output, and the SAME ordered History, so the two
// stores are drop-in substitutable through the engine (Req 12.2, 12.5).
//
// A single fixed injected Clock is shared across both runs so every recorded
// timestamp matches, and the same runId is used for both so the runs are
// byte-for-byte comparable. Everything runs in-process with no external
// services: the Memory store keeps structured clones while the Redis store
// round-trips through JSON (with tagged base64 for any Uint8Array), and the
// property asserts those two representations are observationally identical.

import { test } from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { MemoryWorkflowStore } from "../store.js";
import { RedisWorkflowStore } from "../redis/index.js";
import type { RedisLike } from "../redis/index.js";
import type { WorkflowContext, WorkflowRun, WorkflowStore } from "../types.js";

// ── In-process RedisLike fake (no Redis server) ──────────────────────────────────

/**
 * A minimal, fully in-process {@link RedisLike} fake. String values live in a
 * `Map<string, string>` and sets live in a `Map<string, Set<string>>`, exactly
 * matching the two data structures {@link RedisWorkflowStore} relies on. No
 * network, no server — it backs the Redis store entirely in memory.
 */
class FakeRedis implements RedisLike {
  private readonly strings = new Map<string, string>();
  private readonly sets = new Map<string, Set<string>>();

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
    return set === undefined ? 0 : set.delete(member) ? 1 : 0;
  }

  async sMembers(key: string): Promise<string[]> {
    const set = this.sets.get(key);
    return set === undefined ? [] : [...set];
  }
}

// ── Deterministic workflow model ─────────────────────────────────────────────────

/** A single pure step applied to the running accumulator inside one Activity. */
interface Step {
  readonly op: "add" | "mul" | "xor";
  readonly n: number;
}

/** The typed output a completed run of the modeled workflow produces. */
interface WorkflowOutput {
  readonly final: number;
  readonly results: readonly number[];
  readonly count: number;
}

/**
 * Apply one step to the accumulator. All arithmetic is coerced to a 32-bit
 * integer so results are deterministic and JSON/structured-clone-safe (no
 * floats, so both store representations round-trip identically).
 */
function applyStep(acc: number, step: Step): number {
  switch (step.op) {
    case "add":
      return (acc + step.n) | 0;
    case "mul":
      return Math.trunc(acc * step.n) | 0;
    case "xor":
      return acc ^ step.n;
    default:
      return acc;
  }
}

/**
 * Build a deterministic Workflow_Function: a straight-line sequence of
 * activities, each returning a value derived purely from the previous
 * accumulator, ending with a typed {@link WorkflowOutput}. It touches no bridge
 * so it runs unchanged regardless of which store backs the engine.
 */
function makeWorkflow(steps: readonly Step[]) {
  return async (ctx: WorkflowContext, input: { seed: number }): Promise<WorkflowOutput> => {
    let acc = input.seed;
    const results: number[] = [];
    for (const step of steps) {
      const captured = acc;
      acc = await ctx.activity(() => applyStep(captured, step));
      results.push(acc);
    }
    return { final: acc, results, count: steps.length };
  };
}

/** The absolute activity results recorded on a persisted run, in `seq` order. */
function recordedActivityResults(run: WorkflowRun): unknown[] {
  return run.commands
    .filter((command) => command.kind === "activity")
    .map((command) => command.result);
}

// ── Observation captured from one run against one store ──────────────────────────

interface Observation {
  readonly status: string | null;
  readonly output: WorkflowOutput;
  readonly recorded: unknown[];
  readonly history: readonly unknown[];
}

/**
 * Drive the identical deterministic workflow against the supplied store with a
 * shared fixed Clock and a fixed runId, then capture the observable Run_Status,
 * typed output, recorded activity results, and ordered History.
 */
async function driveAgainst(
  store: WorkflowStore,
  clock: Clock,
  steps: readonly Step[],
  seed: number,
  runId: string,
): Promise<Observation> {
  const engine = createWorkflow({ store, clock, autoResume: false });
  engine.define("equivalence-spec", makeWorkflow(steps));

  const handle = await engine.run<{ seed: number }, WorkflowOutput>(
    "equivalence-spec",
    { seed },
    { runId },
  );
  const output = await handle.result();
  const status = await engine.status(handle.runId);
  const persisted = (await store.load(handle.runId)) as WorkflowRun;

  return {
    status,
    output,
    recorded: recordedActivityResults(persisted),
    history: persisted.history,
  };
}

// ── Generators ───────────────────────────────────────────────────────────────────

const stepArb: fc.Arbitrary<Step> = fc.record({
  op: fc.constantFrom<Step["op"]>("add", "mul", "xor"),
  n: fc.integer({ min: -1_000, max: 1_000 }),
});

// 0 steps is a valid edge (immediate completion, no journaled commands).
const stepsArb = fc.array(stepArb, { minLength: 0, maxLength: 8 });
const seedArb = fc.integer({ min: -1_000, max: 1_000 });

// ── Property 12 — Memory and Redis stores are observationally equivalent ──────────

test("Feature: workflow-engine, Property 12 — the identical workflow produces the same Run_Status, recorded results, output, and History against MemoryWorkflowStore and RedisWorkflowStore", async () => {
  await fc.assert(
    fc.asyncProperty(seedArb, stepsArb, async (seed, steps) => {
      // One fixed injected Clock shared by both runs, so every recorded
      // timestamp is identical across the two stores.
      const clock: Clock = () => 1_000;
      // The same runId for both runs makes the persisted snapshots directly
      // comparable (the runId never appears in a HistoryEvent, but sharing it
      // keeps the comparison maximally strict).
      const runId = "equivalence-run";

      const memory = await driveAgainst(
        new MemoryWorkflowStore(),
        clock,
        steps,
        seed,
        runId,
      );
      const redis = await driveAgainst(
        new RedisWorkflowStore({ client: new FakeRedis() }),
        clock,
        steps,
        seed,
        runId,
      );

      // The deterministic workflow always completes on both stores.
      assert.equal(memory.status, "completed", "the deterministic run completes on the memory store");
      assert.equal(redis.status, "completed", "the deterministic run completes on the redis store");

      // Observational equivalence: same terminal Run_Status, recorded Activity
      // results, typed output, and ordered History (Req 12.2, 12.5).
      assert.equal(redis.status, memory.status, "terminal Run_Status must match across stores");
      assert.deepEqual(redis.recorded, memory.recorded, "recorded activity results must match across stores");
      assert.deepEqual(redis.output, memory.output, "typed output must match across stores");
      assert.deepEqual(redis.history, memory.history, "ordered History must match across stores");
    }),
    { numRuns: 100 },
  );
});
