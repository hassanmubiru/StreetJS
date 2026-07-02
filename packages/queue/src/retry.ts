// src/retry.ts
// @streetjs/queue — retry/backoff engine (Req 5.1–5.8).
//
// Decides retry-versus-dead-letter from the attempt ceiling and computes the
// next retry Due_Time from the backoff policy. The full computation (exponential
// `min(base * mult^(attempts-1), maxDelay)`, fixed, jitter, human-string
// durations via core `parseWindow`) is implemented in task 5.2; the signature
// below is the compiling scaffold the worker consults.

import type { Clock } from 'streetjs';
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
}

/**
 * Decide whether a failed envelope retries (with a computed Due_Time) or is
 * dead-lettered. Implemented in task 5.2.
 */
export function onFailure(
  envelope: JobEnvelope,
  error: SerializedError,
  options: JobOptions,
  engine: RetryEngineOptions,
): RetryDecision {
  throw new Error('retry.onFailure not implemented (task 5.2)');
}
