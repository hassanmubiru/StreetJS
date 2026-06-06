import type { MiddlewareFn } from '../core/types.js';
import type { StreetApp } from '../http/server.js';
/**
 * Content-Type for the Prometheus text exposition format (version 0.0.4).
 * Used by `metricsHandler` and `registerMetricsRoute`.
 */
export declare const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";
export declare class MetricConflictError extends Error {
    constructor(name: string);
}
export declare class Counter {
    readonly name: string;
    readonly help: string;
    readonly labelNames: string[];
    private readonly values;
    constructor(name: string, help: string, labels?: string[]);
    inc(labels?: Record<string, string>, value?: number): void;
    render(): string;
}
export declare class Gauge {
    readonly name: string;
    readonly help: string;
    readonly labelNames: string[];
    private readonly values;
    constructor(name: string, help: string, labels?: string[]);
    set(value: number, labels?: Record<string, string>): void;
    render(): string;
}
export declare class Histogram {
    readonly name: string;
    readonly help: string;
    readonly buckets: number[];
    readonly labelNames: string[];
    private readonly data;
    constructor(name: string, help: string, buckets?: number[], labels?: string[]);
    observe(value: number, labels?: Record<string, string>): void;
    render(): string;
}
export declare class MetricsRegistry {
    private readonly metrics;
    counter(name: string, help: string, labels?: string[]): Counter;
    gauge(name: string, help: string, labels?: string[]): Gauge;
    histogram(name: string, help: string, buckets?: number[], labels?: string[]): Histogram;
    collect(): string;
}
/** Minimal interface for a connection pool that exposes usage stats. */
export interface PoolStats {
    idleCount?: number;
    activeCount?: number;
    waitingCount?: number;
    idle?: number;
    active?: number;
    waiting?: number;
}
/**
 * Factory that registers default HTTP + process metrics into `registry`,
 * then returns a MiddlewareFn that records per-request metrics.
 *
 * @param registry - The MetricsRegistry to register metrics in.
 * @param pool     - Optional connection pool with stats for db_pool_connections gauge.
 */
export declare function prometheusMiddleware(registry: MetricsRegistry, pool?: PoolStats): MiddlewareFn;
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
export declare function metricsHandler(registry: MetricsRegistry): MiddlewareFn;
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
export declare function registerMetricsRoute(app: StreetApp, registry: MetricsRegistry, pool?: PoolStats): void;
//# sourceMappingURL=prometheus.d.ts.map