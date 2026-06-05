import type { TelemetrySample } from '../core/types.js';
export declare class TelemetryTracker {
    private readonly samples;
    private readonly latencies;
    private requestCount;
    private errorCount;
    private readonly collectTimer;
    constructor(collectIntervalMs?: number);
    /** Record a completed request latency in nanoseconds */
    recordRequest(latencyNs: bigint, isError: boolean): void;
    /** Get current metrics snapshot */
    snapshot(): TelemetrySample;
    /** Get recent samples (bounded) */
    getHistory(count?: number): TelemetrySample[];
    /** Health check data */
    health(): object;
    private _collect;
    private _percentile;
    destroy(): void;
}
/** Request timing middleware factory */
export declare function telemetryMiddleware(tracker: TelemetryTracker): (ctx: import("../core/context.js").StreetContext, next: () => Promise<void>) => Promise<void>;
//# sourceMappingURL=tracker.d.ts.map