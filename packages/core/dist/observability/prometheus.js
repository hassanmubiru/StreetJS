// src/observability/prometheus.ts
// Prometheus text exposition format 0.0.4 — Counter, Gauge, Histogram, MetricsRegistry.
// Also provides prometheusMiddleware and metricsHandler factories.
/**
 * Content-Type for the Prometheus text exposition format (version 0.0.4).
 * Used by `metricsHandler` and `registerMetricsRoute`.
 */
export const PROMETHEUS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
// ── Errors ────────────────────────────────────────────────────────────────────
export class MetricConflictError extends Error {
    constructor(name) {
        super(`Metric already registered: ${name}`);
        this.name = 'MetricConflictError';
    }
}
// ── Label helpers ─────────────────────────────────────────────────────────────
/** Build a Prometheus label string like {method="GET",route="/api"} */
function formatLabels(labels) {
    const pairs = Object.entries(labels);
    if (pairs.length === 0)
        return '';
    return '{' + pairs.map(([k, v]) => `${k}="${v}"`).join(',') + '}';
}
/** Stable key for a label-set (sorted so order doesn't matter) */
function labelKey(labels) {
    return Object.entries(labels)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join(',');
}
// ── Counter ───────────────────────────────────────────────────────────────────
export class Counter {
    name;
    help;
    labelNames;
    values = new Map();
    constructor(name, help, labels = []) {
        this.name = name;
        this.help = help;
        this.labelNames = labels;
    }
    inc(labels = {}, value = 1) {
        const key = labelKey(labels);
        this.values.set(key, (this.values.get(key) ?? 0) + value);
    }
    render() {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} counter`,
        ];
        if (this.values.size === 0) {
            lines.push(`${this.name} 0`);
        }
        else {
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
    name;
    help;
    labelNames;
    values = new Map();
    constructor(name, help, labels = []) {
        this.name = name;
        this.help = help;
        this.labelNames = labels;
    }
    set(value, labels = {}) {
        const key = labelKey(labels);
        this.values.set(key, value);
    }
    render() {
        const lines = [
            `# HELP ${this.name} ${this.help}`,
            `# TYPE ${this.name} gauge`,
        ];
        if (this.values.size === 0) {
            lines.push(`${this.name} 0`);
        }
        else {
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
export class Histogram {
    name;
    help;
    buckets;
    labelNames;
    data = new Map();
    constructor(name, help, buckets = DEFAULT_BUCKETS, labels = []) {
        this.name = name;
        this.help = help;
        this.buckets = [...buckets].sort((a, b) => a - b);
        this.labelNames = labels;
    }
    observe(value, labels = {}) {
        const key = labelKey(labels);
        if (!this.data.has(key)) {
            const buckets = new Map();
            for (const le of this.buckets)
                buckets.set(le, 0);
            this.data.set(key, { buckets, sum: 0, count: 0 });
        }
        const d = this.data.get(key);
        for (const le of this.buckets) {
            if (value <= le)
                d.buckets.set(le, (d.buckets.get(le) ?? 0) + 1);
        }
        d.sum += value;
        d.count += 1;
    }
    render() {
        const lines = [
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
        }
        else {
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
function _keyToObj(key) {
    if (!key)
        return {};
    const result = {};
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
    metrics = new Map();
    counter(name, help, labels = []) {
        if (this.metrics.has(name))
            throw new MetricConflictError(name);
        const c = new Counter(name, help, labels);
        this.metrics.set(name, c);
        return c;
    }
    gauge(name, help, labels = []) {
        if (this.metrics.has(name))
            throw new MetricConflictError(name);
        const g = new Gauge(name, help, labels);
        this.metrics.set(name, g);
        return g;
    }
    histogram(name, help, buckets = DEFAULT_BUCKETS, labels = []) {
        if (this.metrics.has(name))
            throw new MetricConflictError(name);
        const h = new Histogram(name, help, buckets, labels);
        this.metrics.set(name, h);
        return h;
    }
    collect() {
        return [...this.metrics.values()].map((m) => m.render()).join('\n') + '\n';
    }
}
// ── prometheusMiddleware ──────────────────────────────────────────────────────
/**
 * Factory that registers default HTTP + process metrics into `registry`,
 * then returns a MiddlewareFn that records per-request metrics.
 *
 * @param registry - The MetricsRegistry to register metrics in.
 * @param pool     - Optional connection pool with stats for db_pool_connections gauge.
 */
export function prometheusMiddleware(registry, pool) {
    // Default metrics
    const httpRequests = registry.counter('http_requests_total', 'Total HTTP requests', ['method', 'route', 'status']);
    const httpDuration = registry.histogram('http_request_duration_seconds', 'Request duration in seconds', [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10], ['method', 'route', 'status']);
    const processHeap = registry.gauge('process_heap_bytes', 'Process heap memory usage in bytes');
    let dbPoolGauge;
    if (pool !== undefined) {
        dbPoolGauge = registry.gauge('db_pool_connections', 'Database pool connection counts by state', ['state']);
    }
    // Collect heap usage on a background interval (not per-request)
    // Also set it immediately so the initial scrape shows a non-zero value.
    processHeap.set(process.memoryUsage().heapUsed);
    const heapInterval = setInterval(() => {
        processHeap.set(process.memoryUsage().heapUsed);
    }, 5_000);
    heapInterval.unref();
    return async (ctx, next) => {
        const startNs = process.hrtime.bigint();
        try {
            await next();
        }
        finally {
            const durationSec = Number(process.hrtime.bigint() - startNs) / 1e9;
            const method = ctx.method;
            const route = ctx.path;
            const status = String(ctx.res.statusCode ?? 200);
            httpRequests.inc({ method, route, status });
            httpDuration.observe(durationSec, { method, route, status });
            // NOTE: heap metric is now updated by the background interval, not per-request
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
 * Wire this to a `GET /metrics` route in your application (see
 * `registerMetricsRoute`).
 *
 * The response is written directly to the underlying response so the
 * Prometheus-specific Content-Type (`text/plain; version=0.0.4; charset=utf-8`)
 * is preserved. `ctx.text()` would otherwise overwrite it with a generic
 * `text/plain; charset=utf-8` header.
 */
export function metricsHandler(registry) {
    return async (ctx, _next) => {
        if (ctx.sent || ctx.res.writableEnded)
            return;
        const body = registry.collect();
        ctx.res.writeHead(200, {
            'Content-Type': PROMETHEUS_CONTENT_TYPE,
            'Content-Length': Buffer.byteLength(body, 'utf8').toString(),
        });
        ctx.res.end(body);
    };
}
/**
 * Wire Prometheus into a StreetApp in a single call, mirroring the
 * `registerHealthRoutes(app, registry)` pattern:
 *
 *   1. Installs `prometheusMiddleware(registry, pool)` so default HTTP +
 *      process (and optional DB pool) metrics are recorded per request.
 *   2. Registers `GET /metrics` to serve the exposition produced by
 *      `metricsHandler(registry)` with the correct Content-Type
 *      (`text/plain; version=0.0.4; charset=utf-8`).
 *
 * Call this once per registry. Combining it with a separate
 * `prometheusMiddleware(registry)` call on the same registry throws
 * `MetricConflictError`, since the default metrics would be registered twice.
 *
 * @param app      - The StreetApp to register the route + middleware on.
 * @param registry - The MetricsRegistry that holds the metrics to expose.
 * @param pool     - Optional connection pool with stats for the
 *                   `db_pool_connections` gauge.
 */
export function registerMetricsRoute(app, registry, pool) {
    app.use(prometheusMiddleware(registry, pool));
    const handler = metricsHandler(registry);
    app.use(async (ctx, next) => {
        if (ctx.method === 'GET' && ctx.path === '/metrics') {
            await handler(ctx, next);
            return;
        }
        await next();
    });
}
//# sourceMappingURL=prometheus.js.map