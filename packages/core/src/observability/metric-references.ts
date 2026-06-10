// src/observability/metric-references.ts
//
// Advanced Observability — anti-fabrication guard (Req 10.1 / 10.7).
//
// Dashboards and alert/SLO rules may only reference metrics the application
// actually exports. This module makes that contract enforceable:
//
//   - `exportedMetricNames(registry)` — the set of series names a
//     `MetricsRegistry` actually emits via `/metrics` (histograms expand to
//     their `_bucket` / `_sum` / `_count` series).
//   - `referencedMetrics(assets)` — every metric name referenced by a
//     dashboard panel target or a Prometheus rule expression.
//   - `validateMetricReferences(exported, assets)` — the guard itself: returns
//     the offending `(metric, asset)` pairs where an asset references a metric
//     that is not in the exported set. An empty result means every referenced
//     metric is exported (so the observability assets reflect real signals,
//     never fabricated ones).
//
// PromQL is not fully parsed; instead a conservative extractor pulls metric
// identifiers out of expressions after stripping string literals, label
// matchers (`{...}`), range/subquery selectors (`[...]`), aggregation label
// lists (`by (...)`, `without (...)`, etc.), function calls, reserved words,
// and numeric literals. Recording-rule outputs are exported series too, so
// callers building the `exported` set should union the registry names with the
// `record:` names of any recording rules they emit.
//
// Zero runtime dependencies: Node core only.

import { Histogram, type MetricsRegistry } from './prometheus.js';
import type { GrafanaDashboard } from './grafana-dashboard.js';
import type { RuleGroup } from './prometheus-rules.js';

// ── Types ──────────────────────────────────────────────────────────────────

/** The observability assets whose metric references are checked. */
export interface ObservabilityAssets {
  dashboards: GrafanaDashboard[];
  rules: RuleGroup[];
}

/**
 * A single anti-fabrication violation: `asset` references `metric`, but the
 * application does not export `metric`. `asset` is prefixed with its kind
 * (`dashboard:<uid>` or `rulegroup:<name>`) so the offending source is
 * unambiguous.
 */
export interface MetricReferenceViolation {
  metric: string;
  asset: string;
}

// ── PromQL metric-name extraction ────────────────────────────────────────────

// A PromQL identifier / metric name: starts with a letter, `_`, or `:`
// (recording-rule outputs such as `job:http_error_rate:ratio5m` use `:`).
const IDENT = /[a-zA-Z_:][a-zA-Z0-9_:]*/g;

// Aggregation / matching modifiers whose parenthesised label lists must be
// discarded before scanning (their contents are label names, not metrics).
const MODIFIER_WITH_LABELS = /\b(?:by|without|on|ignoring|group_left|group_right)\s*\([^)]*\)/g;

// PromQL keywords / operators that are identifiers but never metric names.
const PROMQL_RESERVED = new Set<string>([
  'by', 'without', 'on', 'ignoring', 'group_left', 'group_right',
  'and', 'or', 'unless', 'offset', 'bool', 'default',
  'start', 'end', 'inf', 'nan', 'Inf', 'NaN',
]);

/**
 * Extract the set of metric names referenced by a single PromQL expression.
 * Conservative: function calls (identifier immediately followed by `(`),
 * reserved words, label names, durations, and numeric literals are excluded.
 */
export function extractMetricsFromExpr(expr: string): Set<string> {
  const out = new Set<string>();
  if (typeof expr !== 'string' || expr.trim() === '') return out;

  // 1. Strip string literals so their contents never leak in as identifiers.
  let s = expr
    .replace(/"(?:[^"\\]|\\.)*"/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, ' ')
    .replace(/`[^`]*`/g, ' ');

  // 2. Strip label matcher blocks `{ ... }` (label names + values).
  s = s.replace(/\{[^}]*\}/g, ' ');

  // 3. Strip range / subquery selectors `[ ... ]` (durations).
  s = s.replace(/\[[^\]]*\]/g, ' ');

  // 4. Strip aggregation / matching label lists: `by (le)`, `without (x)`, ...
  s = s.replace(MODIFIER_WITH_LABELS, ' ');

  // 5. Scan remaining identifiers.
  IDENT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IDENT.exec(s)) !== null) {
    const name = m[0];
    const after = s[IDENT.lastIndex] ?? '';
    const before = m.index > 0 ? s[m.index - 1] : '';

    // Identifier immediately followed by `(` is a function call, not a metric.
    if (after === '(') continue;
    // Identifier glued to a preceding digit / dot is part of a number literal
    // (e.g. the `e3` in `1e3`); not a metric.
    if ((before >= '0' && before <= '9') || before === '.') continue;
    if (PROMQL_RESERVED.has(name)) continue;

    out.add(name);
  }
  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * The set of metric series names a registry actually exports via `/metrics`.
 * Histograms expand to their `_bucket`, `_sum`, and `_count` series so that
 * expressions such as `http_request_duration_seconds_bucket` resolve.
 */
export function exportedMetricNames(registry: MetricsRegistry): Set<string> {
  const out = new Set<string>();
  for (const name of registry.names()) {
    out.add(name);
    if (registry.get(name) instanceof Histogram) {
      out.add(`${name}_bucket`);
      out.add(`${name}_sum`);
      out.add(`${name}_count`);
    }
  }
  return out;
}

/**
 * Every metric referenced by the given dashboards and rule groups. Walks every
 * dashboard panel target expression and every recording/alert rule expression.
 * Recording-rule outputs (the `record:` field) are definitions, not
 * references, so they are not included here.
 */
export function referencedMetrics(assets: ObservabilityAssets): Set<string> {
  const out = new Set<string>();
  for (const dashboard of assets.dashboards ?? []) {
    for (const panel of dashboard.panels ?? []) {
      for (const target of panel.targets ?? []) {
        for (const metric of extractMetricsFromExpr(target.expr)) out.add(metric);
      }
    }
  }
  for (const group of assets.rules ?? []) {
    for (const rule of group.rules ?? []) {
      for (const metric of extractMetricsFromExpr(rule.expr)) out.add(metric);
    }
  }
  return out;
}

/**
 * Anti-fabrication guard (Req 10.1 / 10.7): return the `(metric, asset)` pairs
 * where an asset references a metric that is not in `exported`. An empty result
 * means every referenced metric is exported. Each `(metric, asset)` pair is
 * reported at most once, even if the asset references the metric in several
 * panels or rules.
 */
export function validateMetricReferences(
  exported: Set<string>,
  assets: ObservabilityAssets,
): MetricReferenceViolation[] {
  const violations: MetricReferenceViolation[] = [];
  const seen = new Set<string>();

  const record = (metric: string, asset: string): void => {
    if (exported.has(metric)) return;
    const key = `${asset}\u0000${metric}`;
    if (seen.has(key)) return;
    seen.add(key);
    violations.push({ metric, asset });
  };

  for (const dashboard of assets.dashboards ?? []) {
    const asset = `dashboard:${dashboard.uid || dashboard.title || '(unknown)'}`;
    for (const panel of dashboard.panels ?? []) {
      for (const target of panel.targets ?? []) {
        for (const metric of extractMetricsFromExpr(target.expr)) record(metric, asset);
      }
    }
  }

  for (const group of assets.rules ?? []) {
    const asset = `rulegroup:${group.name || '(unknown)'}`;
    for (const rule of group.rules ?? []) {
      for (const metric of extractMetricsFromExpr(rule.expr)) record(metric, asset);
    }
  }

  return violations;
}
