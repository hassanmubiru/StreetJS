import test from "node:test";
import assert from "node:assert/strict";

import { RateLimiter, keyFor } from "../ratelimit.js";
import type { GatewayRequest, Identity, RateLimitPolicy } from "../types.js";
import { RateLimitExceededError } from "../errors.js";

/** A mutable fake clock: `now` is advanced by tests, `clock()` reads it. */
function makeClock(start = 0): { clock: () => number; advance: (ms: number) => void } {
  let now = start;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** Build a minimal request; overrides layer on top of sane defaults. */
function req(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    method: "GET",
    url: "/x",
    path: "/x",
    headers: {},
    ...overrides,
  };
}

const identity = (subject: string): Identity => ({ subject });

test("keyFor resolves the correct key for each scope (with and without fallbacks)", () => {
  const global: RateLimitPolicy = { scope: "global", limit: 5, windowMs: 1000 };
  assert.equal(keyFor(global, req()), "global");

  const ip: RateLimitPolicy = { scope: "ip", limit: 5, windowMs: 1000 };
  assert.equal(keyFor(ip, req({ ip: "10.0.0.1" })), "10.0.0.1");
  assert.equal(keyFor(ip, req()), "unknown");

  const user: RateLimitPolicy = { scope: "user", limit: 5, windowMs: 1000 };
  assert.equal(keyFor(user, req(), identity("alice")), "alice");
  assert.equal(keyFor(user, req(), null), "anonymous");
  assert.equal(keyFor(user, req()), "anonymous");

  const apiKey: RateLimitPolicy = { scope: "api-key", limit: 5, windowMs: 1000 };
  assert.equal(keyFor(apiKey, req({ headers: { "x-api-key": "abc" } })), "abc");
  // Array-form header collapses to its first element.
  assert.equal(keyFor(apiKey, req({ headers: { "x-api-key": ["k1", "k2"] } })), "k1");
  assert.equal(keyFor(apiKey, req()), "anonymous");
});

test("within a window the first `limit` requests are allowed and the next is denied", () => {
  const { clock } = makeClock(1000);
  const policy: RateLimitPolicy = { scope: "global", limit: 3, windowMs: 1000 };
  const limiter = new RateLimiter({ policy, clock });

  const r1 = limiter.check(req());
  assert.deepEqual(r1, { allowed: true, remaining: 2, retryAfterMs: 0 });
  const r2 = limiter.check(req());
  assert.deepEqual(r2, { allowed: true, remaining: 1, retryAfterMs: 0 });
  const r3 = limiter.check(req());
  assert.deepEqual(r3, { allowed: true, remaining: 0, retryAfterMs: 0 });

  // The (limit+1)th request is denied with a strictly positive retryAfterMs.
  const r4 = limiter.check(req());
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
  assert.ok(r4.retryAfterMs > 0, "denied result carries a positive retryAfterMs");

  // The limiter never throws; the caller raises RateLimitExceededError.
  if (!r4.allowed) {
    const err = new RateLimitExceededError(r4.retryAfterMs);
    assert.equal(err.retryAfterMs, r4.retryAfterMs);
    assert.equal(err.status, 429);
  }
});

test("advancing the clock past windowMs refills the bucket", () => {
  const c = makeClock(0);
  const policy: RateLimitPolicy = { scope: "global", limit: 2, windowMs: 1000 };
  const limiter = new RateLimiter({ policy, clock: c.clock });

  assert.equal(limiter.check(req()).allowed, true);
  assert.equal(limiter.check(req()).allowed, true);
  assert.equal(limiter.check(req()).allowed, false, "exhausted within the window");

  // Within the window, still denied.
  c.advance(999);
  assert.equal(limiter.check(req()).allowed, false, "still within the same window");

  // Crossing the window boundary refills the full budget.
  c.advance(1);
  const refilled = limiter.check(req());
  assert.equal(refilled.allowed, true);
  assert.equal(refilled.remaining, 1);
  assert.equal(limiter.check(req()).allowed, true);
  assert.equal(limiter.check(req()).allowed, false, "exhausted again in the new window");
});

test("different keys have independent buckets (ip / user / api-key)", () => {
  const { clock } = makeClock(0);

  const ipLimiter = new RateLimiter({ policy: { scope: "ip", limit: 1, windowMs: 1000 }, clock });
  assert.equal(ipLimiter.check(req({ ip: "1.1.1.1" })).allowed, true);
  assert.equal(ipLimiter.check(req({ ip: "1.1.1.1" })).allowed, false, "first ip is exhausted");
  assert.equal(ipLimiter.check(req({ ip: "2.2.2.2" })).allowed, true, "second ip is independent");

  const userLimiter = new RateLimiter({ policy: { scope: "user", limit: 1, windowMs: 1000 }, clock });
  assert.equal(userLimiter.check(req(), identity("alice")).allowed, true);
  assert.equal(userLimiter.check(req(), identity("alice")).allowed, false, "alice is exhausted");
  assert.equal(userLimiter.check(req(), identity("bob")).allowed, true, "bob is independent");

  const keyLimiter = new RateLimiter({ policy: { scope: "api-key", limit: 1, windowMs: 1000 }, clock });
  assert.equal(keyLimiter.check(req({ headers: { "x-api-key": "k1" } })).allowed, true);
  assert.equal(keyLimiter.check(req({ headers: { "x-api-key": "k1" } })).allowed, false, "k1 is exhausted");
  assert.equal(keyLimiter.check(req({ headers: { "x-api-key": "k2" } })).allowed, true, "k2 is independent");
});
