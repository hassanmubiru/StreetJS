// src/observability/grafana-dashboard.ts
// Grafana dashboard model for Street's default HTTP metrics + recording rules,
// with a structural validator. Emitting valid dashboard JSON lets operators
// import it directly or provision it via files. Dependency-free.

export interface GrafanaTarget { expr: string; legendFormat?: string; refId: string; }
export interface GrafanaPanel {
  id: number; title: string; type: string;
  gridPos: { x: number; y: number; w: number; h: number };
  targets: GrafanaTarget[];
  unit?: string;
}
export interface GrafanaDashboard {
  uid: string; title: string; schemaVersion: number; version: number;
  tags: string[]; timezone: string; refresh: string;
  panels: GrafanaPanel[];
}

/** The default Street API dashboard: request rate, error ratio, p95/p99 latency. */
export function streetApiDashboard(): GrafanaDashboard {
  const panel = (id: number, title: string, type: string, x: number, y: number, targets: GrafanaTarget[], unit?: string): GrafanaPanel => ({
    id, title, type, gridPos: { x, y, w: 12, h: 8 }, targets, ...(unit ? { unit } : {}),
  });
  return {
    uid: 'street-api',
    title: 'Street API',
    schemaVersion: 39,
    version: 1,
    tags: ['street', 'http'],
    timezone: 'browser',
    refresh: '30s',
    panels: [
      panel(1, 'Request rate (req/s)', 'timeseries', 0, 0, [
        { expr: 'job:http_request_rate:rate5m', legendFormat: 'rps', refId: 'A' },
      ], 'reqps'),
      panel(2, '5xx error ratio', 'timeseries', 12, 0, [
        { expr: 'job:http_error_rate:ratio5m', legendFormat: 'error ratio', refId: 'A' },
      ], 'percentunit'),
      panel(3, 'Latency p95', 'timeseries', 0, 8, [
        { expr: 'job:http_request_latency:p95', legendFormat: 'p95', refId: 'A' },
      ], 's'),
      panel(4, 'Latency p99', 'timeseries', 12, 8, [
        { expr: 'job:http_request_latency:p99', legendFormat: 'p99', refId: 'A' },
      ], 's'),
    ],
  };
}

/** Runtime/saturation dashboard: heap usage and request throughput. */
export function streetRuntimeDashboard(): GrafanaDashboard {
  const panel = (id: number, title: string, type: string, x: number, y: number, targets: GrafanaTarget[], unit?: string): GrafanaPanel => ({
    id, title, type, gridPos: { x, y, w: 12, h: 8 }, targets, ...(unit ? { unit } : {}),
  });
  return {
    uid: 'street-runtime',
    title: 'Street Runtime',
    schemaVersion: 39,
    version: 1,
    tags: ['street', 'runtime', 'saturation'],
    timezone: 'browser',
    refresh: '30s',
    panels: [
      panel(1, 'Process heap (bytes)', 'timeseries', 0, 0, [
        { expr: 'process_heap_bytes', legendFormat: 'heap', refId: 'A' },
      ], 'bytes'),
      panel(2, 'Request rate (req/s)', 'timeseries', 12, 0, [
        { expr: 'job:http_request_rate:rate5m', legendFormat: 'rps', refId: 'A' },
      ], 'reqps'),
      panel(3, 'Error ratio', 'timeseries', 0, 8, [
        { expr: 'job:http_error_rate:ratio5m', legendFormat: 'error ratio', refId: 'A' },
      ], 'percentunit'),
      panel(4, 'Latency p99', 'timeseries', 12, 8, [
        { expr: 'job:http_request_latency:p99', legendFormat: 'p99', refId: 'A' },
      ], 's'),
    ],
  };
}

// ── Subsystem dashboards (Req 10.3) ───────────────────────────────────────────
//
// One dashboard per subsystem, built exclusively on the metrics the application
// actually exports (see `subsystem-metrics.ts`). Every panel target references
// an Exported Metric (histograms via their `_bucket` series); the
// anti-fabrication guard (`validateMetricReferences`) keeps this honest.

// Shared 12x8 grid panel factory used by the subsystem dashboards.
function gridPanel(
  id: number, title: string, type: string, x: number, y: number, targets: GrafanaTarget[], unit?: string,
): GrafanaPanel {
  return { id, title, type, gridPos: { x, y, w: 12, h: 8 }, targets, ...(unit ? { unit } : {}) };
}

/** PostgreSQL dashboard: pool connections, query/acquire latency, exhaustion. */
export function streetPostgresDashboard(): GrafanaDashboard {
  return {
    uid: 'street-postgres',
    title: 'Street PostgreSQL',
    schemaVersion: 39,
    version: 1,
    tags: ['street', 'postgres', 'database'],
    timezone: 'browser',
    refresh: '30s',
    panels: [
      gridPanel(1, 'Pool connections by state', 'timeseries', 0, 0, [
        { expr: 'db_pool_connections', legendFormat: '{{state}}', refId: 'A' },
      ]),
      gridPanel(2, 'Pool exhaustion rate', 'timeseries', 12, 0, [
        { expr: 'rate(db_pool_exhausted_total[5m])', legendFormat: 'exhausted/s', refId: 'A' },
      ], 'reqps'),
      gridPanel(3, 'Query duration p95', 'timeseries', 0, 8, [
        { expr: 'histogram_quantile(0.95, sum(rate(db_query_duration_seconds_bucket[5m])) by (le))', legendFormat: 'p95', refId: 'A' },
      ], 's'),
      gridPanel(4, 'Connection acquire p95', 'timeseries', 12, 8, [
        { expr: 'histogram_quantile(0.95, sum(rate(db_pool_acquire_seconds_bucket[5m])) by (le))', legendFormat: 'p95', refId: 'A' },
      ], 's'),
    ],
  };
}

/** Kafka dashboard: produce/consume throughput, consumer lag, coordinator wait. */
export function streetKafkaDashboard(): GrafanaDashboard {
  return {
    uid: 'street-kafka',
    title: 'Street Kafka',
    schemaVersion: 39,
    version: 1,
    tags: ['street', 'kafka', 'messaging'],
    timezone: 'browser',
    refresh: '30s',
    panels: [
      gridPanel(1, 'Messages produced (msg/s)', 'timeseries', 0, 0, [
        { expr: 'sum(rate(kafka_messages_produced_total[5m]))', legendFormat: 'produced/s', refId: 'A' },
      ], 'reqps'),
      gridPanel(2, 'Messages consumed (msg/s)', 'timeseries', 12, 0, [
        { expr: 'sum(rate(kafka_messages_consumed_total[5m]))', legendFormat: 'consumed/s', refId: 'A' },
      ], 'reqps'),
      gridPanel(3, 'Consumer lag', 'timeseries', 0, 8, [
        { expr: 'kafka_consumer_lag', legendFormat: '{{topic}}/{{partition}}', refId: 'A' },
      ]),
      gridPanel(4, 'Coordinator wait p95', 'timeseries', 12, 8, [
        { expr: 'histogram_quantile(0.95, sum(rate(kafka_coordinator_wait_seconds_bucket[5m])) by (le))', legendFormat: 'p95', refId: 'A' },
      ], 's'),
    ],
  };
}

/** RabbitMQ dashboard: publish/deliver throughput, queue depth, consumer count. */
export function streetRabbitmqDashboard(): GrafanaDashboard {
  return {
    uid: 'street-rabbitmq',
    title: 'Street RabbitMQ',
    schemaVersion: 39,
    version: 1,
    tags: ['street', 'rabbitmq', 'messaging'],
    timezone: 'browser',
    refresh: '30s',
    panels: [
      gridPanel(1, 'Messages published (msg/s)', 'timeseries', 0, 0, [
        { expr: 'sum(rate(rabbitmq_messages_published_total[5m]))', legendFormat: 'published/s', refId: 'A' },
      ], 'reqps'),
      gridPanel(2, 'Messages delivered (msg/s)', 'timeseries', 12, 0, [
        { expr: 'sum(rate(rabbitmq_messages_delivered_total[5m]))', legendFormat: 'delivered/s', refId: 'A' },
      ], 'reqps'),
      gridPanel(3, 'Queue depth', 'timeseries', 0, 8, [
        { expr: 'rabbitmq_queue_depth', legendFormat: '{{queue}}', refId: 'A' },
      ]),
      gridPanel(4, 'Consumer count', 'timeseries', 12, 8, [
        { expr: 'rabbitmq_consumer_count', legendFormat: '{{queue}}', refId: 'A' },
      ]),
    ],
  };
}

/** Plugin Host dashboard: plugin states, install duration, signature failures. */
export function streetPluginHostDashboard(): GrafanaDashboard {
  return {
    uid: 'street-plugin-host',
    title: 'Street Plugin Host',
    schemaVersion: 39,
    version: 1,
    tags: ['street', 'plugins', 'plugin-host'],
    timezone: 'browser',
    refresh: '30s',
    panels: [
      gridPanel(1, 'Plugins by state', 'timeseries', 0, 0, [
        { expr: 'plugin_host_plugins', legendFormat: '{{state}}', refId: 'A' },
      ]),
      gridPanel(2, 'Signature failure rate', 'timeseries', 12, 0, [
        { expr: 'rate(plugin_signature_failures_total[5m])', legendFormat: 'failures/s', refId: 'A' },
      ], 'reqps'),
      gridPanel(3, 'Install duration p95', 'timeseries', 0, 8, [
        { expr: 'histogram_quantile(0.95, sum(rate(plugin_install_duration_seconds_bucket[5m])) by (le))', legendFormat: 'p95', refId: 'A' },
      ], 's'),
    ],
  };
}

/**
 * All default Street dashboards: HTTP API + runtime (existing) plus the
 * PostgreSQL, Kafka, RabbitMQ, and Plugin Host subsystem dashboards (Req 10.3).
 */
export function streetDashboards(): GrafanaDashboard[] {
  return [
    streetApiDashboard(),
    streetRuntimeDashboard(),
    streetPostgresDashboard(),
    streetKafkaDashboard(),
    streetRabbitmqDashboard(),
    streetPluginHostDashboard(),
  ];
}

export interface DashboardValidationResult { valid: boolean; errors: string[]; }

/** Validate a Grafana dashboard's required structure (uid/title/schema/panels/targets). */
export function validateGrafanaDashboard(d: unknown): DashboardValidationResult {
  const errors: string[] = [];
  const obj = d as Partial<GrafanaDashboard> | null;
  if (typeof obj !== 'object' || obj === null) return { valid: false, errors: ['dashboard is not an object'] };
  if (!obj.uid) errors.push('missing uid');
  if (!obj.title) errors.push('missing title');
  if (typeof obj.schemaVersion !== 'number') errors.push('missing/invalid schemaVersion');
  if (!Array.isArray(obj.panels) || obj.panels.length === 0) {
    errors.push('dashboard must have at least one panel');
  } else {
    const ids = new Set<number>();
    for (const p of obj.panels) {
      if (typeof p.id !== 'number') errors.push('panel missing numeric id');
      else if (ids.has(p.id)) errors.push(`duplicate panel id ${p.id}`);
      ids.add(p.id);
      if (!p.title) errors.push(`panel ${p.id} missing title`);
      if (!Array.isArray(p.targets) || p.targets.length === 0) errors.push(`panel "${p.title}" has no targets`);
      else for (const t of p.targets) {
        if (!t.expr || t.expr.trim() === '') errors.push(`panel "${p.title}" has a target with empty expr`);
        if (!t.refId) errors.push(`panel "${p.title}" has a target missing refId`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
