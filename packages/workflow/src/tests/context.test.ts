// Unit tests for the @streetjs/workflow Workflow_Context (`ctx`) surface built by
// `createContext`, and its local (un-journaled) helpers.
//
// Covers:
//   - The full `ctx` member shape: every documented member is present with the
//     correct type (Req 3.4).
//   - `ctx.if` / `ctx.switch` / `ctx.match` branch selection and default branches
//     (Req 8.1–8.5).
//   - Immediate-continue timers: a zero/past `ctx.sleep`/`ctx.waitUntil` resolves
//     without the run entering `waiting` — the status stays `running` and a
//     `timer.fired` (not `timer.set`) History event is recorded (Req 9.6).
//   - `ctx.state` write/resume round-trip: a value written with `set` is read back
//     by `get`, and a fresh `ctx` constructed over the persisted run still reads it,
//     so durable state survives replay (Req 19.4).
//
// Everything runs against the zero-dependency MemoryWorkflowStore, an in-process
// Journal + SignalTimerCoordinator, and a deterministic injectable fake Clock, so
// the test needs no external services.
//
// Requirements: 3.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.6, 19.4

import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import { createContext } from "../context.js";
import type { ActivityRunner } from "../context.js";
import { Journal } from "../journal.js";
import { SignalTimerCoordinator } from "../coordinator.js";
import { MemoryWorkflowStore } from "../store.js";
import type { Branch, WorkflowContext, WorkflowRun, WorkflowStore } from "../types.js";

// ── Test harness ─────────────────────────────────────────────────────────────────

/**
 * A deterministic, injectable fake Clock whose current time can be advanced by
 * the test. Every timer decision and timestamp flows through this, so behaviour
 * is fully reproducible with no wall-clock dependency.
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
    definition: "ctx-under-test",
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

/**
 * A trivial {@link ActivityRunner} that simply invokes the activity once and
 * reports its result as a `completed` outcome. Sufficient for the ctx-surface,
 * branching, timer, and state tests, none of which exercise retries/timeouts.
 */
const runActivity: ActivityRunner = async (activity, _options, _info) => {
  const controller = new AbortController();
  const result = await activity(controller.signal);
  return { status: "completed", result, attempts: 1 };
};

/**
 * Construct a `ctx` and expose the supporting Journal/store/clock so tests can
 * inspect the persisted run and drive the same run again over a fresh Journal.
 */
function makeContext(runId = "run-ctx"): {
  ctx: WorkflowContext;
  journal: Journal;
  store: WorkflowStore;
  coordinator: SignalTimerCoordinator;
  clock: ReturnType<typeof fakeClock>;
} {
  const store = new MemoryWorkflowStore();
  const clock = fakeClock(5_000);
  const run = makeRun(runId);
  const journal = new Journal({ run, store, clock: clock.clock });
  const coordinator = new SignalTimerCoordinator({ store, clock: clock.clock });
  const ctx = createContext({
    journal,
    coordinator,
    clock: clock.clock,
    definition: run.definition,
    runActivity,
  });
  return { ctx, journal, store, coordinator, clock };
}

// ── 1. Full ctx member shape (Req 3.4) ────────────────────────────────────────────

test("ctx exposes every documented member with the correct type (Req 3.4)", async () => {
  const { ctx } = makeContext();

  // Effectful + branching + timer members are functions.
  assert.equal(typeof ctx.activity, "function", "ctx.activity is a function");
  assert.equal(typeof ctx.if, "function", "ctx.if is a function");
  assert.equal(typeof ctx.switch, "function", "ctx.switch is a function");
  assert.equal(typeof ctx.match, "function", "ctx.match is a function");
  assert.equal(typeof ctx.sleep, "function", "ctx.sleep is a function");
  assert.equal(typeof ctx.waitUntil, "function", "ctx.waitUntil is a function");
  assert.equal(typeof ctx.cron, "function", "ctx.cron is a function");
  assert.equal(typeof ctx.interval, "function", "ctx.interval is a function");

  // parallel is an object of three combinators.
  assert.equal(typeof ctx.parallel, "object", "ctx.parallel is an object");
  assert.notEqual(ctx.parallel, null);
  assert.equal(typeof ctx.parallel.all, "function", "ctx.parallel.all is a function");
  assert.equal(typeof ctx.parallel.race, "function", "ctx.parallel.race is a function");
  assert.equal(typeof ctx.parallel.map, "function", "ctx.parallel.map is a function");

  // Pillar bridge surfaces are present and typed regardless of wiring.
  assert.equal(typeof ctx.queue, "object", "ctx.queue is an object");
  assert.equal(typeof ctx.queue.dispatch, "function", "ctx.queue.dispatch is a function");

  assert.equal(typeof ctx.events, "object", "ctx.events is an object");
  assert.equal(typeof ctx.events.publish, "function", "ctx.events.publish is a function");
  assert.equal(typeof ctx.events.waitFor, "function", "ctx.events.waitFor is a function");
  assert.equal(typeof ctx.events.subscribe, "function", "ctx.events.subscribe is a function");

  assert.equal(typeof ctx.storage, "object", "ctx.storage is an object");
  for (const op of ["put", "get", "delete", "move", "copy"] as const) {
    assert.equal(typeof ctx.storage[op], "function", `ctx.storage.${op} is a function`);
  }

  assert.equal(typeof ctx.realtime, "object", "ctx.realtime is an object");
  assert.equal(typeof ctx.realtime.broadcast, "function", "ctx.realtime.broadcast is a function");

  // Ambient services.
  assert.equal(typeof ctx.logger, "object", "ctx.logger is an object");
  for (const level of ["debug", "info", "warn", "error"] as const) {
    assert.equal(typeof ctx.logger[level], "function", `ctx.logger.${level} is a function`);
  }

  assert.equal(typeof ctx.clock, "function", "ctx.clock is a function");
  assert.equal(ctx.clock(), 5_000, "ctx.clock reads the injected Clock");

  assert.equal(typeof ctx.metadata, "object", "ctx.metadata is an object");
  assert.equal(ctx.metadata.runId, "run-ctx", "ctx.metadata carries the runId");
  assert.equal(ctx.metadata.definition, "ctx-under-test", "ctx.metadata carries the definition");
  assert.equal(typeof ctx.metadata.attempt, "number", "ctx.metadata.attempt is a number");

  assert.equal(typeof ctx.state, "object", "ctx.state is an object");
  assert.equal(typeof ctx.state.get, "function", "ctx.state.get is a function");
  assert.equal(typeof ctx.state.set, "function", "ctx.state.set is a function");
});

// ── 2. Conditional helpers (Req 8.1–8.5) ──────────────────────────────────────────

test("ctx.if(true).then runs the then branch (Req 8.1)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  await ctx.if(true).then(() => {
    ran.push("then");
  });

  assert.deepEqual(ran, ["then"], "the then branch runs when the condition is true");
});

test("ctx.if(false).then does NOT run the then branch when there is no else (Req 8.1)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  await ctx.if(false).then(() => {
    ran.push("then");
  });

  assert.deepEqual(ran, [], "a false condition with no else runs nothing");
});

test("ctx.if(true).then().else runs then and never else (Req 8.1)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  await ctx
    .if(true)
    .then(() => {
      ran.push("then");
    })
    .else(() => {
      ran.push("else");
    });

  assert.deepEqual(ran, ["then"], "a true condition runs then, never else");
});

test("ctx.if(false).then().else runs else and never then (Req 8.2)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  await ctx
    .if(false)
    .then(() => {
      ran.push("then");
    })
    .else(() => {
      ran.push("else");
    });

  assert.deepEqual(ran, ["else"], "a false condition runs else, never then");
});

test("ctx.switch executes the matching case branch (Req 8.3)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  const cases = new Map<string, Branch>([
    ["a", () => void ran.push("case-a")],
    ["b", () => void ran.push("case-b")],
  ]);

  await ctx.switch("b", cases, () => void ran.push("default"));

  assert.deepEqual(ran, ["case-b"], "switch selects the branch of the matching case");
});

test("ctx.switch executes the default branch when no case matches (Req 8.5)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  const cases = new Map<string, Branch>([["a", () => void ran.push("case-a")]]);

  await ctx.switch("z", cases, () => void ran.push("default"));

  assert.deepEqual(ran, ["default"], "switch falls through to the default branch");
});

test("ctx.switch runs nothing when no case matches and there is no default (Req 8.3/8.5)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  const cases = new Map<string, Branch>([["a", () => void ran.push("case-a")]]);

  await ctx.switch("z", cases);

  assert.deepEqual(ran, [], "an unmatched switch with no default runs nothing");
});

test("ctx.match executes the branch of the first matching pattern (Req 8.4)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  await ctx.match<number>(
    7,
    [
      [(v) => v < 0, () => void ran.push("negative")],
      [(v) => v % 2 === 1, () => void ran.push("odd")],
      [(v) => v > 5, () => void ran.push("big")],
    ],
    () => void ran.push("default"),
  );

  // 7 matches both "odd" and "big", but only the FIRST matching pattern runs.
  assert.deepEqual(ran, ["odd"], "match runs only the first matching pattern");
});

test("ctx.match executes the default branch when no pattern matches (Req 8.5)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  await ctx.match<number>(
    2,
    [
      [(v) => v < 0, () => void ran.push("negative")],
      [(v) => v % 2 === 1, () => void ran.push("odd")],
    ],
    () => void ran.push("default"),
  );

  assert.deepEqual(ran, ["default"], "match falls through to the default branch");
});

test("ctx.match runs nothing when no pattern matches and there is no default (Req 8.4/8.5)", async () => {
  const { ctx } = makeContext();
  const ran: string[] = [];

  await ctx.match<number>(2, [[(v) => v % 2 === 1, () => void ran.push("odd")]]);

  assert.deepEqual(ran, [], "an unmatched match with no default runs nothing");
});

// ── 3. Immediate-continue timers (Req 9.6) ────────────────────────────────────────

test("ctx.sleep(0) resolves immediately without the run entering waiting (Req 9.6)", async () => {
  const { ctx, journal } = makeContext();

  await ctx.sleep(0);

  const run = journal.run;
  assert.equal(run.status, "running", "a zero sleep must not enter the waiting Run_Status");

  const timer = run.commands.find((command) => command.kind === "sleep");
  assert.notEqual(timer, undefined, "the sleep command was journaled");
  assert.equal(timer!.status, "completed", "the sleep command settles as completed, not waiting");
  assert.equal(timer!.timerExpiresAt, undefined, "an immediate sleep records no timer expiry");

  // A completed (fired) timer records timer.fired, never timer.set.
  const fired = run.history.filter((event) => event.type === "timer.fired");
  const set = run.history.filter((event) => event.type === "timer.set");
  assert.equal(fired.length, 1, "an immediate sleep records exactly one timer.fired event");
  assert.equal(set.length, 0, "an immediate sleep records no timer.set event");
});

test("ctx.sleep with a negative duration resolves immediately without waiting (Req 9.6)", async () => {
  const { ctx, journal } = makeContext();

  await ctx.sleep(-1_000);

  const run = journal.run;
  assert.equal(run.status, "running", "a negative sleep must not enter the waiting Run_Status");
  assert.equal(
    run.history.filter((event) => event.type === "timer.fired").length,
    1,
    "a negative sleep fires immediately",
  );
  assert.equal(
    run.history.filter((event) => event.type === "timer.set").length,
    0,
    "a negative sleep never parks",
  );
});

test("ctx.waitUntil a past absolute time resolves immediately without waiting (Req 9.6)", async () => {
  const { ctx, journal, clock } = makeContext();
  // Clock is at 5_000; wait until a time strictly in the past.
  const pastTime = clock.clock() - 1_000;

  await ctx.waitUntil(pastTime);

  const run = journal.run;
  assert.equal(run.status, "running", "a past waitUntil must not enter the waiting Run_Status");

  const timer = run.commands.find((command) => command.kind === "waitUntil");
  assert.notEqual(timer, undefined, "the waitUntil command was journaled");
  assert.equal(timer!.status, "completed", "the waitUntil command settles as completed, not waiting");

  const fired = run.history.filter((event) => event.type === "timer.fired");
  const set = run.history.filter((event) => event.type === "timer.set");
  assert.equal(fired.length, 1, "a past waitUntil records exactly one timer.fired event");
  assert.equal(set.length, 0, "a past waitUntil records no timer.set event");
});

test("ctx.waitUntil the current instant resolves immediately without waiting (Req 9.6 boundary)", async () => {
  const { ctx, journal, clock } = makeContext();

  await ctx.waitUntil(clock.clock()); // exactly now — not later than now → expired

  const run = journal.run;
  assert.equal(run.status, "running", "a waitUntil equal to now must not enter the waiting Run_Status");
  assert.equal(
    run.history.filter((event) => event.type === "timer.fired").length,
    1,
    "a now-instant waitUntil fires immediately",
  );
});

// ── 4. ctx.state write / resume round-trip (Req 19.4) ──────────────────────────────

test("ctx.state.set then get returns the written value (Req 19.4)", async () => {
  const { ctx } = makeContext();

  assert.equal(ctx.state.get("cursor"), undefined, "an unset key reads undefined");

  await ctx.state.set("cursor", 42);
  assert.equal(ctx.state.get<number>("cursor"), 42, "get returns the value written by set");

  await ctx.state.set("label", "processing");
  assert.equal(ctx.state.get<string>("label"), "processing", "multiple keys are independently readable");
  assert.equal(ctx.state.get<number>("cursor"), 42, "an earlier key is unaffected by a later write");
});

test("ctx.state survives replay: a fresh ctx over the persisted run reads the written value (Req 19.4)", async () => {
  const { ctx, journal, store, coordinator, clock } = makeContext("run-state");

  await ctx.state.set("cursor", 42);
  await ctx.state.set("label", "processing");

  // The write is durably persisted on the run snapshot.
  const persisted = await store.load("run-state");
  assert.notEqual(persisted, null);
  assert.deepEqual(
    persisted!.state,
    { cursor: 42, label: "processing" },
    "state writes are persisted on the durable snapshot",
  );

  // Simulate a resume: build a brand-new Journal + ctx over the persisted run.
  let replayInvocations = 0;
  const replayRunActivity: ActivityRunner = async (activity, _options, _info) => {
    replayInvocations += 1;
    const controller = new AbortController();
    return { status: "completed", result: await activity(controller.signal), attempts: 1 };
  };
  const replayJournal = new Journal({ run: persisted!, store, clock: clock.clock });
  const replayCtx = createContext({
    journal: replayJournal,
    coordinator,
    clock: clock.clock,
    definition: persisted!.definition,
    runActivity: replayRunActivity,
  });

  // Reads are served from the loaded snapshot without re-executing any state.set.
  assert.equal(replayCtx.state.get<number>("cursor"), 42, "durable state survives replay for the first key");
  assert.equal(
    replayCtx.state.get<string>("label"),
    "processing",
    "durable state survives replay for the second key",
  );
  assert.equal(replayInvocations, 0, "reading replayed state runs no activity");

  // Sanity: the original journal still reads the same values.
  assert.equal(journal.run.state["cursor"], 42);
});
