/**
 * Public types for @streetjs/health.
 *
 * Interface-first: checks and the registry are described here so applications
 * can substitute their own implementations and wire everything through DI.
 */

/** Per IETF health-check: `pass` (healthy), `warn` (degraded), `fail` (unhealthy). */
export type HealthStatus = 'pass' | 'warn' | 'fail';

/** Which probe a check participates in. */
export type CheckKind = 'liveness' | 'readiness' | 'startup';

/** Injectable clock returning epoch milliseconds. */
export type Clock = () => number;

/**
 * The value a check function may return. Returning nothing (or a result with no
 * `status`) is treated as `pass`; throwing is treated as `fail`.
 */
export interface CheckResult {
  status?: HealthStatus;
  /** Human-readable detail (e.g. an error message or measurement note). */
  output?: string;
  /** A measured value (e.g. latency, free connections). */
  observedValue?: number | string | boolean;
  /** Unit for `observedValue` (e.g. `ms`, `connections`). */
  observedUnit?: string;
  /** Any additional component-specific fields. */
  [key: string]: unknown;
}

/** A check implementation. May be sync or async. */
export type CheckFunction = () => void | CheckResult | Promise<void | CheckResult>;

/** Registration options for a single health check. */
export interface HealthCheckOptions {
  /** Unique component name (IETF `checks` key). */
  readonly name: string;
  /** The check implementation. */
  readonly check: CheckFunction;
  /** Probe this check belongs to. Default `"readiness"`. */
  readonly kind?: CheckKind;
  /** When `false`, a failure degrades overall status to `warn` instead of `fail`. Default `true`. */
  readonly critical?: boolean;
  /** Per-check timeout in milliseconds. Default `5000`. */
  readonly timeoutMs?: number;
}

/** The evaluated result of one check. */
export interface CheckOutcome {
  readonly name: string;
  readonly kind: CheckKind;
  readonly critical: boolean;
  readonly status: HealthStatus;
  /** ISO-8601 timestamp when the check completed. */
  readonly time: string;
  readonly durationMs: number;
  readonly output?: string;
  readonly observedValue?: number | string | boolean;
  readonly observedUnit?: string;
  /** Extra component-specific fields returned by the check. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** An aggregated report in IETF `health+json` shape. */
export interface HealthReport {
  readonly status: HealthStatus;
  readonly time: string;
  /** Outcomes grouped by component name. */
  readonly checks: Readonly<Record<string, readonly CheckOutcome[]>>;
}

/** A transport-agnostic HTTP response derived from a report. */
export interface EndpointResponse {
  /** `200` when serving (pass/warn) or `503` when unhealthy (fail). */
  readonly statusCode: number;
  /** `application/health+json`. */
  readonly contentType: string;
  /** JSON-serialized {@link HealthReport}. */
  readonly body: string;
  /** The structured report. */
  readonly report: HealthReport;
}
