// tests/observability-pack.test.ts
// Validates the observability pack: default Prometheus recording/alert/SLO
// burn-rate rule groups, the rule validator (positive + negative), the YAML
// serializer round-trip shape, and the Grafana dashboard model + validator.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  streetRecordingRules, streetAlertRules, streetSloBurnRateRules, streetRuleGroups,
  validatePrometheusRuleGroups, serializePrometheusRulesYaml, isAlertRule,
  type RuleGroup,
} from '../observability/prometheus-rules.js';
import { streetApiDashboard, validateGrafanaDashboard } from '../observability/grafana-dashboard.js';

describe('observability — Prometheus rules (defaults valid)', () => {
  it('default rule groups pass validation', () => {
    const r = validatePrometheusRuleGroups(streetRuleGroups());
    assert.equal(r.valid, true, r.errors.join('; '));
  });

  it('recording rules reference the real emitted metrics', () => {
    const rec = streetRecordingRules();
    const exprs = rec.rules.map((x) => x.expr).join(' ');
    assert.match(exprs, /http_requests_total/);
    assert.match(exprs, /http_request_duration_seconds_bucket/);
    assert.match(exprs, /histogram_quantile\(0\.95/);
  });

  it('alerts carry severity labels and summary annotations', () => {
    for (const rule of streetAlertRules().rules) {
      assert.ok(isAlertRule(rule));
      if (isAlertRule(rule)) {
        assert.ok(rule.labels['severity'], `${rule.alert} severity`);
        assert.ok(rule.annotations['summary'], `${rule.alert} summary`);
      }
    }
  });

  it('SLO burn-rate alerts are multi-window and reference the budget', () => {
    const slo = streetSloBurnRateRules();
    const fast = slo.rules.find((r) => isAlertRule(r) && r.alert === 'StreetErrorBudgetBurnFast');
    assert.ok(fast && isAlertRule(fast));
    assert.match(fast.expr, /\[1h\]/);
    assert.match(fast.expr, /\[5m\]/);
    assert.equal(fast.labels['severity'], 'critical');
  });
});

describe('observability — Prometheus rule validator (negatives)', () => {
  it('rejects empty input', () => {
    assert.equal(validatePrometheusRuleGroups([]).valid, false);
  });
  it('rejects a rule that is both record and alert', () => {
    const bad: RuleGroup[] = [{ name: 'g', rules: [{ record: 'x', alert: 'y', expr: 'up', labels: { severity: 'warning' }, annotations: { summary: 's' } } as never] }];
    assert.equal(validatePrometheusRuleGroups(bad).valid, false);
  });
  it('rejects an alert missing severity/summary and an empty expr', () => {
    const bad: RuleGroup[] = [{ name: 'g', rules: [{ alert: 'A', expr: '', labels: {}, annotations: {} }] }];
    const r = validatePrometheusRuleGroups(bad);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /empty expr/);
    assert.match(r.errors.join(';'), /severity/);
  });
  it('rejects duplicate group names and bad durations', () => {
    const bad: RuleGroup[] = [
      { name: 'dup', rules: [{ record: 'r', expr: 'up' }] },
      { name: 'dup', interval: '30x', rules: [{ record: 'r2', expr: 'up' }] },
    ];
    const r = validatePrometheusRuleGroups(bad);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /duplicate group/);
    assert.match(r.errors.join(';'), /invalid interval/);
  });
});

describe('observability — YAML serialization', () => {
  it('emits a groups document containing records, alerts, labels and annotations', () => {
    const yaml = serializePrometheusRulesYaml(streetRuleGroups());
    assert.match(yaml, /^groups:/);
    assert.match(yaml, /- name: street-http-recording/);
    assert.match(yaml, /record: "job:http_request_rate:rate5m"/);
    assert.match(yaml, /alert: StreetHighErrorRate/);
    assert.match(yaml, /severity: warning/);
    assert.match(yaml, /summary:/);
    // expr containing ':' and quotes must be quoted.
    assert.match(yaml, /expr: "sum\(rate\(http_requests_total\{status=~/);
  });
});

describe('observability — Grafana dashboard', () => {
  it('default dashboard validates and targets the recording rules', () => {
    const d = streetApiDashboard();
    const r = validateGrafanaDashboard(d);
    assert.equal(r.valid, true, r.errors.join('; '));
    assert.equal(d.uid, 'street-api');
    assert.equal(d.panels.length, 4);
    const exprs = d.panels.flatMap((p) => p.targets.map((t) => t.expr));
    assert.ok(exprs.includes('job:http_error_rate:ratio5m'));
    assert.ok(exprs.includes('job:http_request_latency:p99'));
  });
  it('rejects malformed dashboards', () => {
    assert.equal(validateGrafanaDashboard(null).valid, false);
    assert.equal(validateGrafanaDashboard({ uid: 'x', title: 't', schemaVersion: 1, panels: [] }).valid, false);
    const r = validateGrafanaDashboard({ uid: 'x', title: 't', schemaVersion: 1, panels: [{ id: 1, title: 'p', type: 'timeseries', gridPos: { x: 0, y: 0, w: 1, h: 1 }, targets: [{ expr: '', refId: 'A' }] }] });
    assert.equal(r.valid, false);
    assert.match(r.errors.join(';'), /empty expr/);
  });
});
