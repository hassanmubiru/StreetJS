import test from "node:test";
import assert from "node:assert/strict";

import { computeRetryDelay, withTimeout, runWithRetry } from "../retry.js";
import { UpstreamTimeoutError } from "../errors.js";
import type { RetryPolicy } from "../types.js";

/** An injected delay that resolves immediately — no real waiting in tests. */
const immediate = async (): Promise<void> => {};
/** An injected delay that never settles — models a task that always wins. */
const never = (): Promise<void> => new Promise<void>(() => {});

// ── computeRetryDelay ───────────────────────────────────────────────────────────

test("computeRetryDelay follows the exponential formula (1-based attempt)", () => {
  const policy: RetryPolicy = { maxAttempts: 5, baseDelayMs: 100, multiplier: 2 };
  assert.equal(computeRetryDelay(policy, 1), 100); // 100 * 2^0
  assert.equal(computeRetryDelay(policy, 2), 200); // 100 * 2^1
  assert.equal(computeRetryDelay(policy, 3), 400); // 100 * 2^2
  assert.equal(computeRetryDelay(policy, 4), 800); // 100 * 2^3
});

test("computeRetryDelay defaults base to 0 and multiplier to 2", () => {
  assert.equal(computeRetryDelay({ maxAttempts: 3 }, 1), 0);
  assert.equal(computeRetryDelay({ maxAttempts: 3, baseDelayMs: 50 }, 3), 200); // 50 * 2^2
});

test("computeRetryDelay caps the delay at maxDelayMs", () => {
  const policy: RetryPolicy = { maxAttempts: 10, baseDelayMs: 100, multiplier: 2, maxDelayMs: 500 };
  assert.equal(computeRetryDelay(policy, 3), 400); // below cap
  assert.equal(computeRetryDelay(policy, 4), 500); // 800 capped to 500
  assert.equal(computeRetryDelay(policy, 8), 500); // stays capped
});

test("computeRetryDelay is never negative", () => {
  const policy: RetryPolicy = { maxAttempts: 3, baseDelayMs: -100, multiplier: 2 };
  assert.equal(computeRetryDelay(policy, 1), 0);
  assert.equal(computeRetryDelay(policy, 3), 0);
});

// ── withTimeout ───────────────────────────────────────────────────────────────────

test("withTimeout throws UpstreamTimeoutError when fn never settles on its own", async () => {
  // fn only resolves once its signal is aborted (i.e. by the timeout path).
  const fn = (signal: AbortSignal): Promise<string> =>
    new Promise<string>((resolve) => {
      if (signal.aborted) {
        resolve("aborted");
        return;
      }
      signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });

  await assert.rejects(withTimeout(fn, 1000, { delay: immediate }), (err: unknown) => {
    assert.ok(err instanceof UpstreamTimeoutError);
    assert.equal(err.timeoutMs, 1000);
    return true;
  });
});

test("withTimeout aborts the signal handed to fn on timeout", async () => {
  let observedAborted = false;
  const fn = (signal: AbortSignal): Promise<string> =>
    new Promise<string>((resolve) => {
      signal.addEventListener(
        "abort",
        () => {
          observedAborted = signal.aborted;
          resolve("aborted");
        },
        { once: true },
      );
    });

  await assert.rejects(withTimeout(fn, 42, { delay: immediate }), UpstreamTimeoutError);
  assert.equal(observedAborted, true);
});

test("withTimeout returns the value when fn settles first", async () => {
  // Timer never fires, so fn wins the race deterministically.
  const value = await withTimeout(async () => "ok", 1000, { delay: never });
  assert.equal(value, "ok");
});

test("withTimeout propagates fn's own error when it settles first", async () => {
  const boom = new Error("fn failed");
  await assert.rejects(
    withTimeout(async () => {
      throw boom;
    }, 1000, { delay: never }),
    (err: unknown) => err === boom,
  );
});

// ── runWithRetry ───────────────────────────────────────────────────────────────────

test("runWithRetry stops after the first success", async () => {
  let calls = 0;
  const result = await runWithRetry(
    async (n) => {
      calls++;
      if (n < 2) throw new Error("transient");
      return `done@${n}`;
    },
    { maxAttempts: 5 },
    { delay: immediate },
  );
  assert.equal(result, "done@2");
  assert.equal(calls, 2);
});

test("runWithRetry invokes attempt exactly once when maxAttempts is 1", async () => {
  let calls = 0;
  await assert.rejects(
    runWithRetry(
      async () => {
        calls++;
        throw new Error("boom");
      },
      { maxAttempts: 1 },
      { delay: immediate },
    ),
    /boom/,
  );
  assert.equal(calls, 1);
});

test("runWithRetry does not retry a method absent from retryMethods", async () => {
  let calls = 0;
  const err = new Error("server error");
  await assert.rejects(
    runWithRetry(
      async () => {
        calls++;
        throw err;
      },
      { maxAttempts: 4, retryMethods: ["GET", "HEAD"] },
      { method: "POST", delay: immediate },
    ),
    (thrown: unknown) => thrown === err,
  );
  assert.equal(calls, 1);
});

test("runWithRetry retries a listed method up to maxAttempts", async () => {
  let calls = 0;
  const err = new Error("server error");
  await assert.rejects(
    runWithRetry(
      async () => {
        calls++;
        throw err;
      },
      { maxAttempts: 3, retryMethods: ["get"] },
      { method: "GET", delay: immediate },
    ),
    (thrown: unknown) => thrown === err,
  );
  assert.equal(calls, 3);
});

test("runWithRetry honours a false isRetryable predicate", async () => {
  let calls = 0;
  const err = new Error("non-retryable");
  await assert.rejects(
    runWithRetry(
      async () => {
        calls++;
        throw err;
      },
      { maxAttempts: 5 },
      { delay: immediate, isRetryable: () => false },
    ),
    (thrown: unknown) => thrown === err,
  );
  assert.equal(calls, 1);
});
