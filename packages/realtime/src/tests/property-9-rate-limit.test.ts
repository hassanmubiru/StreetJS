// src/tests/property-9-rate-limit.test.ts
//
// Feature: realtime-framework, Property 9: Rate limiting never processes more
// than the configured quota — For any sequence of messages sent by a connection
// within a window and any sequence of broadcasts to a channel within a window,
// the number of messages processed (broadcast) never exceeds the configured
// per-connection quota, and the number of channel broadcasts processed never
// exceeds the configured per-channel quota; every excess message is rejected
// rather than delivered.
//
// Validates: Requirements 11.1, 11.2, 11.3
//
// The `RateLimiter` is exercised directly with an injected `ManualClock` so the
// sliding windows are fully deterministic (no wall-clock, no network socket).
// Each generated scenario picks small per-connection and per-channel quotas and
// drives a randomized burst of `consume(connId, channel)` calls interleaved with
// random clock advances — some within a window, some crossing a window boundary.
//
// Two independent checks run after each `consume`:
//
//   1. Decision agreement — a reference model that mirrors the core sliding
//      window (a hit at time `t` is active for a query at time `now` iff
//      `t >= now - windowMs`, per-connection checked before per-channel, and
//      nothing recorded on rejection) predicts the exact decision, including the
//      `exceeded` label. This pins that excess is rejected with the correct
//      quota name rather than delivered (Req 11.2, 11.3).
//
//   2. Sliding-window invariant — over the timestamps of the calls the limiter
//      actually allowed, no window of `windowMs` (ending at any allowed call)
//      ever contains more allowed per-connection calls than the per-connection
//      quota, nor more allowed per-channel calls than the per-channel quota
//      (Req 11.1, 11.2, 11.3). This is asserted against the real limiter output,
//      independently of the reference model.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { ManualClock } from '../index.js';
import { RateLimiter, type RateLimitConfig } from '../ratelimit.js';

/** One driven rate-limit check: advance the clock, then consume for (conn, channel). */
interface Step {
  /** Milliseconds to advance the clock before this consume. */
  advanceMs: number;
  /** Index into the connection-id pool. */
  conn: number;
  /** Index into the channel pool. */
  channel: number;
}

interface Scenario {
  perConnRequests: number;
  perConnWindowMs: number;
  perChanRequests: number;
  perChanWindowMs: number;
  connCount: number;
  channelCount: number;
  steps: Step[];
}

/**
 * Generator: small quotas (1..5 per-connection, 1..8 per-channel) over short
 * windows (50..500ms), a pool of 1..3 connections and 1..2 channels, and a
 * burst of up to 60 consume steps. Advances are biased so many fall inside a
 * window (0..window) while some cross it (up to ~2x the window), exercising both
 * the "at/below quota" (Req 11.1) and "excess rejected" (Req 11.2, 11.3) paths.
 */
const scenarioArb: fc.Arbitrary<Scenario> = fc
  .record({
    perConnRequests: fc.integer({ min: 1, max: 5 }),
    perConnWindowMs: fc.integer({ min: 50, max: 500 }),
    perChanRequests: fc.integer({ min: 1, max: 8 }),
    perChanWindowMs: fc.integer({ min: 50, max: 500 }),
    connCount: fc.integer({ min: 1, max: 3 }),
    channelCount: fc.integer({ min: 1, max: 2 }),
    rawSteps: fc.array(
      fc.record({
        advanceMs: fc.integer({ min: 0, max: 1000 }),
        conn: fc.nat(),
        channel: fc.nat(),
      }),
      { minLength: 1, maxLength: 60 },
    ),
  })
  .map((r) => ({
    perConnRequests: r.perConnRequests,
    perConnWindowMs: r.perConnWindowMs,
    perChanRequests: r.perChanRequests,
    perChanWindowMs: r.perChanWindowMs,
    connCount: r.connCount,
    channelCount: r.channelCount,
    steps: r.rawSteps.map((s) => ({
      advanceMs: s.advanceMs,
      conn: s.conn % r.connCount,
      channel: s.channel % r.channelCount,
    })),
  }));

const connId = (i: number): string => `conn-${i}`;
const channelId = (i: number): string => `chan-${i}`;

/**
 * Count timestamps active for a query at `now` under the core sliding-window
 * rule: a recorded hit at `t` counts iff `t >= now - windowMs` (matches
 * `InMemoryRateLimitStore.count`, cutoff = now - windowMs, inclusive).
 */
function activeCount(timestamps: readonly number[], now: number, windowMs: number): number {
  const cutoff = now - windowMs;
  let active = 0;
  for (const t of timestamps) if (t >= cutoff) active++;
  return active;
}

test('Property 9: rate limiting never processes more than the configured quota', async () => {
  await fc.assert(
    fc.asyncProperty(scenarioArb, async (scenario) => {
      const {
        perConnRequests,
        perConnWindowMs,
        perChanRequests,
        perChanWindowMs,
        steps,
      } = scenario;

      const clock = new ManualClock(0);
      const config: RateLimitConfig = {
        perConnection: { requests: perConnRequests, window: perConnWindowMs },
        perChannel: { requests: perChanRequests, window: perChanWindowMs },
      };
      const limiter = new RateLimiter(config, clock.now);

      // Reference model: timestamps of ALLOWED hits recorded per bucket, mirroring
      // the limiter's own store (a hit is recorded only when the action is allowed).
      const connHits = new Map<string, number[]>();
      const chanHits = new Map<string, number[]>();
      const get = (m: Map<string, number[]>, k: string): number[] => {
        let a = m.get(k);
        if (!a) {
          a = [];
          m.set(k, a);
        }
        return a;
      };

      for (const step of steps) {
        clock.advance(step.advanceMs);
        const now = clock.now();
        const cId = connId(step.conn);
        const chId = channelId(step.channel);

        const connTimestamps = get(connHits, cId);
        const chanTimestamps = get(chanHits, chId);

        // Predict the decision using the same order the limiter evaluates:
        // per-connection first, then per-channel; nothing recorded on rejection.
        const connActive = activeCount(connTimestamps, now, perConnWindowMs);
        const chanActive = activeCount(chanTimestamps, now, perChanWindowMs);

        let expectedAllowed: boolean;
        let expectedExceeded: 'perConnection' | 'perChannel' | undefined;
        if (connActive >= perConnRequests) {
          expectedAllowed = false;
          expectedExceeded = 'perConnection';
        } else if (chanActive >= perChanRequests) {
          expectedAllowed = false;
          expectedExceeded = 'perChannel';
        } else {
          expectedAllowed = true;
          expectedExceeded = undefined;
        }

        const decision = await limiter.consume(cId, chId);

        // 1) Decision agreement, including the exceeded label (Req 11.2, 11.3).
        assert.equal(
          decision.allowed,
          expectedAllowed,
          `allowed mismatch at now=${now} (connActive=${connActive}/${perConnRequests}, chanActive=${chanActive}/${perChanRequests})`,
        );
        assert.equal(
          decision.exceeded,
          expectedExceeded,
          `exceeded label mismatch at now=${now}`,
        );

        // Mirror the limiter's recording: only record on acceptance.
        if (decision.allowed) {
          connTimestamps.push(now);
          chanTimestamps.push(now);
        }
      }

      // 2) Sliding-window invariant over the calls the limiter ACTUALLY allowed:
      // no window of length windowMs (ending at any allowed timestamp) contains
      // more allowed calls than the quota, for every connection and channel
      // bucket (Req 11.1, 11.2, 11.3).
      for (const [key, timestamps] of connHits) {
        for (const end of timestamps) {
          const inWindow = activeCount(timestamps, end, perConnWindowMs);
          assert.ok(
            inWindow <= perConnRequests,
            `per-connection quota exceeded for ${key}: ${inWindow} allowed in a ${perConnWindowMs}ms window (quota ${perConnRequests})`,
          );
        }
      }
      for (const [key, timestamps] of chanHits) {
        for (const end of timestamps) {
          const inWindow = activeCount(timestamps, end, perChanWindowMs);
          assert.ok(
            inWindow <= perChanRequests,
            `per-channel quota exceeded for ${key}: ${inWindow} allowed in a ${perChanWindowMs}ms window (quota ${perChanRequests})`,
          );
        }
      }
    }),
    { numRuns: 100 },
  );
});

test('Property 9: disabled limiter allows every consume regardless of burst (Req 11.5 opt-out)', async () => {
  await fc.assert(
    fc.asyncProperty(
      fc.array(fc.record({ conn: fc.nat({ max: 3 }), channel: fc.nat({ max: 2 }) }), {
        minLength: 1,
        maxLength: 50,
      }),
      async (calls) => {
        const clock = new ManualClock(0);
        // Tiny quotas, but disabled: every consume must be allowed.
        const limiter = new RateLimiter(
          {
            enabled: false,
            perConnection: { requests: 1, window: 1000 },
            perChannel: { requests: 1, window: 1000 },
          },
          clock.now,
        );
        for (const c of calls) {
          const decision = await limiter.consume(connId(c.conn), channelId(c.channel));
          assert.equal(decision.allowed, true, 'disabled limiter must allow all consumes');
          assert.equal(decision.exceeded, undefined);
        }
      },
    ),
    { numRuns: 100 },
  );
});
