// src/retry.ts
// @streetjs/queue — retry/backoff engine (Req 5.1–5.8).
//
// Decides retry-versus-dead-letter from the attempt ceiling and computes the
// next retry Due_Time from the backoff policy. Mirrors the *verified* core
// `JobQueue` backoff (`min(initialDelayMs * mult^attempt, maxDelayMs)`), extended
// with an optional jitter fraction and human-string durations parsed via the
// reused core `parseWindow`.
//
// See design.md → "Algorithmic pseudocode → Retry / backoff engine" (source of
// truth). The engine is pure: given an envelope (whose `attempts` has already
// been incremented by the worker at reserve time), a failure, the resolved
// options, and the injected clock, it returns a discriminated `RetryDecision`.

import { parseWindow, type Clock } from 'streetjs';
import type { BackoffPolicy, JobEnvelope, JobOptions, SerializedError } from './job.js';

/** The outcome of consulting the retry engine after a failed attempt. */
export type RetryDecision =
  | { readonly kind: 'retry'; readonly runAt: number }
  | { readonly kind: 'dead-letter' };

export interface RetryEngineOptions {
  /** Default backoff applied when a job/dispatch omits one. */
  defaultBackoff?: BackoffPolicy;
  /** Injected clock for deterministic timing in tests. */
  clock: Clock;
  /**
   * Injectable random source for jitter, in `[0, 1)`. Defaults to `Math.random`.
   * Exposed so jitter can be made deterministic in tests. Only consulted when a
   * backoff policy specifies a non-zero `jitter` fraction; a `jitter` of 0 (or
   * omitted) yields the computed delay regardless of this source.
   */
  rng?: () => number;
}

/**
 * The built-in default backoff used when neither the dispatch options, the
 * envelope, nor the engine's `defaultBackoff` supplies one: exponential, 1s
 * base, x2 multiplier, capped at 30s (design "Default: exponential 1s x2 cap 30s").
 */
export const DEFAULT_BACKOFF: BackoffPolicy = {
  strategy: 'exponential',
  delay: 1000,
  multiplier: 2,
  maxDelay: 30_000,
};

/** Resolve a `number | string` duration to milliseconds, parsing human strings. */
function parseDuration(duration: number | string): number {
  return typeof duration === 'number' ? duration : parseWindow(duration);
}

/**
 * Apply the jitter fraction to a computed delay. The result lies in
 * `[capped*(1-j), capped*(1+j)]` for a fraction `j` in `[0, 1]`.
 *
 * The SAME computation is used for every fraction, including 0 and `undefined`:
 * when the fraction is 0 the multiplicative factor collapses to exactly 1, so
 * the returned delay equals the computed delay deterministically — no
 * special-casing (Req 5.7).
 */
function applyJitter(capped: number, jitter: number | undefined, rng: () => number): number {
  const fraction = jitter ?? 0;
  // factor ∈ [1 - fraction, 1 + fraction]; collapses to 1 when fraction is 0.
  const factor = 1 + (2 * rng() - 1) * fraction;
  return capped * factor;
}

/**
 * Compute the backoff delay (in ms) for a failed attempt from the resolved
 * backoff policy. `exponential` uses `min(base * multiplier^(attempts-1), maxDelay)`
 * with `multiplier >= 1`; `fixed` uses a constant `base`. Jitter (if any) is
 * applied after capping, matching the design pseudocode.
 */
export function computeBackoffDelay(
  attempts: number,
  backoff: BackoffPolicy,
  rng: () => number = Math.random,
): number {
  const base = parseDuration(backoff.delay);

  let raw: number;
  if (backoff.strategy === 'exponential') {
    // `attempts` is 1-based (incremented at reserve); the first retry uses
    // exponent 0 so `raw = base` (mirrors the core JobQueue).
    const multiplier = backoff.multiplier ?? 2;
    raw = base * multiplier ** (attempts - 1);
  } else {
    raw = base;
  }

  const capped = backoff.maxDelay !== undefined ? Math.min(raw, parseDuration(backoff.maxDelay)) : raw;

  return applyJitter(capped, backoff.jitter, rng);
}

/**
 * Decide whether a failed envelope retries (with a computed Due_Time) or is
 * dead-lettered.
 *
 * Dead-letters when the consumed `attempts` has reached the attempt ceiling
 * (`attempts >= maxAttempts`, Req 6.1/6.2/Property 3). Otherwise computes the
 * backoff delay (Req 5.2/5.3) and returns a retry whose Due_Time is the failure
 * time plus the delay (`runAt = clock() + delay`, Req 5.1/5.4). Backoff
 * precedence: dispatch `options.backoff`, else the resolved envelope backoff,
 * else the engine's `defaultBackoff`, else {@link DEFAULT_BACKOFF}.
 *
 * @param envelope The failed envelope (its `attempts` was incremented at reserve).
 * @param error    The serialized failure (unused by the decision; kept for parity
 *                 with the worker call site and future policy hooks).
 * @param options  Resolved dispatch options; `options.backoff` takes precedence.
 * @param engine   Engine wiring: injected clock, optional default backoff, rng.
 */
export function onFailure(
  envelope: JobEnvelope,
  error: SerializedError,
  options: JobOptions,
  engine: RetryEngineOptions,
): RetryDecision {
  // The reserve step increments `attempts` before execution, so a failed
  // envelope always has attempts >= 1.
  if (envelope.attempts >= envelope.maxAttempts) {
    return { kind: 'dead-letter' };
  }

  const backoff = options.backoff ?? envelope.backoff ?? engine.defaultBackoff ?? DEFAULT_BACKOFF;
  const rng = engine.rng ?? Math.random;
  const delay = computeBackoffDelay(envelope.attempts, backoff, rng);

  return { kind: 'retry', runAt: engine.clock() + delay };
}
