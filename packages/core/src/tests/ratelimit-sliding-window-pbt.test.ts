// tests/ratelimit-sliding-window-pbt.test.ts
// Property-based test for the scoped rate limiter's sliding-window threshold
// behavior (Phase 2, R3.3–R3.6). Kept in its own *-pbt.test.ts file per the
// repo convention so the universal threshold property is exercised across many
// generated configurations and request timelines, separate from the
// example/edge-case unit tests in store.test.ts.
//
// Requirement coverage proven across arbitrary configs and monotonic request
// timelines, all driven by an INJECTED CLOCK so window timing is deterministic:
//   - R3.3: when the count for a key reaches the configured maximum within the
//           sliding window, the next request is rejected with HTTP 429.
//   - R3.4: a 429 rejection carries a `Retry-After` header in seconds.
//   - R3.5: while below the maximum, the request is permitted and carries the
//           remaining allowance in `X-RateLimit-Remaining`.
//   - R3.6: counts are computed with a sliding window — events older than the
//           window roll off, so allowance is restored once they expire.
//
// The property compares the live middleware against an independent oracle that
// recomputes the sliding-window count from first principles for every request.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { rateLimit, RateLimitException } from '../security/ratelimit.js';
import { InMemoryRateLimitStore, type Clock } from '../security/store.js';

const NUM_RUNS = 200;

// ── Minimal StreetContext stub ────────────────────────────────────────────────
//
// The `scope: 'global'` limiter only ever touches `ctx.setHeader`, so a stub
// that records emitted headers is sufficient to observe every header the
// requirements care about (`Retry-After`, `X-RateLimit-Remaining`, ...).
interface HeaderBag {
  headers: Record<string, string>;
}
function makeCtx(): HeaderBag & { setHeader(name: string, value: string): void } {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader(name: string, value: string): void {
      headers[name] = value;
    },
  };
}

/** A controllable clock whose current time is set explicitly before each call. */
function controllableClock(): Clock & { set(ms: number): void } {
  let nowMs = 0;
  const clock = (() => nowMs) as Clock & { set(ms: number): void };
  clock.set = (ms: number) => {
    nowMs = ms;
  };
  return clock;
}

interface Outcome {
  rejected: boolean;
  status?: number;
  headers: Record<string, string>;
}

/** Drive one request through the middleware at time `t`, capturing the result. */
async function runRequest(
  mw: ReturnType<typeof rateLimit>,
  clock: ReturnType<typeof controllableClock>,
  t: number,
): Promise<Outcome> {
  clock.set(t);
  const ctx = makeCtx();
  let nextCalled = false;
  try {
    await mw(ctx as never, async () => {
      nextCalled = true;
    });
    // A permitted request always invokes the downstream handler.
    assert.equal(nextCalled, true);
    return { rejected: false, headers: ctx.headers };
  } catch (err) {
    // A rejected request must short-circuit before the handler runs.
    assert.equal(nextCalled, false);
    assert.ok(err instanceof RateLimitException, 'rejection is a RateLimitException');
    return { rejected: true, status: (err as RateLimitException).status, headers: ctx.headers };
  }
}

// ── Independent oracle ────────────────────────────────────────────────────────
//
// Recomputes the sliding-window decision for each request from first
// principles, mirroring the documented contract (R3.6): a request at time `t`
// is permitted iff the number of PREVIOUSLY ACCEPTED requests with timestamp in
// `[t - windowMs, t]` is strictly below `max`. Rejected requests are not
// recorded (they do not extend the window).
class Oracle {
  private readonly accepted: number[] = [];
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** @returns whether the request is permitted and the post-decision count. */
  decide(t: number): { permitted: boolean; count: number } {
    const cutoff = t - this.windowMs;
    const active = this.accepted.filter((ts) => ts >= cutoff).length;
    if (active >= this.max) {
      return { permitted: false, count: active };
    }
    this.accepted.push(t);
    return { permitted: true, count: active + 1 };
  }
}

// ── Generators ────────────────────────────────────────────────────────────────
//
// A configuration plus a monotonic (non-decreasing) timeline of request times.
// Timelines are built from non-negative inter-arrival gaps so they model real
// wall-clock progression; gaps span 0 (bursts at the same instant), sub-window
// values, and values that exceed the window (forcing roll-off, R3.6).
interface Scenario {
  max: number;
  windowMs: number;
  times: number[];
}

const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    max: fc.integer({ min: 1, max: 12 }),
    windowMs: fc.integer({ min: 1_000, max: 120_000 }),
    gaps: fc.array(fc.integer({ min: 0, max: 150_000 }), { minLength: 1, maxLength: 60 }),
  })
  .map(({ max, windowMs, gaps }) => {
    // Convert gaps into absolute, non-decreasing timestamps.
    const times: number[] = [];
    let t = 0;
    for (const g of gaps) {
      t += g;
      times.push(t);
    }
    return { max, windowMs, times };
  });

const expectedResetSeconds = (windowMs: number): number => Math.max(1, Math.ceil(windowMs / 1000));

// Feature: consumer-platform-security, Property 5: Sliding-window rate-limit threshold behavior
// Validates: Requirements 3.3, 3.4, 3.5, 3.6
describe('Property 5: sliding-window rate-limit threshold behavior', () => {
  it('permits below the threshold, rejects at it with Retry-After, and restores allowance as the window slides', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ max, windowMs, times }) => {
        const clock = controllableClock();
        // A fresh store per run so each scenario starts with an empty window.
        const store = new InMemoryRateLimitStore();
        const mw = rateLimit({ scope: 'global', requests: max, window: windowMs, store, clock });
        const oracle = new Oracle(max, windowMs);
        const resetSeconds = String(expectedResetSeconds(windowMs));

        for (const t of times) {
          const expected = oracle.decide(t);
          const outcome = await runRequest(mw, clock, t);

          // R3.3 / R3.6: accept/reject decision matches the sliding-window oracle.
          assert.equal(
            outcome.rejected,
            !expected.permitted,
            `at t=${t} (max=${max}, window=${windowMs}) decision should match the oracle`,
          );

          // The limit/reset headers are present on every response.
          assert.equal(outcome.headers['X-RateLimit-Limit'], String(max));
          assert.equal(outcome.headers['X-RateLimit-Reset'], resetSeconds);

          if (outcome.rejected) {
            // R3.3: rejection uses HTTP 429.
            assert.equal(outcome.status, 429);
            // R3.4: a Retry-After header in seconds accompanies the 429.
            assert.equal(outcome.headers['Retry-After'], resetSeconds);
            // No remaining allowance is advertised on rejection.
            assert.equal(outcome.headers['X-RateLimit-Remaining'], '0');
          } else {
            // R3.5: permitted responses advertise the leftover allowance, which
            // equals max minus the post-acceptance window count.
            const expectedRemaining = String(Math.max(0, max - expected.count));
            assert.equal(outcome.headers['X-RateLimit-Remaining'], expectedRemaining);
          }
        }
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('rejects exactly the (max+1)-th request in a burst and recovers after the window fully rolls off (R3.3/R3.4/R3.6)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 1_000, max: 60_000 }),
        async (max, windowMs) => {
          const clock = controllableClock();
          const store = new InMemoryRateLimitStore();
          const mw = rateLimit({ scope: 'global', requests: max, window: windowMs, store, clock });
          const resetSeconds = String(expectedResetSeconds(windowMs));

          // Burst of `max` requests at the same instant — all permitted (R3.5).
          for (let i = 0; i < max; i++) {
            const outcome = await runRequest(mw, clock, 0);
            assert.equal(outcome.rejected, false, `burst request #${i + 1} should be permitted`);
            assert.equal(outcome.headers['X-RateLimit-Remaining'], String(max - (i + 1)));
          }

          // The very next request within the window crosses the threshold (R3.3).
          const overLimit = await runRequest(mw, clock, 0);
          assert.equal(overLimit.rejected, true);
          assert.equal(overLimit.status, 429);
          assert.equal(overLimit.headers['Retry-After'], resetSeconds); // R3.4
          assert.equal(overLimit.headers['X-RateLimit-Remaining'], '0');

          // Still rejected just before the oldest hit leaves the window
          // (cutoff is inclusive: an event at t=0 is active while now <= windowMs).
          const stillBlocked = await runRequest(mw, clock, windowMs);
          assert.equal(stillBlocked.rejected, true, 'within the window the burst still saturates the limit');

          // One millisecond past the window, every burst hit has rolled off and
          // the allowance is fully restored (R3.6).
          const recovered = await runRequest(mw, clock, windowMs + 1);
          assert.equal(recovered.rejected, false, 'allowance is restored once the window slides past the burst');
          assert.equal(recovered.headers['X-RateLimit-Remaining'], String(max - 1));
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });
});
