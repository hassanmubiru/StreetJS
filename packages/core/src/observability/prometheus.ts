// src/observability/prometheus.ts
// Prometheus text exposition format 0.0.4 — Counter, Gauge, Histogram, MetricsRegistry.
// Also provides prometheusMiddleware and metricsHandler factories.

import type { MiddlewareFn } from '../core/types.js';

// ── Errors ────────────────────────────────────────────────────────────────────

export class MetricConflictError extends Error {
  constructor(name: string) {
    super(`Metric already registered: ${name}`);
    this.name = 'MetricConflictError';
  }
}

// ── Label helpers ─────────────────────────────────────────────────────────────

/** Build a Prometheus label string like {method="GET",route="/api"} */
function formatLabels(labels: Record<string, string>): string {
  const pairs = Object.entries(labels);
  if (pairs.length === 0) return '';
  return '{' + pairs.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}

/** Stable key for a label-set (sorted so order doesn't matter) */
function labelKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
}

// ── Counter ───────────────────────────────────────────────────────────────────

export class Counter {
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string, labels: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labels;
  }

  inc(labels: Record<string, string> = {}, value = 1): void {
    const key = labelKey(labels);
    this.values.set(key, (this.values.get(key) ?? 0) + value);
  }

  render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} counter`,
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, val] of this.values) {
        const labelsObj = _keyToObj(key);
        lines.push(`${this.name}${formatLabels(labelsObj)} ${val}`);
      }
    }
    return lines.join('\n');
  }
}

// ── Gauge ─────────────────────────────────────────────────────────────────────

export class Gauge {
  readonly name: string;
  readonly help: string;
  readonly labelNames: string[];
  private readonly values = new Map<string, number>();

  constructor(name: string, help: string, labels: string[] = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labels;
  }

  set(value: number, labels: Record<string, string> = {}): void {
    const key = labelKey(labels);
    this.values.set(key, value);
  }

  render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} gauge`,
    ];
    if (this.values.size === 0) {
      lines.push(`${this.name} 0`);
    } else {
      for (const [key, val] of this.values) {
        const labelsObj = _keyToObj(key);
        lines.push(`${this.name}${formatLabels(labelsObj)} ${val}`);
      }
    }
    return lines.join('\n');
  }
}

// ── Histogram ─────────────────────────────────────────────────────────────────

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface HistogramData {
  buckets: Map<number, number>;   // le → count
  sum: number;
  count: number;
}

export class Histogram {
  readonly name: string;
  readonly help: string;
  readonly buckets: number[];
  readonly labelNames: string[];
  private readonly data = new Map<string, HistogramData>();

  constructor(name: string, help: string, buckets: number[] = DEFAULT_BUCKETS, labels: string[] = []) {
    this.name = name;
    this.help = help;
    this.buckets = [...buckets].sort((a, b) => a - b);
    this.labelNames = labels;
  }

  observe(value: number, labels: Record<string, string> = {}): void {
    const key = labelKey(labels);
    if (!this.data.has(key)) {
      const buckets = new Map<number, number>();
      for (const le of this.buckets) buckets.set(le, 0);
      this.data.set(key, { buckets, sum: 0, count: 0 });
    }
    const d = this.data.get(key)!;
    for (const le of this.buckets) {
      if (value <= le) d.buckets.set(le, (d.buckets.get(le) ?? 0) + 1);
    }
    d.sum += value;
    d.count += 1;
  }

  render(): string {
    const lines: string[] = [
      `# HELP ${this.name} ${this.help}`,
      `# TYPE ${this.name} histogram`,
    ];

    if (this.data.size === 0) {
      // Render empty histogram
      for (const le of this.buckets) {
        lines.push(`${this.name}_bucket{le="${le}"} 0`);
      }
      lines.push(`${this.name}_bucket{le="+Inf"} 0`);
      lines.push(`${this.name}_sum 0`);
      lines.push(`${this.name}_count 0`);
    } else {
      for (const [key, d] of this.data) {
        const labelsObj = _keyToObj(key);
        const labelStr = formatLabels(labelsObj);
        // Cumulative counts per bucket
        let cumulative = 0;
        for (const le of this.buckets) {
          cumulative += d.buckets.get(le) ?? 0;
          const leLabels = labelStr
            ? `{${labelStr.slice(1, -1)},le="${le}"}`
            : `{le="${le}"}`;
          lines.push(`${this.name}_bucket${leLabels} ${cumulative}`);
        }
        // +Inf bucket = total count
        const infLabels = labelStr
          ? `{${labelStr.slice(1, -1)},le="+Inf"}`
          : `{le="+Inf"}`;
        lines.push(`${this.name}_bucket${infLabels} ${d.count}`);
        lines.push(`${this.name}_sum${labelStr} ${d.sum}`);
        lines.push(`${this.name}_count${labelStr} ${d.count}`);
      }
    }

    return lines.join('\n');
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Reverse a labelKey() string back to {key:value} map. Empty string → {}. */
function _keyToObj(key: string): Record<string, string> {
  if (!key) return {};
  const result: Record<string, string> = {};
  for (const part of key.split(',')) {
    const idx = part.indexOf('=');
    if (idx >= 0) {
      result[part.slice(0, idx)] = part.slice(idx + 1);
    }
  }
  return result;
}

// ── MetricsRegistry ───────────────────────────────────────────────────────────

export class MetricsRegistry {
  private readonly metrics = new Map<string, Counter | Gauge | Histogram>();

  counter(name: string, help: string, labels: string[] = []): Counter {
    if (this.metrics.has(name)) throw new MetricConflictError(name);
    const c = new Counter(name, help, labels);
    this.metrics.set(name, c);
    return c;
  }

  gauge(name: string, help: string, labels: string[] = []): Gauge {
    if (this.metrics.has(name)) throw new MetricConflictError(name);
    const g = new Gauge(name, help, labels);
    this.metrics.set(name, g);
    return g;
  }

  histogram(name: string, help: string, buckets: number[] = DEFAULT_BUCKETS, labels: string[] = []): Histogram {
    if (this.metrics.has(name)) throw new MetricConflictError(name);
    const h = new Histogram(name, help, buckets, labels);
    this.metrics.set(name, h);
    return h;
  }

  collect(): string {
    return [...this.metrics.values()].map((m) => m.render()).join('\n') + '\n';
  }
}

// ── Pool interface ────────────────────────────────────────────────────────────

/** Minimal interface for a connection pool that exposes usage stats. */
export interface PoolStats {
  idleCount?: number;
  activeCount?: number;
  waitingCount?: number;
  idle?: number;
  active?: number;
  waiting?: number;
}

// ── prometheusMiddleware ──────────────────────────────────────────────────────

/**
 * Factory that registers default HTTP + process metrics into `registry`,
 * then returns a MiddlewareFn that records per-request metrics.
 *
 * @param registry - The MetricsRegistry to register metrics in.
 * @param pool     - Optional connection pool with stats for db_pool_connections gauge.
 */
export function prometheusMiddleware(
  registry: MetricsRegistry,
  pool?: PoolStats,
): MiddlewareFn {
  // Default metrics
  const httpRequests = registry.counter(
    'http_requests_total',
    'Total HTTP requests',
    ['method', 'route', 'status'],
  );

  const httpDuration = registry.histogram(
    'http_request_duration_seconds',
    'Request duration in seconds',
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    ['method', 'route', 'status'],
  );

  const processHeap = registry.gauge(
    'process_heap_bytes',
    'Process heap memory usage in bytes',
  );

  let dbPoolGauge: Gauge | undefined;
  if (pool !== undefined) {
    dbPoolGauge = registry.gauge(
      'db_pool_connections',
      'Database pool connection counts by state',
      ['state'],
    );
  }

  return async (ctx, next) => {
    const startNs = process.hrtime.bigint();

    try {
      await next();
    } finally {
      const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
      const method = ctx.method;
      const route = ctx.path;
      const status = String(ctx.res.statusCode ?? 200);

      httpRequests.inc({ method, route, status });
      httpDuration.observe(durationSec, { method, route, status });

      // Update heap gauge
      processHeap.set(process.memoryUsage().heapUsed);

      // Update pool gauge if provided
      if (dbPoolGauge && pool) {
        const idle = pool.idleCount ?? pool.idle ?? 0;
        const active = pool.activeCount ?? pool.active ?? 0;
        const waiting = pool.waitingCount ?? pool.waiting ?? 0;
        dbPoolGauge.set(idle, { state: 'idle' });
        dbPoolGauge.set(active, { state: 'active' });
        dbPoolGauge.set(waiting, { state: 'waiting' });
      }
    }
  };
}

// ── metricsHandler ────────────────────────────────────────────────────────────

/**
 * Returns a MiddlewareFn that responds with the Prometheus text exposition.
 * Wire this to a `GET /metrics` route in your application.
 */
export function metricsHandler(registry: MetricsRegistry): MiddlewareFn {
  return async (ctx, _next) => {
    const body = registry.collect();
    ctx.res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    ctx.text(body, 200);
  };
}
