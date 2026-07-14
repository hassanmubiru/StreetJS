/**
 * Report assembly and HTTP endpoint mapping (IETF health+json).
 *
 * Depends on `types` and `status`.
 */

import type { CheckOutcome, EndpointResponse, HealthReport } from './types.js';
import { aggregate, httpStatusFor } from './status.js';

/** The IETF media type for health reports. */
export const CONTENT_TYPE = 'application/health+json';

/** Group outcomes by component name and compute the overall status. */
export function buildReport(outcomes: readonly CheckOutcome[], time: string): HealthReport {
  const checks: Record<string, CheckOutcome[]> = {};
  for (const outcome of outcomes) {
    (checks[outcome.name] ??= []).push(outcome);
  }
  return { status: aggregate(outcomes), time, checks };
}

/** Derive a transport-agnostic HTTP response from a report. */
export function toEndpointResponse(report: HealthReport): EndpointResponse {
  return {
    statusCode: httpStatusFor(report.status),
    contentType: CONTENT_TYPE,
    body: JSON.stringify(report),
    report,
  };
}
