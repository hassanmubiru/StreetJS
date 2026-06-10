// tests/observability-subsystem-pack.test.ts
// Validates task 16.4 deliverables (Req 10.3/10.4/10.5): the PostgreSQL, Kafka,
// RabbitMQ, and Plugin Host dashboards; the latency/error-rate/queue-depth/
// memory-pressure alerts (numeric threshold + evaluation window each); and the
// SLO pack (availability, latency, error budget with numeric targets + windows).
//
// Crucially, it enforces the anti-fabrication guard (Req 10.1/10.7): every
// metric referenced by the full dashboard + rule pack must be an Exported
// Metric (the default HTTP/process metrics, the subsystem metrics, and the
// recording-rule outputs). No fabricated metrics are allowed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MetricsRegistry, prometheusMiddleware } from '../observability/prometheus.js';
import { registerSubsystemMetrics } from '../observability/subsystem-metrics.js';
import {
  streetRecordingRules, streetSubsystemAlertRules, streetSloObjectives, streetSloPack,
  streetRuleGroups, validatePrometheusRuleGroups, isAlertRule, type RecordingRule,
} from '../observability/prometheus-rules.js';
import {
  streetPostgresDashboard, streetKafkaDashboard, streetRabbitmqDashboard,
  streetPluginHostDashboard, streetDashboards, validateGrafanaDashboard,
} from '../observability/grafana-dashboard.js';
import { exportedMetricNames, validateMetricReferences } from '../observability/metric-references.js';

/** The full set of series the app exports: registry metrics + recording-rule outputs. */
function exportedSet(): Set<string> {
  const registry = new MetricsRegistry();
  prometheusMiddleware(registry); // http_requests_total, http_request_duration_seconds, process_heap_bytes
  registerSubsystemMetrics(registry); // db_*, kafka_*, rabbitmq_*, plugin_*
  const exported = exportedMetricNames(registry);
  // Recording-rule outputs are exported series too (used by alerts/dashboards).
  for (const r of streetRecordingRules().rules) {
    exported.add((r as RecordingRule).record);
  }
  // Prometheus built-in synthesized series (emitted per scrape target by
  // Prometheus itself, e.g. the StreetTargetDown `up == 0` alert) — these are
  // real, universally-available series, not fabricated app metrics.
  exported.add('up');
  return exported;
}

describe('observability — subsystem dashboards (Req 10.3)', () => {
  const dashboards = [
    streetPostgresDashboard(), streetKafkaDashboard(),
    streetRabbitmqDashboard(), streetPluginHostDashboard(),
  ];

  it('provides PostgreSQL, Kafka, RabbitMQ, and Plugin Host dashboards', () => {
    const uids = streetDashboards().map((d) => d.uid);
    assert.ok(uids.includes('street-postgres'));
    assert.ok(uids.includes('street-kafka'));
    assert.ok(uids.includes('street-rabbitmq'));
    assert.ok(uids.includes('street-plugin-host'));
    // HTTP dashboard remains (street-api).
    assert.ok(uids.includes('street-api'));
  });

  it('every subsystem dashboard is structurally valid', () => {
    for (const d of dashboards) {
      const r = validateGrafanaDashboard(d);
      assert.equal(r.valid, true, `${d.uid}: ${r.errors.join('; ')}`);
    }
  });
});

describe('observability — subsystem alerts (Req 10.4)', () => {
  it('covers latency, error rate, queue depth, and memory pressure', () => {
    const categories = streetSubsystemAlertRules().rules
      .filter(isAlertRule)
      .map((a) => a.labels['category']);
    for (const c of ['latency', 'error-rate', 'queue-depth', 'memory-pressure']) {
      assert.ok(categories.includes(c), `missing alert category ${c}`);
    }
  });

  it('each alert defines a numeric threshold and an evaluation window', () => {
    for (const a of streetSubsystemAlertRules().rules.filter(isAlertRule)) {
      // Numeric trigger threshold present in the expr.
      assert.match(a.expr, /[<>]=?\s*[\d.]+/, `${a.alert} lacks a numeric threshold`);
      // Evaluation window present.
      assert.match(a.for ?? '', /^\d+[smhdwy]$/, `${a.alert} lacks an evaluation window`);
    }
  });
});

describe('observability — SLO pack (Req 10.5)', () => {
  it('defines availability, latency, and error-budget objectives with numeric targets + windows', () => {
    const objectives = streetSloObjectives();
    for (const name of ['availability', 'latency', 'error-budget']) {
      const o = objectives.find((x) => x.name === name);
      assert.ok(o, `missing objective ${name}`);
      assert.equal(typeof o!.target, 'number');
      assert.match(o!.window, /^\d+[smhdwy]$/);
    }
  });

  it('the SLO pack rule group is structurally valid and includes the burn-rate alerts', () => {
    const pack = streetSloPack();
    const r = validatePrometheusRuleGroups([pack]);
    assert.equal(r.valid, true, r.errors.join('; '));
    const alerts = pack.rules.filter(isAlertRule).map((a) => a.alert);
    assert.ok(alerts.includes('StreetAvailabilitySloBreach'));
    assert.ok(alerts.includes('StreetLatencySloBreach'));
    assert.ok(alerts.includes('StreetErrorBudgetBurnFast'));
  });
});

describe('observability — anti-fabrication (Req 10.1/10.7)', () => {
  it('the full dashboard + rule pack references only exported metrics', () => {
    const exported = exportedSet();
    const violations = validateMetricReferences(exported, {
      dashboards: streetDashboards(),
      rules: streetRuleGroups(),
    });
    assert.deepEqual(violations, [], `fabricated metric references: ${JSON.stringify(violations)}`);
  });

  it('the complete rule pack passes structural validation', () => {
    const r = validatePrometheusRuleGroups(streetRuleGroups());
    assert.equal(r.valid, true, r.errors.join('; '));
  });
});
