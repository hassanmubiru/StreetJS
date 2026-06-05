export interface LatencySample {
    latencyNs: bigint;
    isError: boolean;
}
export interface RouteStats {
    count: number;
    errorRate: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
}
export declare class RouteProfiler {
    private readonly _buffers;
    private _key;
    private _getOrCreate;
    /** Record a single request sample. */
    record(method: string, pattern: string, latencyNs: bigint, isError: boolean): void;
    /** Compute percentile stats for a specific route. */
    stats(method: string, pattern: string): RouteStats;
    /** Return stats for all registered routes. */
    allStats(): Map<string, RouteStats>;
}
//# sourceMappingURL=route-profiler.d.ts.map