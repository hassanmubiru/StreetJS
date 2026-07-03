// Unit tests for the @streetjs/workflow WorkflowEngine facade built by
// `createWorkflow` — engine construction, the lifecycle surface, and the typed
// error hierarchy.
//
// Covers:
//   - store resolution: a configured WorkflowStore is used, and when none is
//     configured the engine works over a default MemoryWorkflowStore (Req 1.2).
//   - duplicate `define`: a second registration of the same name throws a
//     RegistrationError and the previously registered definition is retained so a
//     subsequent `run` executes the FIRST function (Req 1.4).
//   - unregistered `run`: rejects with WorkflowNotFoundError and creates NO run
//     (the store stays empty), and an unknown-runId `signal` rejects with a
//     descriptive WorkflowError (Req 1.5).
//   - `pause` stops further activities: a paused run is never re-driven by the
//     coordinator/auto-resume path, so its post-pause activity never executes,
//     while a sibling `running` run of the same definition completes (Req 2.3).
//   - resume with a missing completed result: a persisted run whose completed
//     activity command lacks a recorded `result` resumes to `failed` without
//     re-invoking the activity (Req 13.4).
//   - persistence-failure state preservation: a `run` whose snapshot cannot be
//     persisted surfaces a PersistenceError and leaves the last successfully
//     persisted state unchanged, with no run created (Req 11.5).
//   - publish-failure continuation: a failing `ctx.events.publish` is recorded as
//     a `publish.failed` History event and the run still completes (Req 17.5).
//   - lifecycle broadcast mapping: workflow.started/completed/failed/cancelled
//     are broadcast (carrying the runId) on the corresponding transitions (18.2).
//   - the no-retry-policy at-most-once default: an activity with no Retry_Policy
//     that throws is invoked exactly once and the run fails (Req 6.8).
//   - an engine-level workflow exercising `ctx.if` branching (8.1), an immediate
//     `ctx.sleep(0)` continue (9.6), and durable `ctx.state` (19.4) completes.
//
// Everything runs against the zero-dependency MemoryWorkflowStore and a
// deterministic injected fake Clock, so the tests need no external services.
//
// Requirements: 1.2, 1.4, 1.5, 2.3, 8.1, 9.6, 11.5, 13.4, 17.5, 18.2, 19.4

import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import { MemoryWorkflowStore } from "../store.js";
import {
  PersistenceError,
  RegistrationError,
  WorkflowError,
  WorkflowNotFoundError,
} from "../errors.js";
import type {
  EventsLike,
  RealtimeLike,
  WorkflowFunction,
  WorkflowRun,
} from "../types.js";

// ── Test harness ─────────────────────────────────────────────────────────────────

/**
 * A deterministic, injected fake Clock fixed at a constant instant. None of these
 * tests advance time (parking timers are meant to stay in the future), so a
 * constant clock keeps behaviour fully reproducible with no wall-clock dependency.
 */
const CLOCK: Clock = () => 1_000;

/**
 * Build a complete, valid `running` {@link WorkflowRun} snapshot for the tests
 * that persist runs directly into a store, allowing targeted overrides. Defaults
 * are JSON-safe / structured-clone-friendly.
 */
function makeRun(runId: string, overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  const base: WorkflowRun = {
    runId,
    definition: "wf",
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

/** One recorded call to a fake {@link RealtimeLike} bridge. */
interface RecordedBroadcast {
  readonly channel: string;
  readonly event: string;
  readonly payload: unknown;
}

/**
 * A fake {@link RealtimeLike} bridge that records every `broadcast(channel,
 * event, payload)` call so lifecycle-broadcast mapping can be asserted.
 */
function fakeRealtime(): { bridge: RealtimeLike; calls: RecordedBroadcast[] } {
  const calls: RecordedBroadcast[] = [];
  const bridge: RealtimeLike = {
    broadcast(channel: string, event: string, payload: unknown): void {
      calls.push({ channel, event, payload });
    },
  };
  return { bridge, calls };
}

// ── 1. Store resolution (Req 1.2) ─────────────────────────────────────────────────

test("createWorkflow with no configured store runs over a default MemoryWorkflowStore (Req 1.2)", async () => {
  const engine = createWorkflow({ clock: CLOCK });
  const wf: WorkflowFunction<null, string> = async () => "ok";
  engine.define("wf", wf);

  const handle = await engine.run("wf", null);
  assert.equal(await handle.result(), "ok", "the run completes against the default store");
  assert.equal(await engine.status(handle.runId), "completed");

  // The default store recorded the run (it is listable), evidencing an in-memory
  // default store is present and used even with no `store` in config.
  const summaries = await engine.list();
  assert.ok(
    summaries.some((summary) => summary.runId === handle.runId),
    "the default store records the started run",
  );
  await engine.close();
});

test("createWorkflow uses the configured WorkflowStore for persistence (Req 1.2)", async () => {
  const store = new MemoryWorkflowStore();
  const engine = createWorkflow({ store, clock: CLOCK });
  const wf: WorkflowFunction<null, string> = async () => "ok";
  engine.define("wf", wf);

  const handle = await engine.run("wf", null);
  await handle.result();

  // The run is persisted in the *provided* store, proving the config store is used.
  const persisted = await store.load(handle.runId);
  assert.notEqual(persisted, null, "the configured store holds the run");
  assert.equal(persisted!.status, "completed");
  await engine.close();
});

// ── 2. Duplicate define (Req 1.4) ─────────────────────────────────────────────────

test("a duplicate define throws RegistrationError and retains the prior definition (Req 1.4)", async () => {
  const engine = createWorkflow({ clock: CLOCK });
  const first: WorkflowFunction<null, string> = async () => "first";
  const second: WorkflowFunction<null, string> = async () => "second";

  engine.define("wf", first);

  assert.throws(
    () => engine.define("wf", second),
    (error: unknown) =>
      error instanceof RegistrationError && error.workflowName === "wf",
    "re-registering a name throws a RegistrationError carrying the name",
  );

  // The originally registered definition is retained, so a run executes `first`.
  const handle = await engine.run("wf", null);
  assert.equal(await handle.result(), "first", "the prior definition is retained after the collision");
  await engine.close();
});

// ── 3. Unregistered run + unknown-runId signal (Req 1.5) ───────────────────────────

test("run of an unregistered name throws WorkflowNotFoundError and creates no run (Req 1.5)", async () => {
  const store = new MemoryWorkflowStore();
  const engine = createWorkflow({ store, clock: CLOCK });

  await assert.rejects(
    engine.run("missing", null),
    (error: unknown) =>
      error instanceof WorkflowNotFoundError && error.workflowName === "missing",
    "an unregistered run rejects with WorkflowNotFoundError",
  );

  // No run was created for the unregistered name.
  assert.deepEqual(await store.list(), [], "no run is persisted for an unregistered name");
  await engine.close();
});

test("signal to an unknown runId rejects with a descriptive WorkflowError", async () => {
  const engine = createWorkflow({ clock: CLOCK });

  await assert.rejects(
    engine.signal("nope", "go", { any: "payload" }),
    (error: unknown) => error instanceof WorkflowError && /nope/.test(error.message),
    "signalling an unknown run rejects with a WorkflowError naming the runId",
  );
  await engine.close();
});

// ── 4. pause stops further activities (Req 2.3) ────────────────────────────────────

test("a paused run is not re-driven and runs no further activities, while a sibling running run completes (Req 2.3)", async () => {
  const store = new MemoryWorkflowStore();
  const engine = createWorkflow({ store, clock: CLOCK });

  // Per-runId activity invocation counter, keyed by the run the activity executes in.
  const invocations = new Map<string, number>();
  const wf: WorkflowFunction<null, string> = async (ctx) => {
    await ctx.activity(() => {
      const id = ctx.metadata.runId;
      invocations.set(id, (invocations.get(id) ?? 0) + 1);
      return "x";
    });
    return "done";
  };

  // Two persisted `running` runs of the same (not-yet-registered) definition.
  await store.save(makeRun("paused-run", { definition: "wf", status: "running" }));
  await store.save(makeRun("live-run", { definition: "wf", status: "running" }));

  // Pause one of them BEFORE the definition is registered; pause only applies to a
  // `running` run, so this transitions it to `paused` (Req 2.3).
  await engine.pause("paused-run");
  assert.equal(await engine.status("paused-run"), "paused", "the run is paused");

  // Registering the definition triggers construction-time auto-resume of every
  // incomplete run of "wf". The paused run must be skipped; the running one runs.
  engine.define("wf", wf);
  await engine.list(); // settle every scheduled auto-resume drive deterministically

  // The paused run was never re-driven: it stays paused and its activity never ran.
  assert.equal(await engine.status("paused-run"), "paused", "a paused run stays paused");
  assert.equal(
    invocations.get("paused-run") ?? 0,
    0,
    "a paused run runs no further activities",
  );

  // The sibling running run advanced to completion and did run its activity.
  assert.equal(await engine.status("live-run"), "completed", "the running sibling completes");
  assert.equal(invocations.get("live-run") ?? 0, 1, "the running sibling ran its activity once");
  await engine.close();
});

// ── 5. resume with a missing completed result → failed (Req 13.4) ──────────────────

test("resume of a run whose completed activity is missing its recorded result fails without re-invoking the activity (Req 13.4)", async () => {
  const store = new MemoryWorkflowStore();
  // Disable auto-resume so the explicit `resume` path is what drives the run.
  const engine = createWorkflow({ store, clock: CLOCK, autoResume: false });

  let invoked = 0;
  const wf: WorkflowFunction<null, string> = async (ctx) => {
    const result = await ctx.activity(() => {
      invoked += 1;
      return "live-result";
    });
    return result;
  };
  engine.define("wf", wf);

  // Craft a persisted run whose first (activity) command is recorded `completed`
  // but is MISSING its `result` field — a journal-integrity violation.
  await store.save(
    makeRun("integrity", {
      definition: "wf",
      status: "running",
      commands: [{ seq: 0, kind: "activity", status: "completed", attempts: 1 }],
      nextSeq: 1,
    }),
  );

  const handle = await engine.resume("integrity");

  // The run is finalized as `failed` and the activity effect was never invoked.
  assert.equal(await engine.status("integrity"), "failed", "the run resumes to failed");
  assert.equal(invoked, 0, "the completed command is not re-invoked on resume");
  await assert.rejects(handle.result(), "the handle rejects for a failed run");
  await engine.close();
});

// ── 6. persistence-failure state preservation (Req 11.5) ───────────────────────────

test("a run whose snapshot cannot be persisted surfaces a PersistenceError and preserves prior state (Req 11.5)", async () => {
  const store = new MemoryWorkflowStore();
  const engine = createWorkflow({ store, clock: CLOCK });
  const wf: WorkflowFunction<unknown, string> = async () => "done";
  engine.define("wf", wf);

  // A good run first — this is the "last successfully persisted state".
  const good = await engine.run("wf", { ok: true }, { runId: "good" });
  assert.equal(await good.result(), "done");

  // A run whose input carries a function cannot be structured-cloned, so the very
  // first `store.save` in `run` rejects with a PersistenceError.
  await assert.rejects(
    engine.run("wf", { work: () => "not cloneable" }, { runId: "bad" }),
    (error: unknown) => error instanceof PersistenceError && error.operation === "save",
    "an unpersistable run surfaces a PersistenceError",
  );

  // The last successfully persisted run is unchanged, and no run was created for
  // the failed attempt.
  assert.equal((await store.load("good"))!.status, "completed", "prior state is preserved");
  assert.equal(await store.load("bad"), null, "no run is created when its snapshot cannot be persisted");
  await engine.close();
});

// ── 7. publish-failure continuation (Req 17.5) ─────────────────────────────────────

test("a failing ctx.events.publish is recorded and the run still completes (Req 17.5)", async () => {
  const store = new MemoryWorkflowStore();
  // An EventsLike bridge whose publish always throws.
  const events: EventsLike = {
    publish(): void {
      throw new Error("publish boom");
    },
    waitFor(): Promise<unknown> {
      return Promise.resolve(undefined);
    },
    subscribe(): () => void {
      return () => {};
    },
  };
  const engine = createWorkflow({ store, clock: CLOCK, bridges: { events } });

  const wf: WorkflowFunction<null, string> = async (ctx) => {
    await ctx.events.publish("evt", { x: 1 });
    return "done";
  };
  engine.define("wf", wf);

  const handle = await engine.run("wf", null);

  // The publish failure did not propagate: the run completed normally.
  assert.equal(await handle.result(), "done", "the run continues past a failed publish");
  assert.equal(await engine.status(handle.runId), "completed");

  // The failure was recorded as a `publish.failed` History event.
  const history = await engine.history(handle.runId);
  const failure = history.find((event) => event.type === "publish.failed");
  assert.ok(failure, "a publish.failed History event is recorded");
  assert.equal((failure as { event: string }).event, "evt", "the recorded failure names the event");
  await engine.close();
});

// ── 8. Lifecycle broadcast mapping (Req 18.2) ──────────────────────────────────────

test("a completing run broadcasts workflow.started then workflow.completed carrying the runId (Req 18.2)", async () => {
  const { bridge, calls } = fakeRealtime();
  const engine = createWorkflow({ clock: CLOCK, bridges: { realtime: bridge } });
  const wf: WorkflowFunction<null, string> = async () => "done";
  engine.define("wf", wf);

  const handle = await engine.run("wf", null);
  await handle.result();

  const started = calls.find((call) => call.event === "workflow.started");
  const completed = calls.find((call) => call.event === "workflow.completed");
  assert.ok(started, "workflow.started is broadcast on run start");
  assert.ok(completed, "workflow.completed is broadcast on completion");
  assert.equal(
    (started!.payload as { runId: string }).runId,
    handle.runId,
    "the started broadcast carries the runId",
  );
  assert.equal(
    (completed!.payload as { runId: string }).runId,
    handle.runId,
    "the completed broadcast carries the runId",
  );
  await engine.close();
});

test("a failing run broadcasts workflow.started then workflow.failed (Req 18.2)", async () => {
  const { bridge, calls } = fakeRealtime();
  const engine = createWorkflow({ clock: CLOCK, bridges: { realtime: bridge } });
  const wf: WorkflowFunction<null, string> = async () => {
    throw new Error("kaboom");
  };
  engine.define("wf", wf);

  const handle = await engine.run("wf", null);
  await assert.rejects(handle.result());

  assert.ok(calls.some((call) => call.event === "workflow.started"), "workflow.started is broadcast");
  assert.ok(calls.some((call) => call.event === "workflow.failed"), "workflow.failed is broadcast on failure");
  await engine.close();
});

test("cancelling a waiting run broadcasts workflow.cancelled (Req 18.2)", async () => {
  const { bridge, calls } = fakeRealtime();
  const engine = createWorkflow({ clock: CLOCK, bridges: { realtime: bridge } });
  // Parks on a far-future timer under the fixed clock, so it stays `waiting`.
  const wf: WorkflowFunction<null, string> = async (ctx) => {
    await ctx.sleep(1_000_000);
    return "done";
  };
  engine.define("wf", wf);

  const handle = await engine.run("wf", null);
  assert.equal(await engine.status(handle.runId), "waiting", "the run parks as waiting");

  await engine.cancel(handle.runId);
  assert.equal(await engine.status(handle.runId), "cancelled", "the run is cancelled");

  assert.ok(calls.some((call) => call.event === "workflow.started"), "workflow.started is broadcast");
  assert.ok(
    calls.some(
      (call) => call.event === "workflow.cancelled" && (call.payload as { runId: string }).runId === handle.runId,
    ),
    "workflow.cancelled is broadcast carrying the runId on cancel",
  );
  await engine.close();
});

// ── 9. No-retry-policy at-most-once default (Req 6.8) ──────────────────────────────

test("an activity with no Retry_Policy that throws is invoked exactly once and the run fails (Req 6.8)", async () => {
  const engine = createWorkflow({ clock: CLOCK });
  let invoked = 0;
  const wf: WorkflowFunction<null, string> = async (ctx) => {
    await ctx.activity(() => {
      invoked += 1;
      throw new Error("always fails");
    });
    return "done";
  };
  engine.define("wf", wf);

  const handle = await engine.run("wf", null);
  await assert.rejects(handle.result(), "the run fails");

  assert.equal(invoked, 1, "the activity ran at most once with no retry policy");
  assert.equal(await engine.status(handle.runId), "failed");
  await engine.close();
});

// ── 10. Engine-level branch / immediate timer / durable state (Req 8.1, 9.6, 19.4) ──

test("an engine run exercising ctx.if, an immediate ctx.sleep(0), and ctx.state completes (Req 8.1, 9.6, 19.4)", async () => {
  const store = new MemoryWorkflowStore();
  const engine = createWorkflow({ store, clock: CLOCK });

  const wf: WorkflowFunction<{ flag: boolean }, string> = async (ctx, input) => {
    let path = "none";
    await ctx
      .if(input.flag)
      .then(() => {
        path = "then";
      })
      .else(() => {
        path = "else";
      });
    await ctx.sleep(0); // immediate continue: never enters `waiting` (Req 9.6)
    await ctx.state.set("path", path); // durable state (Req 19.4)
    return ctx.state.get<string>("path") ?? "missing";
  };
  engine.define("wf", wf);

  const handle = await engine.run("wf", { flag: true });

  // The `then` branch ran (8.1), the zero sleep continued immediately (9.6), and
  // the durable state round-tripped (19.4), so the run completed directly.
  assert.equal(await handle.result(), "then", "branch, immediate timer, and state combine to completion");
  assert.equal(await engine.status(handle.runId), "completed", "the run never parks waiting on a zero sleep");

  const persisted = await store.load(handle.runId);
  assert.equal(persisted?.state["path"], "then", "durable state is persisted on the run snapshot");
  await engine.close();
});
