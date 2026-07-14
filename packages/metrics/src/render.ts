/**
 * Prometheus text exposition rendering helpers: value formatting and the
 * escaping rules for HELP text and label values.
 *
 * Leaf module — depends only on `types`.
 */

import type { MetricSnapshot, Sample } from './types.js';

/** The exposition format content type (version 0.0.4). */
export const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

/** Format a numeric value the way Prometheus expects (handling non-finite values). */
export function formatValue(value: number): string {
  if (Number.isNaN(value)) {
    return 'NaN';
  }
  if (value === Infinity) {
    return '+Inf';
  }
  if (value === -Infinity) {
    return '-Inf';
  }
  return String(value);
}

/** Escape `# HELP` text: backslash and newline. */
export function escapeHelp(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

/** Escape a label value: backslash, double-quote, and newline. */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function renderLabels(labels: Readonly<Record<string, string>>): string {
  const keys = Object.keys(labels);
  if (keys.length === 0) {
    return '';
  }
  const parts = keys.map((k) => `${k}="${escapeLabelValue(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

/** Render a single sample line (without a trailing newline). */
export function renderSample(sample: Sample): string {
  return `${sample.name}${renderLabels(sample.labels)} ${formatValue(sample.value)}`;
}

/** Render one metric's `# HELP`/`# TYPE` header plus all its sample lines. */
export function renderSnapshot(snapshot: MetricSnapshot): string {
  const lines = [
    `# HELP ${snapshot.name} ${escapeHelp(snapshot.help)}`,
    `# TYPE ${snapshot.name} ${snapshot.type}`,
  ];
  for (const sample of snapshot.samples) {
    lines.push(renderSample(sample));
  }
  return lines.join('\n');
}
