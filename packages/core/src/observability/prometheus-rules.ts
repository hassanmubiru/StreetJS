// src/observability/prometheus-rules.ts
// Prometheus recording rules, alert rules, and multi-window SLO burn-rate alerts
// for the metrics Street emits by default (http_requests_total,
// http_request_duration_seconds). Includes a structural/semantic validator and a
// dependency-free YAML serializer so the rule files can be emitted and checked
// offline. (promtool performs the final semantic check in CI.)

export interface RecordingRule { record: string; expr: string; labels?: Record<string, string>; }
export interface AlertRule {
  alert: string; expr: string; for?: string;
  labels: Record<string, string>; annotations: Record<string, string>;
}
export type PromRule = RecordingRule | AlertRule;
export interface RuleGroup { name: string; interval?: string; rules: PromRule[]; }

export function isAlertRule(r: PromRule): r is AlertRule {
  return typeof (r as AlertRule).alert === 'string';
}

// ── Default rule sets ─────────────────────────────────────────────────────────

/** Recording rules: request rate, error ratio, and p95/p99 latency. */
export function streetRecordingRules(): RuleGroup {
  return {
    name: 'street-http-recording',
    interval: '30s',
    rules: [
      { record: 'job:http_request_rate:rate5m', expr: 'sum(rate(http_requests_total[5m]))' },
      {
        record: 'job:http_error_rate:ratio5m',
        expr: 'sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))',
      },
      {
        record: 'job:http_request_latency:p95',
        expr: 'histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
      },
      {
        record: 'job:http_request_latency:p99',
        expr: 'histogram_quantile(0.99, sum(rate(http_request_duration_seconds_bucket[5m])) by (le))',
      },
    ],
  };
}

/** Operational alerts: error rate, latency, and target liveness. */
export function streetAlertRules(): RuleGroup {
  return {
    name: 'street-http-alerts',
    rules: [
      {
        alert: 'StreetHighErrorRate', expr: 'job:http_error_rate:ratio5m > 0.05', for: '5m',
        labels: { severity: 'warning' },
        annotations: { summary: 'Elevated 5xx error ratio', description: 'HTTP 5xx ratio above 5% for 5m.' },
      },
      {
        alert: 'StreetHighLatencyP99', expr: 'job:http_request_latency:p99 > 1', for: '10m',
        labels: { severity: 'warning' },
        annotations: { summary: 'High p99 latency', description: 'p99 request latency above 1s for 10m.' },
      },
      {
        alert: 'StreetTargetDown', expr: 'up == 0', for: '1m',
        labels: { severity: 'critical' },
        annotations: { summary: 'Target down', description: 'A scrape target has been unreachable for 1m.' },
      },
    ],
  };
}

/**
 * Multi-window, multi-burn-rate SLO alerts for a 99.9% availability objective
 * (0.1% error budget). Fast burn (1h+5m windows, 14.4x) pages; slow burn
 * (6h+30m, 6x) warns. References the `job:http_error_rate` series.
 */
export function streetSloBurnRateRules(): RuleGroup {
  const errExpr = (w: string): string =>
    `sum(rate(http_requests_total{status=~"5.."}[${w}])) / sum(rate(http_requests_total[${w}]))`;
  return {
    name: 'street-slo-burn-rate',
    rules: [
      {
        alert: 'StreetErrorBudgetBurnFast',
        expr: `(${errExpr('1h')} > (14.4 * 0.001)) and (${errExpr('5m')} > (14.4 * 0.001))`,
        for: '2m',
        labels: { severity: 'critical', slo: 'availability-99.9' },
        annotations: { summary: 'Fast error-budget burn', description: 'Burning the 99.9% budget 14.4x over 1h/5m windows.' },
      },
      {
        alert: 'StreetErrorBudgetBurnSlow',
        expr: `(${errExpr('6h')} > (6 * 0.001)) and (${errExpr('30m')} > (6 * 0.001))`,
        for: '15m',
        labels: { severity: 'warning', slo: 'availability-99.9' },
        annotations: { summary: 'Slow error-budget burn', description: 'Burning the 99.9% budget 6x over 6h/30m windows.' },
      },
    ],
  };
}

/**
 * Subsystem operational alerts covering the four required signal classes
 * (Req 10.4) — latency, error rate, queue depth, and memory pressure — where
 * each alert defines a numeric trigger threshold (in its `expr`) and an
 * evaluation window (its `for`). Every metric referenced is an Exported Metric
 * (see `subsystem-metrics.ts`), so the anti-fabrication guard passes.
 */
export function streetSubsystemAlertRules(): RuleGroup {
  return {
    name: 'street-subsystem-alerts',
    rules: [
      // Latency: PostgreSQL query p99 above 500ms for 10m.
      {
        alert: 'StreetDbQueryLatencyHigh',
        expr: 'histogram_quantile(0.99, sum(rate(db_query_duration_seconds_bucket[5m])) by (le)) > 0.5',
        for: '10m',
        labels: { severity: 'warning', category: 'latency' },
        annotations: { summary: 'High PostgreSQL query latency', description: 'p99 query duration above 500ms for 10m.' },
      },
      // Error rate: any plugin signature verification failures over 5m.
      {
        alert: 'StreetPluginSignatureFailureRate',
        expr: 'rate(plugin_signature_failures_total[5m]) > 0',
        for: '5m',
        labels: { severity: 'warning', category: 'error-rate' },
        annotations: { summary: 'Plugin signature failures', description: 'Plugin manifest signature verification failures observed over 5m.' },
      },
      // Queue depth: RabbitMQ ready-message backlog above 1000 for 5m.
      {
        alert: 'StreetRabbitMqQueueDepthHigh',
        expr: 'rabbitmq_queue_depth > 1000',
        for: '5m',
        labels: { severity: 'warning', category: 'queue-depth' },
        annotations: { summary: 'High RabbitMQ queue depth', description: 'A RabbitMQ queue held more than 1000 ready messages for 5m.' },
      },
      // Memory pressure: process heap above 768MiB for 10m.
      {
        alert: 'StreetMemoryPressureHigh',
        expr: 'process_heap_bytes > 805306368',
        for: '10m',
        labels: { severity: 'warning', category: 'memory-pressure' },
        annotations: { summary: 'Process memory pressure', description: 'Process heap above 768MiB for 10m — investigate memory pressure.' },
      },
    ],
  };
}

/** Resource saturation alerts (references the real `process_heap_bytes` gauge). */
export function streetSaturationRules(): RuleGroup {
  return {
    name: 'street-saturation-alerts',
    rules: [
      {
        alert: 'StreetHighHeapUsage', expr: 'process_heap_bytes > 536870912', for: '10m',
        labels: { severity: 'warning' },
        annotations: { summary: 'High process heap usage', description: 'Process heap above 512MiB for 10m — investigate memory pressure.' },
      },
    ],
  };
}

/** All default Street rule groups. */
export function streetRuleGroups(): RuleGroup[] {
  return [streetRecordingRules(), streetAlertRules(), streetSaturationRules(), streetSloBurnRateRules()];
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface RuleValidationResult { valid: boolean; errors: string[]; }

/**
 * Validate rule groups structurally and semantically (to the extent possible
 * without promtool): unique non-empty group names; each rule is exactly one of
 * recording (record+expr) or alert (alert+expr); non-empty exprs; alerts carry
 * a `severity` label and a `summary` annotation; durations look like Prometheus
 * durations.
 */
export function validatePrometheusRuleGroups(groups: RuleGroup[]): RuleValidationResult {
  const errors: string[] = [];
  const DURATION = /^\d+[smhdwy]$/;
  if (!Array.isArray(groups) || groups.length === 0) {
    return { valid: false, errors: ['no rule groups provided'] };
  }
  const seen = new Set<string>();
  for (const g of groups) {
    if (!g.name || typeof g.name !== 'string') errors.push('group with missing/invalid name');
    if (seen.has(g.name)) errors.push(`duplicate group name "${g.name}"`);
    seen.add(g.name);
    if (g.interval !== undefined && !DURATION.test(g.interval)) errors.push(`group "${g.name}": invalid interval "${g.interval}"`);
    if (!Array.isArray(g.rules) || g.rules.length === 0) { errors.push(`group "${g.name}" has no rules`); continue; }
    for (const r of g.rules) {
      const hasRecord = typeof (r as RecordingRule).record === 'string';
      const hasAlert = typeof (r as AlertRule).alert === 'string';
      if (hasRecord === hasAlert) { errors.push(`group "${g.name}": rule must be exactly one of record|alert`); continue; }
      if (!r.expr || typeof r.expr !== 'string' || r.expr.trim() === '') {
        errors.push(`group "${g.name}": rule "${hasAlert ? (r as AlertRule).alert : (r as RecordingRule).record}" has empty expr`);
      }
      if (isAlertRule(r)) {
        if (r.for !== undefined && !DURATION.test(r.for)) errors.push(`alert "${r.alert}": invalid "for" duration "${r.for}"`);
        if (!r.labels || !r.labels['severity']) errors.push(`alert "${r.alert}": missing severity label`);
        if (!r.annotations || !r.annotations['summary']) errors.push(`alert "${r.alert}": missing summary annotation`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ── YAML serialization (dependency-free, restricted to the rule model) ─────────

function yamlScalar(v: string): string {
  // Quote if it contains characters that would confuse a YAML parser.
  if (v === '' || /[:#{}\[\],&*!|>'"%@`]/.test(v) || /^\s|\s$/.test(v)) {
    return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return v;
}

function emitMap(obj: Record<string, string>, indent: string): string {
  return Object.entries(obj).map(([k, v]) => `${indent}${k}: ${yamlScalar(v)}`).join('\n');
}

/** Serialize rule groups to a Prometheus-compatible `rule_files` YAML document. */
export function serializePrometheusRulesYaml(groups: RuleGroup[]): string {
  const lines: string[] = ['groups:'];
  for (const g of groups) {
    lines.push(`  - name: ${yamlScalar(g.name)}`);
    if (g.interval) lines.push(`    interval: ${yamlScalar(g.interval)}`);
    lines.push('    rules:');
    for (const r of g.rules) {
      if (isAlertRule(r)) {
        lines.push(`      - alert: ${yamlScalar(r.alert)}`);
        lines.push(`        expr: ${yamlScalar(r.expr)}`);
        if (r.for) lines.push(`        for: ${yamlScalar(r.for)}`);
        lines.push('        labels:');
        lines.push(emitMap(r.labels, '          '));
        lines.push('        annotations:');
        lines.push(emitMap(r.annotations, '          '));
      } else {
        lines.push(`      - record: ${yamlScalar(r.record)}`);
        lines.push(`        expr: ${yamlScalar(r.expr)}`);
        if (r.labels) { lines.push('        labels:'); lines.push(emitMap(r.labels, '          ')); }
      }
    }
  }
  return lines.join('\n') + '\n';
}
