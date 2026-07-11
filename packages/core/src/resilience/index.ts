// src/resilience/index.ts
// Consolidated resilience primitives (RFC 0004): one canonical home for
// exponential backoff, bounded retry, and the circuit breaker. Exposed publicly
// as the `streetjs/resilience` subpath. Existing call sites migrate to these
// behind their current tests so behavior is preserved.
//
// Dependency-free: pure control-flow over the standard library only.

/** A cancellable delay: resolves after `ms`, or rejects if `signal` aborts. */
export type DelayFn = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Exponential-backoff policy. `attempt` is 1-based. */
export interface BackoffPolicy {
  /** Delay before the first retry (attempt 1), in ms. Default 0. */
  baseDelayMs?: number;
  /** Growth factor per attempt. Default 2. */
  multiplier?: number;
  /** Upper bound on any single delay, in ms. Default Infinity. */
  maxDelayMs?: number;
}

/**
 * Compute the backoff delay (ms) to wait *before* retry number `attempt`
 * (1-based). Pure and total:
 *   `min((baseDelayMs) * (multiplier)^(attempt-1), maxDelayMs)`, clamped ≥ 0.
 */
export function computeBackoff(policy: BackoffPolicy, attempt: number): number {
  const base = policy.baseDelayMs ?? 0;
  const multiplier = policy.multiplier ?? 2;
  const cap = policy.maxDelayMs ?? Number.POSITIVE_INFINITY;
  const raw = base * Math.pow(multiplier, Math.max(0, attempt - 1));
  return Math.max(0, Math.min(raw, cap));
}

/** The default `setTimeout`-backed cancellable delay. */
export function defaultDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('delay cancelled'));
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('delay cancelled'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Options controlling {@link withRetry}. */
export interface WithRetryOptions {
  /** Maximum attempts (≥1). Default 3. */
  maxAttempts?: number;
  /** Backoff policy applied between attempts. */
  backoff?: BackoffPolicy;
  /** Predicate deciding whether an error is retryable; defaults to always. */
  isRetryable?: (err: unknown) => boolean;
  /** Injectable delay (for deterministic tests). Defaults to a real timer. */
  delay?: DelayFn;
  /** Optional deadline (epoch ms): stop retrying if the next delay would exceed it. */
  deadlineMs?: number;
  /** Signal forwarded to each attempt and to the delay. */
  signal?: AbortSignal;
}

/**
 * Invoke `fn` up to `maxAttempts` times, waiting {@link computeBackoff} between
 * attempts. A failure is retried only while attempts remain, `isRetryable(err)`
 * is true, and (if set) the next delay fits before `deadlineMs`. The last error
 * is thrown once attempts are exhausted.
 *
 * Guarantee: `fn` is invoked at most `maxAttempts` times (exactly once when
 * `maxAttempts === 1`, with no retry).
 */
export async function withRetry<T>(
  fn: (attempt: number, signal: AbortSignal) => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts ?? 3));
  const backoff = options.backoff ?? {};
  const isRetryable = options.isRetryable ?? ((): boolean => true);
  const delay = options.delay ?? defaultDelay;
  const signal = options.signal ?? new AbortController().signal;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt, signal);
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const waitMs = computeBackoff(backoff, attempt);
      if (options.deadlineMs !== undefined && Date.now() + waitMs >= options.deadlineMs) {
        throw err;
      }
      await delay(waitMs, signal);
    }
  }
  throw lastError;
}

// The circuit breaker's canonical home is here; the historical
// `microservices/circuit-breaker` path re-exports these for compatibility.
export {
  CircuitBreaker,
  CircuitOpenError,
} from '../microservices/circuit-breaker.js';
export type {
  CircuitState,
  CircuitBreakerOptions,
} from '../microservices/circuit-breaker.js';
