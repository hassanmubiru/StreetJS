// Unit tests for the @streetjs/workflow ActivityExecutor.
//
// The executor runs a single `ctx.activity` command to a terminal result or
// terminal failure, owning the per-attempt AbortSignal wiring, middleware
// wrapping, timeout race, direct/queue routing, and retry/backoff. These tests
// exercise its observable behaviour deterministically by injecting an immediate
// `delay` (so timeout and backoff timers fire without real waiting) and a fake
// `clock`, and by modelling activities whose settling is driven by their
// AbortSignal.
//
// Coverage:
//   1. No-retry-policy at-most-once default (Req 6.8) — a failing activity with
//      no Retry_Policy is invoked exactly once and the run fails.
//   2. Timeout-as-failure with a remaining retry (Req 5.1, 5.2) — an activity
//      that never settles under a timeout times out on attempt 1 and, with
//      maxAttempts 2, a second attempt is scheduled; the recorded failure is an
//      ActivityTimeoutError.
//   3. AbortSignal wiring (Req 4.5 surface / cancellation) — an aborted run
//      signal is observable to the activity via the signal it receives.
//   4. Middleware wrapping per attempt (Req 4.5) — a middleware runs on every
//      attempt, not just the first.
//   5. viaQueue-vs-direct equivalence (Req 16.2) — a viaQueue activity run
//      through an injected runner yields the same recorded result as a direct run.
//
// Requirements: 4.5, 5.1, 5.2, 6.8, 16.2

import test from "node:test";
import assert from "node:assert/strict";

import type { Clock } from "streetjs";

import {
  ActivityExecutor,
  ActivityTimeoutError,
  createActivityExecutor,
  type ActivityRunner,
  type DelayFn,
} from "../executor.js";
import type { Activity, ActivityMiddleware } from "../types.js";

/** A deterministic, injectable fake Clock; timestamps are stable, no wall clock. */
function fakeClock(start = 1_000): Clock {
  let now = start;
  return () => now;
}

/**
 * An immediate delay: resolves on the next microtask without real waiting. Used
 * for both the timeout timer (so a timeout fires deterministically) and backoff
 * scheduling (so retries happen without elapsing real time).
 */
const immediateDelay: DelayFn = () => Promise.resolve();

/**
 * An activity that never settles on its own: it returns a promise that stays
 * pending until the attempt's timeout fires and drives the failure through the
 * injected delay. Records how many times it was invoked (i.e. how many attempts
 * were started). This is the precise model of Req 5.1 — an activity that "does
 * not settle within the configured timeout duration".
 */
function neverSettlingActivity(): { activity: Activity<string>; invocations: () => number } {
  let count = 0;
  const activity: Activity<string> = () =>
    new Promise<string>(() => {
      count += 1;
    });
  return { activity, invocations: () => count };
}

// ── 1. No-retry-policy at-most-once default (Req 6.8) ─────────────────────────────

test("a failing activity with no Retry_Policy is invoked exactly once and fails (Req 6.8)", async () => {
  let invocations = 0;
  const activity: Activity<never> = () => {
    invocations += 1;
    throw new Error("boom");
  };

  const executor = new ActivityExecutor({ clock: fakeClock(), delay: immediateDelay });
  const outcome = await executor.run({ seq: 1, activity });

  assert.equal(invocations, 1, "with no Retry_Policy the activity runs at most once");
  assert.equal(outcome.status, "failed", "a failing at-most-once activity fails terminally");
  assert.equal(outcome.attempts, 1, "exactly one attempt was consumed");
  if (outcome.status === "failed") {
    assert.equal(outcome.error.message, "boom", "the recorded error is the activity's failure");
  }
  // A single started + single failed History event, no retry.scheduled.
  const history = outcome.history ?? [];
  const started = history.filter((e) => e.type === "activity.started");
  const failed = history.filter((e) => e.type === "activity.failed");
  const retries = history.filter((e) => e.type === "retry.scheduled");
  assert.equal(started.length, 1, "exactly one activity.started event");
  assert.equal(failed.length, 1, "exactly one activity.failed event");
  assert.equal(retries.length, 0, "no retry was scheduled without a Retry_Policy");
});

// ── 2. Timeout-as-failure with a remaining retry (Req 5.1, 5.2) ───────────────────

test("an activity that never settles times out and, with a remaining retry, runs a second attempt (Req 5.1, 5.2)", async () => {
  const { activity, invocations } = neverSettlingActivity();

  const executor = new ActivityExecutor({ clock: fakeClock(), delay: immediateDelay });
  const outcome = await executor.run({
    seq: 2,
    activity,
    options: {
      timeout: 50,
      retry: { maxAttempts: 2, backoff: { strategy: "fixed", delayMs: 10 } },
    },
  });

  assert.equal(outcome.status, "failed", "the never-settling activity fails terminally after retries exhaust");
  assert.equal(outcome.attempts, 2, "the timeout on attempt 1 scheduled a second attempt");
  assert.equal(invocations(), 2, "a second attempt of the activity was actually invoked");
  if (outcome.status === "failed") {
    assert.equal(
      outcome.error.name,
      "ActivityTimeoutError",
      "the recorded terminal failure is an ActivityTimeoutError",
    );
  }
  // The first timeout failure scheduled exactly one retry between the two attempts.
  const history = outcome.history ?? [];
  const started = history.filter((e) => e.type === "activity.started");
  const failed = history.filter((e) => e.type === "activity.failed");
  const retries = history.filter((e) => e.type === "retry.scheduled");
  assert.equal(started.length, 2, "two attempts were started");
  assert.equal(failed.length, 2, "both attempts failed (timed out)");
  assert.equal(retries.length, 1, "exactly one retry was scheduled between the attempts");

  // Sanity: the standalone error type carries its declared timeout.
  const err = new ActivityTimeoutError(50);
  assert.equal(err.timeoutMs, 50);
  assert.ok(err instanceof ActivityTimeoutError);
});

// ── 3. AbortSignal wiring (Req 4.4/4.5 cancellation surface) ──────────────────────

test("an already-aborted run signal is observable to the activity via the signal it receives", async () => {
  const preAborted = new AbortController();
  preAborted.abort();

  let observedAborted: boolean | undefined;
  const activity: Activity<string> = (signal) => {
    observedAborted = signal.aborted;
    return "done";
  };

  const executor = new ActivityExecutor({ clock: fakeClock(), delay: immediateDelay });
  const outcome = await executor.run({ seq: 3, activity, signal: preAborted.signal });

  assert.equal(observedAborted, true, "the activity sees an already-aborted signal when the run is cancelled");
  assert.equal(outcome.status, "completed", "this activity completes (it simply reads the signal state)");
});

test("aborting the run signal is observable to a running activity via its signal", async () => {
  const controller = new AbortController();
  let received: AbortSignal | undefined;

  const activity: Activity<string> = (signal) =>
    new Promise<string>((resolve) => {
      received = signal;
      signal.addEventListener("abort", () => resolve("saw-abort"), { once: true });
    });

  const executor = new ActivityExecutor({ clock: fakeClock(), delay: immediateDelay });
  // No timeout: the attempt runs until it settles. Start it, then cancel the run.
  const pending = executor.run({ seq: 4, activity, signal: controller.signal });
  controller.abort();
  const outcome = await pending;

  assert.notEqual(received, undefined, "the activity received an AbortSignal");
  assert.equal(received!.aborted, true, "the received signal reflects the run cancellation");
  assert.equal(outcome.status, "completed", "the activity settled by observing the abort");
  if (outcome.status === "completed") {
    assert.equal(outcome.result, "saw-abort", "the activity resolved in response to the abort");
  }
});

// ── 4. Middleware wrapping per attempt (Req 4.5) ──────────────────────────────────

test("declared middleware wraps every attempt, not just the first (Req 4.5)", async () => {
  const attemptsSeen: number[] = [];
  const countingMiddleware: ActivityMiddleware = (next, info) => {
    attemptsSeen.push(info.attempt);
    return next(new AbortController().signal);
  };

  const activity: Activity<never> = () => {
    throw new Error("always fails");
  };

  const executor = new ActivityExecutor({ clock: fakeClock(), delay: immediateDelay });
  const outcome = await executor.run({
    seq: 5,
    activity,
    options: {
      retry: { maxAttempts: 2, backoff: { strategy: "fixed", delayMs: 10 } },
      middleware: [countingMiddleware],
    },
  });

  assert.equal(outcome.status, "failed", "the always-failing activity fails after retries exhaust");
  assert.equal(outcome.attempts, 2, "two attempts were consumed");
  assert.equal(attemptsSeen.length, 2, "the middleware ran once per attempt");
  assert.deepEqual(attemptsSeen, [1, 2], "the middleware observed each attempt in order");
});

// ── 5. viaQueue-vs-direct equivalence (Req 16.2) ──────────────────────────────────

test("a viaQueue activity through an injected runner yields the same recorded result as a direct run (Req 16.2)", async () => {
  const clock = fakeClock();
  const activity: Activity<{ ok: boolean; n: number }> = () => ({ ok: true, n: 7 });

  // Direct run: no runner wired, activity runs in-process.
  const direct = createActivityExecutor({ clock, delay: immediateDelay });
  const directOutcome = await direct.run({ seq: 6, activity });

  // viaQueue run: an injected runner routes the activity, honouring its signal.
  let routedViaQueue: boolean | undefined;
  const runner: ActivityRunner = {
    runActivity: (act, opts) => {
      routedViaQueue = opts?.viaQueue;
      const signal = opts?.signal ?? new AbortController().signal;
      return Promise.resolve(act(signal));
    },
  };
  const queued = createActivityExecutor({ clock, delay: immediateDelay, runner });
  const queuedOutcome = await queued.run({ seq: 6, activity, options: { viaQueue: true } });

  assert.equal(routedViaQueue, true, "the runner was asked to route the activity via the queue");
  assert.equal(directOutcome.status, "completed");
  assert.equal(queuedOutcome.status, "completed");
  assert.equal(directOutcome.attempts, queuedOutcome.attempts, "both routes consume the same attempt count");
  if (directOutcome.status === "completed" && queuedOutcome.status === "completed") {
    assert.deepEqual(
      queuedOutcome.result,
      directOutcome.result,
      "the queue-routed result equals the directly-run result",
    );
    assert.deepEqual(queuedOutcome.result, { ok: true, n: 7 }, "the recorded result is the activity's output");
  }
});
