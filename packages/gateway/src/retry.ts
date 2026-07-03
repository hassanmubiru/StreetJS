/**
 * @streetjs/gateway — retry, timeout, and backoff primitives.
 *
 * Small, dependency-light building blocks the proxy composes to make an
 * upstream forward resilient:
 *
 *  - {@link computeRetryDelay} — a pure exponential-backoff delay calculator.
 *  - {@link withTimeout} — races a task against a deadline, aborting on timeout.
 *  - {@link runWithRetry} — re-invokes a task per a {@link RetryPolicy}.
 *
 * Every time-based operation is expressed through an injectable `delay`
 * function so tests can drive them deterministically (no real waiting).
 */

import type { RetryPolicy } from "./types.js";
import { UpstreamTimeoutError } from "./errors.js";

/** A cancellable delay: resolves after `ms`, or rejects if `signal` aborts. */
export type DelayFn = (ms: number, signal?: AbortSignal) => Promise<void>;

/**
 * The default `setTimeout`-backed cancellable delay. Resolves after `ms`
 * milliseconds; if `signal` aborts first the pending timer is cleared and the
 * returned promise rejects so callers can stop waiting immediately.
 */
export function defaultDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("delay cancelled"));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("delay cancelled"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Compute the backoff delay (ms) to wait *before* retry number `attempt`.
 *
 * Pure and total: `min((baseDelayMs ?? 0) * (multiplier ?? 2)^(attempt-1),
 * maxDelayMs ?? Infinity)`, clamped to be non-negative. `attempt` is 1-based —
 * `attempt === 1` is the delay before the first retry.
 */
export function computeRetryDelay(policy: RetryPolicy, attempt: number): number {
  const base = policy.baseDelayMs ?? 0;
  const multiplier = policy.multiplier ?? 2;
  const cap = policy.maxDelayMs ?? Number.POSITIVE_INFINITY;
  const exponent = attempt - 1;
  const raw = base * Math.pow(multiplier, exponent);
  const capped = Math.min(raw, cap);
  return Math.max(0, capped);
}

/**
 * Race `fn` against a `timeoutMs` deadline.
 *
 * `fn` receives an {@link AbortSignal} that is aborted when the deadline
 * elapses; on timeout an {@link UpstreamTimeoutError} is thrown. When `fn`
 * settles first its result (value or error) propagates and the pending timer is
 * cancelled. The timer uses an injectable `delay` so tests are deterministic.
 *
 * The timeout error is raised *before* the signal is aborted so it deterministically
 * wins the race even when aborting synchronously settles `fn`.
 */
export async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  options?: { delay?: DelayFn },
): Promise<T> {
  const delay = options?.delay ?? defaultDelay;
  const controller = new AbortController();
  const timerController = new AbortController();
  let settled = false;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    delay(timeoutMs, timerController.signal).then(
      () => {
        if (settled) return;
        settled = true;
        // Reject first so the timeout outcome wins the race even if aborting
        // the signal synchronously settles `fn`.
        reject(new UpstreamTimeoutError(timeoutMs));
        controller.abort();
      },
      () => {
        // The timer was cancelled (fn won the race); nothing to do.
      },
    );
  });

  try {
    const value = await Promise.race([fn(controller.signal), timeoutPromise]);
    settled = true;
    return value;
  } finally {
    // Cancel the pending timer when `fn` settles first.
    timerController.abort();
  }
}

/** Options controlling a {@link runWithRetry} invocation. */
export interface RunWithRetryOptions {
  /** The request method, matched against {@link RetryPolicy.retryMethods}. */
  readonly method?: string;
  /** Injectable backoff delay; defaults to a real `setTimeout` delay. */
  readonly delay?: (ms: number) => Promise<void>;
  /** Signal forwarded to each attempt. */
  readonly signal?: AbortSignal;
  /** Predicate deciding whether an error is retryable; defaults to always. */
  readonly isRetryable?: (err: unknown) => boolean;
}

/**
 * Invoke `attempt` up to `policy.maxAttempts` times.
 *
 * Between attempts it waits {@link computeRetryDelay}. A failure is only retried
 * when the method is permitted (`policy.retryMethods` unset, or the method is
 * listed) *and* `isRetryable(err)` returns true. The last error is thrown once
 * attempts are exhausted.
 *
 * Guarantee: `attempt` is invoked at most `maxAttempts` times — with
 * `maxAttempts === 1` exactly once, with no retry.
 */
export async function runWithRetry<T>(
  attempt: (n: number, signal: AbortSignal) => Promise<T>,
  policy: RetryPolicy,
  options?: RunWithRetryOptions,
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(policy.maxAttempts));
  const delay = options?.delay ?? ((ms: number) => defaultDelay(ms));
  const isRetryable = options?.isRetryable ?? ((): boolean => true);
  const method = options?.method;
  const signal = options?.signal ?? new AbortController().signal;

  const methodAllowed =
    policy.retryMethods === undefined ||
    (method !== undefined &&
      policy.retryMethods.some((m) => m.toUpperCase() === method.toUpperCase()));

  let lastError: unknown;
  for (let n = 1; n <= maxAttempts; n++) {
    try {
      return await attempt(n, signal);
    } catch (err) {
      lastError = err;
      const isLastAttempt = n >= maxAttempts;
      if (isLastAttempt || !methodAllowed || !isRetryable(err)) {
        throw err;
      }
      await delay(computeRetryDelay(policy, n));
    }
  }
  throw lastError;
}
