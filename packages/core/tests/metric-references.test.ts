// tests/metric-references.test.ts
// Unit tests for the Advanced Observability anti-fabrication guard
// (exportedMetricNames / referencedMetrics / validateMetricReferences).
// Real implementations, no mocks (Req 10.1 / 10.7).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { MetricsRegistry } from '../src/observability/prometheus.js';
import type { GrafanaDashboard } from '../src/observability/grafana-dashboard.js';
import type { RuleGroup } from '../src/observability/prometheus-rules.js';
import {
  exportedMetricNames,
  referencedMetrics,
  validateMetricReferences,
  extractMetricsFromExpr,
} from '../src/observability/metric-references.js';

function dashboard(uid: string, exprs: string[]): GrafanaDashboard {
  return {
    uid,
    title: uid,
    schemaVersion: 39,
    version: 1,
    tags: [],
    timezone: 'browser',
    refresh: '30s',
    panels: exprs.map((expr, i) => ({
      id: i + 1,
      title: `p${i + 1}`,
      type: 'timeseries',
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
      targets: [{ expr, refId: 'A' }],
    })),
  };
}

describe('extractMetricsFromExpr', () => {
  it('pulls the bare metric out of a simple comparison', () => {
    assert.deepEqual([...extractMetricsFromExpr('process_heap_bytes > 536870912')], ['process_heap_bytes']);
  });

  it('ignores function names, durations, labels, and numeric literals', () => {
    const m = extractMetricsFromExpr(
      'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
    );
    assert.deepEqual([...m], ['http_request_duration_seconds_bucket']);
  });

  it('ignores string label values inside matchers', () => {
    const m = extractMetricsFromExpr(
      'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
    );
    assert.deepEqual([...m], ['http_requests_total']);
  });

  it('captures recording-rule output names that contain colons', () => {
    assert.deepEqual([...extractMetricsFromExpr('job:http_error_rate:ratio5m > 0.05')], ['job:http_error_rate:ratio5m']);
  });

  it('returns an empty set for empty/whitespace expressions', () => {
    assert.equal(extractMetricsFromExpr('').size, 0);
    assert.equal(extractMetricsFromExpr('   ').size, 0);
  });
});

describe('exportedMetricNames', () => {
  it('includes registered metric names and expands histograms to _bucket/_sum/_count', () => {
    const reg = new MetricsRegistry();
    reg.counter('http_requests_total', 'requests', ['status']);
    reg.gauge('process_heap_bytes', 'heap');
    reg.histogram('http_request_duration_seconds', 'latency', [0.1, 1]);

    const exported = exportedMetricNames(reg);
    assert.ok(exported.has('http_requests_total'));
    assert.ok(exported.has('process_heap_bytes'));
    assert.ok(exported.has('http_request_duration_seconds'));
    assert.ok(exported.has('http_request_duration_seconds_bucket'));
    assert.ok(exported.has('http_request_duration_seconds_sum'));
    assert.ok(exported.has('http_request_duration_seconds_count'));
    // Non-histograms are not expanded.
    assert.ok(!exported.has('http_requests_total_bucket'));
  });
});

describe('referencedMetrics', () => {
  it('unions metric references across dashboards and rule groups', () => {
    const dashboards = [dashboard('d1', ['process_heap_bytes', 'kafka_consumer_lag'])];
    const rules: RuleGroup[] = [
      { name: 'g1', rules: [{ record: 'job:rate', expr: 'sum(rate(http_requests_total[5m]))' }] },
    ];
    const refs = referencedMetrics({ dashboards, rules });
    assert.deepEqual(
      [...refs].sort(),
      ['http_requests_total', 'kafka_consumer_lag', 'process_heap_bytes'],
    );
  });
});

describe('validateMetricReferences', () => {
  it('returns no violations when every referenced metric is exported', () => {
    const exported = new Set(['process_heap_bytes', 'http_requests_total']);
    const dashboards = [dashboard('d1', ['process_heap_bytes'])];
    const rules: RuleGroup[] = [
      { name: 'g1', rules: [{ alert: 'A', expr: 'http_requests_total > 0', labels: { severity: 'warning' }, annotations: { summary: 's' } }] },
    ];
    assert.deepEqual(validateMetricReferences(exported, { dashboards, rules }), []);
  });

  it('reports the offending (metric, asset) pair for a fabricated dashboard metric', () => {
    const exported = new Set(['process_heap_bytes']);
    const dashboards = [dashboard('runtime', ['fabricated_metric_total'])];
    const violations = validateMetricReferences(exported, { dashboards, rules: [] });
    assert.deepEqual(violations, [{ metric: 'fabricated_metric_total', asset: 'dashboard:runtime' }]);
  });

  it('reports the offending (metric, asset) pair for a fabricated rule metric', () => {
    const exported = new Set<string>();
    const rules: RuleGroup[] = [
      { name: 'bad-group', rules: [{ record: 'job:x', expr: 'sum(rate(ghost_total[5m]))' }] },
    ];
    const violations = validateMetricReferences(exported, { dashboards: [], rules });
    assert.deepEqual(violations, [{ metric: 'ghost_total', asset: 'rulegroup:bad-group' }]);
  });

  it('deduplicates a (metric, asset) pair referenced in multiple panels', () => {
    const exported = new Set<string>();
    const dashboards = [dashboard('d1', ['ghost', 'ghost'])];
    const violations = validateMetricReferences(exported, { dashboards, rules: [] });
    assert.deepEqual(violations, [{ metric: 'ghost', asset: 'dashboard:d1' }]);
  });
});
