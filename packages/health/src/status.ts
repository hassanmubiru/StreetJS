/**
 * Status ordering, aggregation, and HTTP mapping.
 *
 * Leaf module — depends only on `types`.
 */

import type { CheckOutcome, HealthStatus } from './types.js';

const SEVERITY: Readonly<Record<HealthStatus, number>> = { pass: 0, warn: 1, fail: 2 };

/** Return the more severe of two statuses. */
export function worst(a: HealthStatus, b: HealthStatus): HealthStatus {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/**
 * Aggregate outcomes into an overall status.
 *
 * A failing **critical** check makes the whole report `fail`; a failing
 * **non-critical** check degrades it only to `warn`. `warn` outcomes always
 * degrade to at least `warn`. An empty set is `pass`.
 */
export function aggregate(outcomes: readonly CheckOutcome[]): HealthStatus {
  let overall: HealthStatus = 'pass';
  for (const outcome of outcomes) {
    if (outcome.status === 'fail') {
      overall = worst(overall, outcome.critical ? 'fail' : 'warn');
    } else {
      overall = worst(overall, outcome.status);
    }
  }
  return overall;
}

/** Map an overall status to an HTTP status code: `fail` → 503, otherwise 200. */
export function httpStatusFor(status: HealthStatus): number {
  return status === 'fail' ? 503 : 200;
}
