import type { MiddlewareFn } from '../core/types.js';
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
 * Wire this to a `GET /metrics` route in your application.
 */
export declare function metricsHandler(registry: MetricsRegistry): MiddlewareFn;
//# sourceMappingURL=prometheus.d.ts.map