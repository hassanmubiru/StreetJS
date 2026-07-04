import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { runPipeline } from "../middleware.js";
import type {
  GatewayRequest,
  GatewayResponse,
  Middleware,
  NextFn,
  RequestContext,
} from "../types.js";

/**
 * Feature: gateway, Property: middleware-ordering
 *
 * For N recording middlewares the "in" order must equal the array order
 * [0..N-1] and the "out" order must be its exact reverse, with the terminal
 * handler running exactly once between the descent and the ascent.
 */

/** A fresh, minimal request context per run. */
function makeCtx(requestId: string): RequestContext {
  const request: GatewayRequest = {
    method: "GET",
    url: "/",
    path: "/",
    headers: {},
  };
  return { request, requestId, identity: null, state: {} };
}

/** A middleware that records its descent and ascent into a shared log. */
function recorder(index: number, log: string[]): Middleware {
  return async (_ctx: RequestContext, next: NextFn): Promise<GatewayResponse> => {
    log.push(`in:${index}`);
    const response = await next();
    log.push(`out:${index}`);
    return response;
  };
}

test("Feature: gateway, Property: middleware-ordering — in-order forward, out-order reverse, terminal once", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 12 }), fc.string(), async (n, reqId) => {
      const log: string[] = [];
      const middlewares = Array.from({ length: n }, (_, i) => recorder(i, log));

      let terminalCount = 0;
      const terminal: NextFn = async () => {
        terminalCount++;
        log.push("terminal");
        return { status: 200, headers: {} };
      };

      const response = await runPipeline(makeCtx(reqId), middlewares, terminal);
      assert.equal(response.status, 200);

      // Terminal runs exactly once.
      assert.equal(terminalCount, 1);

      // Expected log: descent in array order, terminal, then ascent in reverse.
      const descent = Array.from({ length: n }, (_, i) => `in:${i}`);
      const ascent = Array.from({ length: n }, (_, i) => `out:${n - 1 - i}`);
      const expected = [...descent, "terminal", ...ascent];
      assert.deepEqual(log, expected);

      // Terminal sits exactly between the descent and the ascent.
      assert.equal(log.indexOf("terminal"), n);
    }),
    { numRuns: 100 },
  );
});
