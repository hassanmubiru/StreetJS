// src/backoff.ts
// @streetjs/workflow — pure backoff delay math (Req 6.3, 6.4, 6.5, 6.6, 6.9).
//
// Computes the delay (in ms) to wait before a given retry attempt of an
// activity. The math is PURE and Clock-independent: it takes only the resolved
// backoff policy, the 1-based attempt number, and an injectable random source
// (`rng`, defaulting to `Math.random`). The caller (the Activity Executor) is
// responsible for measuring the returned delay against the injected `Clock`.
//
// The `fixed` and `exponential` strategies reuse the *verified* @streetjs/queue
// backoff formula exactly (`packages/queue/src/retry.ts::computeBackoffDelay`):
// `exponential` → `min(base * multiplier^(attempt - 1), maxDelay)`. The `linear`
// and `jitter` strategies are the additions the workflow requirements layer on
// (Req 6.4, 6.6). No separate retry system is introduced (Req 6.9).
//
// The canonical `Backoff` type is the single source of truth in `src/types.ts`
// and is imported here (Req 6.1); this module owns only the pure delay math.

import type { Backoff } from "./types.js";

/**
 * Compute the backoff delay (in ms) to wait before the given `attempt` of an
 * activity. `attempt` is 1-based: `attempt = 1` is the first retry after the
 * initial failure.
 *
 * - `fixed`       → the constant `delayMs` (Req 6.5).
 * - `linear`      → `min(baseMs * attempt, maxDelayMs)` (Req 6.4).
 * - `exponential` → `min(baseMs * multiplier^(attempt - 1), maxDelayMs)`, the
 *   exact @streetjs/queue formula (Req 6.3, 6.9).
 * - `jitter`      → `rng() * maxDelayMs`, a randomized value bounded by
 *   `maxDelayMs` (Req 6.6).
 *
 * `rng` defaults to `Math.random` and is injected in tests for determinism; it
 * is consulted only by the `jitter` strategy.
 *
 * @param policy  The resolved backoff strategy and its parameters.
 * @param attempt The 1-based attempt number the delay precedes.
 * @param rng     Random source in `[0, 1)`; defaults to `Math.random`.
 * @returns The delay in milliseconds, never exceeding the strategy's `maxDelayMs`.
 */
export function computeBackoff(
  policy: Backoff,
  attempt: number,
  rng: () => number = Math.random,
): number {
  switch (policy.strategy) {
    case "fixed":
      // Constant delay between every attempt (Req 6.5).
      return policy.delayMs;

    case "linear":
      // Grows linearly with the attempt number, capped at maxDelayMs (Req 6.4).
      return Math.min(policy.baseMs * attempt, policy.maxDelayMs);

    case "exponential": {
      // Mirrors @streetjs/queue: min(base * multiplier^(attempt - 1), maxDelay)
      // (Req 6.3, 6.9). attempt is 1-based, so the first retry uses exponent 0.
      const raw = policy.baseMs * policy.multiplier ** (attempt - 1);
      return Math.min(raw, policy.maxDelayMs);
    }

    case "jitter": {
      // A randomized value bounded by the configured maximum delay (Req 6.6).
      // rng() ∈ [0, 1) ⇒ result ∈ [0, maxDelayMs). Math.min guards against a
      // misbehaving rng that returns a value >= 1.
      return Math.min(rng() * policy.maxDelayMs, policy.maxDelayMs);
    }
  }
}
