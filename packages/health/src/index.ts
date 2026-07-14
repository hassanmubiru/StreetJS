/**
 * @streetjs/health — the StreetJS health foundation.
 *
 * A framework-agnostic health-check registry: liveness/readiness/startup checks
 * with per-check timeouts, criticality, status aggregation, and IETF
 * `health+json` reporting. Zero runtime dependencies. Public API only.
 *
 * ```ts
 * import { HealthRegistry } from '@streetjs/health';
 *
 * const health = new HealthRegistry();
 * health.register({
 *   name: 'database',
 *   kind: 'readiness',
 *   check: async () => { await db.ping(); },
 * });
 *
 * const { statusCode, contentType, body } = await health.endpoint('readiness');
 * // serve statusCode (200/503) with Content-Type contentType and the JSON body
 * ```
 */

export { HealthRegistry, type RegisteredCheck, type HealthRegistryOptions } from './registry.js';
export { runCheck, normalizeCheck, type NormalizedCheck } from './check.js';
export { buildReport, toEndpointResponse, CONTENT_TYPE } from './report.js';
export { aggregate, worst, httpStatusFor } from './status.js';
export { withTimeout, TimeoutError } from './timeout.js';

export type {
  HealthStatus,
  CheckKind,
  CheckFunction,
  CheckResult,
  HealthCheckOptions,
  CheckOutcome,
  HealthReport,
  EndpointResponse,
  Clock,
} from './types.js';

/**
 * Dependency-injection token for a {@link HealthRegistry}.
 *
 * `@streetjs/health` depends on no container, so the token is a plain unique
 * symbol. Register a registry under this token and resolve it wherever checks
 * are added or health endpoints are served.
 */
export const HEALTH_REGISTRY: unique symbol = Symbol.for('@streetjs/health:Registry');
