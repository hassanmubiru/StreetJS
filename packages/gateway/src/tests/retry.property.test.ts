import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { runWithRetry, withTimeout } from "../retry.js";
import { UpstreamTimeoutError } from "../errors.js";

/** An injected delay that resolves immediately — no real waiting in tests. */
const immediate = async (): Promise<void> => {};

test("Feature: gateway, Property: retry — an always-failing attempt runs exactly maxAttempts times", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 1, max: 50 }), async (maxAttempts) => {
      let calls = 0;
      const sentinel = new Error(`boom-${maxAttempts}`);

      let thrown: unknown;
      try {
        await runWithRetry(
          async () => {
            calls++;
            throw sentinel;
          },
          { maxAttempts },
          { delay: immediate },
        );
        assert.fail("expected runWithRetry to reject");
      } catch (err) {
        thrown = err;
      }

      // The attempt is invoked exactly maxAttempts times and the final error propagates.
      assert.equal(calls, maxAttempts);
      assert.equal(thrown, sentinel);
    }),
    { numRuns: 100 },
  );
});

test("Feature: gateway, Property: timeout — a never-settling fn always rejects with UpstreamTimeoutError", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 1_000_000 }), async (timeoutMs) => {
      const neverSettles = (): Promise<never> => new Promise<never>(() => {});

      let thrown: unknown;
      try {
        await withTimeout<never>(neverSettles, timeoutMs, { delay: immediate });
        assert.fail("expected withTimeout to reject");
      } catch (err) {
        thrown = err;
      }

      assert.ok(thrown instanceof UpstreamTimeoutError);
      assert.equal((thrown as UpstreamTimeoutError).timeoutMs, timeoutMs);
    }),
    { numRuns: 100 },
  );
});
