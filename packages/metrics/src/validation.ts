/**
 * Prometheus naming rules and label-key construction.
 *
 * Leaf module — depends only on `types`.
 */

import type { Labels } from './types.js';

const METRIC_NAME_RE = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const LABEL_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Validate a metric name, throwing a descriptive error when invalid. */
export function assertValidMetricName(name: string): void {
  if (typeof name !== 'string' || !METRIC_NAME_RE.test(name)) {
    throw new Error(
      `Invalid metric name ${JSON.stringify(name)}: must match ${METRIC_NAME_RE.source}`,
    );
  }
}

/** Validate a label name. Names beginning with `__` are reserved. */
export function assertValidLabelName(name: string): void {
  if (typeof name !== 'string' || !LABEL_NAME_RE.test(name)) {
    throw new Error(
      `Invalid label name ${JSON.stringify(name)}: must match ${LABEL_NAME_RE.source}`,
    );
  }
  if (name.startsWith('__')) {
    throw new Error(`Label name ${JSON.stringify(name)} is reserved (must not start with "__")`);
  }
}

/** Coerce a label value to its string representation. */
export function coerceLabelValue(value: string | number | boolean): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * Validate that `provided` supplies exactly the declared `labelNames` (no
 * missing, no extra), returning the coerced string label map.
 */
export function normalizeLabels(
  labelNames: readonly string[],
  provided: Labels,
): Record<string, string> {
  const keys = Object.keys(provided);
  if (keys.length !== labelNames.length) {
    throw new Error(
      `Expected labels [${labelNames.join(', ')}] but received [${keys.join(', ')}]`,
    );
  }
  const out: Record<string, string> = {};
  for (const name of labelNames) {
    if (!Object.prototype.hasOwnProperty.call(provided, name)) {
      throw new Error(`Missing value for label ${JSON.stringify(name)}`);
    }
    out[name] = coerceLabelValue(provided[name]);
  }
  return out;
}

/**
 * Build a deterministic series key from a normalized label map. Keys are sorted
 * so label order at the call site does not create distinct series.
 */
export function seriesKey(labels: Record<string, string>): string {
  const names = Object.keys(labels).sort();
  return names.map((n) => `${n}=${JSON.stringify(labels[n])}`).join(',');
}
