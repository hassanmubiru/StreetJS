/**
 * Retry policy defaults and decision logic.
 *
 * Depends on `types` only.
 */

import type { HttpMethod, RetryPolicy } from './types.js';

/** The default retry policy: idempotent methods, standard retriable statuses. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  retries: 2,
  methods: ['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE'],
  statuses: [408, 429, 500, 502, 503, 504],
  baseDelayMs: 100,
  maxDelayMs: 2000,
  jitter: true,
  respectRetryAfter: true,
};

/** Merge overrides onto the default policy. */
export function resolveRetryPolicy(overrides?: Partial<RetryPolicy>): RetryPolicy {
  return { ...DEFAULT_RETRY_POLICY, ...(overrides ?? {}) };
}

/** True when a method is eligible for retries under `policy`. */
export function isRetriableMethod(method: HttpMethod, policy: RetryPolicy): boolean {
  return policy.methods.includes(method);
}

/** True when a response status should trigger a retry. */
export function isRetriableStatus(status: number, policy: RetryPolicy): boolean {
  return policy.statuses.includes(status);
}

/**
 * Compute the backoff for a zero-based attempt index: `base * 2^attempt`,
 * capped at `maxDelayMs`, optionally with jitter in `[0, delay)`.
 *
 * @param random injectable RNG for deterministic tests (default `Math.random`).
 */
export function computeBackoff(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const raw = policy.baseDelayMs * 2 ** attempt;
  const capped = Math.min(raw, policy.maxDelayMs);
  if (!policy.jitter) {
    return capped;
  }
  return Math.floor(capped * random());
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds
 * from `now`, or `undefined` when absent/unparseable/negative.
 */
export function parseRetryAfter(value: string | undefined, now: number): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) {
    return undefined;
  }
  const delta = dateMs - now;
  return delta >= 0 ? delta : undefined;
}
