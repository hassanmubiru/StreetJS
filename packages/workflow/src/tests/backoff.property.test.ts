// src/tests/backoff.property.test.ts
// Property 13: Backoff delay formula and bound.
// Feature: workflow-engine, Property 13
//
// Validates:
//   - Req 6.3: `exponential` → delay before attempt n is
//     `min(base * multiplier^(n - 1), maxDelay)`.
//   - Req 6.4: `linear` → delay before attempt n is `min(base * n, maxDelay)`.
//   - Req 6.5: `fixed` → the configured constant `delayMs`.
//   - Req 6.6: `jitter` → a randomized value bounded by the configured maximum
//     delay (i.e. a value in `[0, maxDelay]`).
//
// For every strategy the property asserts that `computeBackoff` returns EXACTLY
// the strategy's formula, and that in every case the returned delay never
// exceeds the strategy's configured maximum delay (the bound). The `jitter`
// strategy consults an injected, deterministic `rng` so the randomized value is
// reproducible under test. Generators are constrained to finite, non-negative
// numbers (no NaN, no infinities) so the arithmetic is total and the min-cap is
// meaningful.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

import { computeBackoff } from '../backoff.js';
import type { Backoff } from '../types.js';

// ── Generators ───────────────────────────────────────────────────────────────

/** A finite, non-negative delay in milliseconds, bounded so products stay in range. */
const nonNegativeMs = (max: number): fc.Arbitrary<number> =>
  fc.double({ min: 0, max, noNaN: true, noDefaultInfinity: true });

/** A multiplier >= 1 (may be fractional), per the exponential contract. */
const multiplierArb = fc.double({ min: 1, max: 5, noNaN: true, noDefaultInfinity: true });

/** A 1-based attempt number: attempt = 1 is the first retry after the initial failure. */
const attemptArb = fc.integer({ min: 1, max: 20 });

/** A deterministic rng value in [0, 1), matching the Math.random contract. */
const rngValueArb = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true, noDefaultInfinity: true });

// ── Property 13a: fixed → exactly delayMs (and that is the bound) ─────────────

test('Feature: workflow-engine, Property 13 — fixed backoff returns exactly delayMs for every attempt', () => {
  fc.assert(
    fc.property(nonNegativeMs(100_000), attemptArb, (delayMs, attempt) => {
      const policy: Backoff = { strategy: 'fixed', delayMs };
      const delay = computeBackoff(policy, attempt);
      // Exact formula (Req 6.5): the constant delay, independent of attempt.
      assert.equal(delay, delayMs, `fixed: delay ${delay} !== delayMs ${delayMs}`);
    }),
    { numRuns: 100 },
  );
});

// ── Property 13b: linear → exactly min(base * n, maxDelay), bounded by maxDelay ─

test('Feature: workflow-engine, Property 13 — linear backoff returns exactly min(base * n, maxDelay) and never exceeds maxDelay', () => {
  fc.assert(
    fc.property(
      nonNegativeMs(10_000),
      nonNegativeMs(100_000),
      attemptArb,
      (baseMs, maxDelayMs, attempt) => {
        const policy: Backoff = { strategy: 'linear', baseMs, maxDelayMs };
        const delay = computeBackoff(policy, attempt);
        // Exact formula (Req 6.4).
        const expected = Math.min(baseMs * attempt, maxDelayMs);
        assert.equal(delay, expected, `linear: delay ${delay} !== min(base*n, maxDelay) ${expected}`);
        // Bound: never exceeds the configured maximum delay.
        assert.ok(delay <= maxDelayMs, `linear: delay ${delay} exceeded maxDelay ${maxDelayMs}`);
      },
    ),
    { numRuns: 100 },
  );
});

// ── Property 13c: exponential → exactly min(base * m^(n-1), maxDelay), bounded ──

test('Feature: workflow-engine, Property 13 — exponential backoff returns exactly min(base * multiplier^(n-1), maxDelay) and never exceeds maxDelay', () => {
  fc.assert(
    fc.property(
      nonNegativeMs(10_000),
      multiplierArb,
      nonNegativeMs(100_000),
      attemptArb,
      (baseMs, multiplier, maxDelayMs, attempt) => {
        const policy: Backoff = { strategy: 'exponential', baseMs, multiplier, maxDelayMs };
        const delay = computeBackoff(policy, attempt);
        // Exact formula (Req 6.3): attempt is 1-based, so the first retry uses exponent 0.
        const expected = Math.min(baseMs * multiplier ** (attempt - 1), maxDelayMs);
        assert.equal(
          delay,
          expected,
          `exponential: delay ${delay} !== min(base*mult^(n-1), maxDelay) ${expected}`,
        );
        // Bound: never exceeds the configured maximum delay.
        assert.ok(delay <= maxDelayMs, `exponential: delay ${delay} exceeded maxDelay ${maxDelayMs}`);
      },
    ),
    { numRuns: 100 },
  );
});

// ── Property 13d: jitter → a value in [0, maxDelay] via a deterministic rng ────

test('Feature: workflow-engine, Property 13 — jitter backoff returns a value in [0, maxDelay] using the injected rng', () => {
  fc.assert(
    fc.property(
      nonNegativeMs(100_000),
      rngValueArb,
      attemptArb,
      (maxDelayMs, rngValue, attempt) => {
        const policy: Backoff = { strategy: 'jitter', maxDelayMs };
        // Inject a deterministic rng so the randomized delay is reproducible.
        const delay = computeBackoff(policy, attempt, () => rngValue);
        // Exact formula (Req 6.6): min(rng() * maxDelay, maxDelay).
        const expected = Math.min(rngValue * maxDelayMs, maxDelayMs);
        assert.equal(delay, expected, `jitter: delay ${delay} !== min(rng*maxDelay, maxDelay) ${expected}`);
        // Bound: a randomized value in [0, maxDelay].
        assert.ok(delay >= 0, `jitter: delay ${delay} was negative`);
        assert.ok(delay <= maxDelayMs, `jitter: delay ${delay} exceeded maxDelay ${maxDelayMs}`);
      },
    ),
    { numRuns: 100 },
  );
});
