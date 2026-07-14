/**
 * Check normalization and execution.
 *
 * Depends on `types` and `timeout`.
 */

import type {
  CheckFunction,
  CheckKind,
  CheckOutcome,
  Clock,
  HealthCheckOptions,
} from './types.js';
import { withTimeout } from './timeout.js';

/** A validated, fully-defaulted check. */
export interface NormalizedCheck {
  readonly name: string;
  readonly check: CheckFunction;
  readonly kind: CheckKind;
  readonly critical: boolean;
  readonly timeoutMs: number;
}

const RESERVED_RESULT_KEYS = new Set(['status', 'output', 'observedValue', 'observedUnit']);
const DEFAULT_TIMEOUT_MS = 5000;

/** Validate and apply defaults to a check registration. */
export function normalizeCheck(options: HealthCheckOptions): NormalizedCheck {
  if (typeof options.name !== 'string' || options.name.length === 0) {
    throw new Error('Health check requires a non-empty name');
  }
  if (typeof options.check !== 'function') {
    throw new Error(`Health check ${JSON.stringify(options.name)} requires a check function`);
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!(timeoutMs > 0)) {
    throw new Error(`Health check ${JSON.stringify(options.name)} timeoutMs must be positive`);
  }
  return {
    name: options.name,
    check: options.check,
    kind: options.kind ?? 'readiness',
    critical: options.critical ?? true,
    timeoutMs,
  };
}

/**
 * Run a single check under its timeout, translating its return value or thrown
 * error into a {@link CheckOutcome}. Never throws.
 */
export async function runCheck(check: NormalizedCheck, clock: Clock): Promise<CheckOutcome> {
  const start = clock();
  const outcome: {
    status: CheckOutcome['status'];
    output?: string;
    observedValue?: number | string | boolean;
    observedUnit?: string;
    details?: Record<string, unknown>;
  } = { status: 'pass' };

  try {
    const result = await withTimeout(
      Promise.resolve().then(() => check.check()),
      check.timeoutMs,
    );
    if (result && typeof result === 'object') {
      outcome.status = result.status ?? 'pass';
      if (typeof result.output === 'string') {
        outcome.output = result.output;
      }
      if (result.observedValue !== undefined) {
        outcome.observedValue = result.observedValue;
      }
      if (typeof result.observedUnit === 'string') {
        outcome.observedUnit = result.observedUnit;
      }
      const extra: Record<string, unknown> = {};
      for (const key of Object.keys(result)) {
        if (!RESERVED_RESULT_KEYS.has(key)) {
          extra[key] = result[key];
        }
      }
      if (Object.keys(extra).length > 0) {
        outcome.details = extra;
      }
    }
  } catch (error) {
    outcome.status = 'fail';
    outcome.output = error instanceof Error ? error.message : String(error);
  }

  const end = clock();
  return {
    name: check.name,
    kind: check.kind,
    critical: check.critical,
    status: outcome.status,
    time: new Date(end).toISOString(),
    durationMs: end - start,
    output: outcome.output,
    observedValue: outcome.observedValue,
    observedUnit: outcome.observedUnit,
    details: outcome.details,
  };
}
