import test from "node:test";
import assert from "node:assert/strict";

import { CircuitBreaker } from "../circuit-breaker.js";
import type { CircuitBreakerPolicy } from "../types.js";
import { CircuitOpenError } from "../errors.js";

/** A mutable fake clock: `now` is advanced by tests, `clock()` reads it. */
function makeClock(start = 0): { clock: () => number; advance: (ms: number) => void; set: (ms: number) => void } {
  let now = start;
  return {
    clock: () => now,
    advance: (ms: number) => {
      now += ms;
    },
    set: (ms: number) => {
      now = ms;
    },
  };
}

const KEY = "svc-a";

test("closed transitions to open after threshold consecutive failures", () => {
  const { clock } = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 3, openMs: 1000 };
  const cb = new CircuitBreaker({ policy, clock });

  assert.equal(cb.state(KEY), "closed");
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "closed", "still closed below threshold");
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "closed", "still closed below threshold");
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "open", "opens on the threshold-th failure");
});

test("open sheds requests: canRequest is false", () => {
  const { clock } = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 2, openMs: 1000 };
  const cb = new CircuitBreaker({ policy, clock });

  cb.onFailure(KEY);
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "open");
  assert.equal(cb.canRequest(KEY), false);

  // The breaker itself does not throw; the caller raises CircuitOpenError.
  if (!cb.canRequest(KEY)) {
    const err = new CircuitOpenError(KEY);
    assert.equal(err.key, KEY);
    assert.equal(err.status, 503);
  }
});

test("after openMs elapses the clock advance flips it to half-open", () => {
  const c = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 1, openMs: 500 };
  const cb = new CircuitBreaker({ policy, clock: c.clock });

  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "open");
  assert.equal(cb.canRequest(KEY), false);

  c.advance(499);
  assert.equal(cb.state(KEY), "open", "still open just before openMs");
  assert.equal(cb.canRequest(KEY), false);

  c.advance(1); // now exactly openMs elapsed
  assert.equal(cb.state(KEY), "half-open");
  assert.equal(cb.canRequest(KEY), true, "half-open permits a probe");
});

test("a success in half-open with halfOpenSuccesses=1 closes the circuit", () => {
  const c = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 1, openMs: 500, halfOpenSuccesses: 1 };
  const cb = new CircuitBreaker({ policy, clock: c.clock });

  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "open");

  c.advance(500);
  assert.equal(cb.state(KEY), "half-open");

  cb.onSuccess(KEY);
  assert.equal(cb.state(KEY), "closed");
  assert.equal(cb.canRequest(KEY), true);
});

test("half-open requires halfOpenSuccesses consecutive successes to close", () => {
  const c = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 1, openMs: 500, halfOpenSuccesses: 2 };
  const cb = new CircuitBreaker({ policy, clock: c.clock });

  cb.onFailure(KEY);
  c.advance(500);
  assert.equal(cb.state(KEY), "half-open");

  cb.onSuccess(KEY);
  assert.equal(cb.state(KEY), "half-open", "one success is not enough");
  cb.onSuccess(KEY);
  assert.equal(cb.state(KEY), "closed", "second success closes it");
});

test("a failure in half-open re-opens and resets the open timer", () => {
  const c = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 1, openMs: 500 };
  const cb = new CircuitBreaker({ policy, clock: c.clock });

  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "open");

  c.advance(500);
  assert.equal(cb.state(KEY), "half-open");

  // Probe fails: back to open with a fresh timer anchored at "now".
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "open");
  assert.equal(cb.canRequest(KEY), false);

  // The timer reset means we must wait another full openMs from now.
  c.advance(499);
  assert.equal(cb.state(KEY), "open", "timer was reset on the half-open failure");
  c.advance(1);
  assert.equal(cb.state(KEY), "half-open");
});

test("onSuccess in closed resets the consecutive-failure counter", () => {
  const { clock } = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 3, openMs: 1000 };
  const cb = new CircuitBreaker({ policy, clock });

  cb.onFailure(KEY);
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "closed");

  cb.onSuccess(KEY); // clears the streak

  // Two more failures should NOT open the circuit if the counter truly reset.
  cb.onFailure(KEY);
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "closed", "streak reset, threshold not reached");
  cb.onFailure(KEY);
  assert.equal(cb.state(KEY), "open", "third consecutive failure opens it");
});

test("unknown keys default to closed and allow requests", () => {
  const { clock } = makeClock();
  const policy: CircuitBreakerPolicy = { failureThreshold: 2, openMs: 1000 };
  const cb = new CircuitBreaker({ policy, clock });

  assert.equal(cb.state("never-seen"), "closed");
  assert.equal(cb.canRequest("never-seen"), true);
});
