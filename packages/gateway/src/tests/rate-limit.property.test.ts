import test from "node:test";
import assert from "node:assert/strict";
import fc from "fast-check";

import { RateLimiter } from "../ratelimit.js";
import type { GatewayRequest, RateLimitPolicy } from "../types.js";

/** A fixed request; the SAME key is used for every call in a run. */
const request: GatewayRequest = {
  method: "GET",
  url: "/x",
  path: "/x",
  headers: {},
};

test("Feature: gateway, Property: rate-limiting — a single window allows exactly min(N, L) requests", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 200 }), // limit L
      fc.integer({ min: 1, max: 1_000_000 }), // window W
      fc.integer({ min: 0, max: 400 }), // request count N
      (limit, windowMs, n) => {
        // A frozen clock keeps every request inside a single window.
        const clock = (): number => 0;
        const policy: RateLimitPolicy = { scope: "global", limit, windowMs };
        const limiter = new RateLimiter({ policy, clock });

        let allowed = 0;
        for (let i = 0; i < n; i++) {
          const result = limiter.check(request);
          if (result.allowed) {
            allowed++;
          } else {
            // Every denial reports a positive retry hint.
            assert.ok(result.retryAfterMs > 0);
          }
        }

        // Exactly min(N, L) are allowed, and never more than the budget L.
        assert.equal(allowed, Math.min(n, limit));
        assert.ok(allowed <= limit);
      },
    ),
    { numRuns: 100 },
  );
});
