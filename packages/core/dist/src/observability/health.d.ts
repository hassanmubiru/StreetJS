import type { StreetApp } from '../http/server.js';
export type CheckType = 'liveness' | 'readiness';
export type CheckStatus = 'up' | 'down';
export interface CheckResult {
    status: CheckStatus;
    details?: Record<string, unknown>;
}
export type CheckFn = () => Promise<CheckResult>;
export interface HealthResponse {
    status: 'ok' | 'degraded';
    checks: Record<string, CheckResult & {
        durationMs: number;
    }>;
}
export declare class HealthCheckRegistry {
    private readonly _checks;
    private readonly _startTime;
    /**
     * Register a health check function.
     * Defaults: type='liveness', timeoutMs=5000.
     */
    addCheck(name: string, fn: CheckFn, opts?: {
        type?: CheckType;
        timeoutMs?: number;
    }): void;
    /** Run all liveness checks in parallel. */
    runLiveness(): Promise<HealthResponse>;
    /** Run all readiness checks in parallel. */
    runReadiness(): Promise<HealthResponse>;
    private _run;
    private _runOne;
}
/**
 * Register GET /health/live and GET /health/ready on a StreetApp instance.
 * Responds 200 if all checks pass, 503 if any check is down.
 */
export declare function registerHealthRoutes(app: StreetApp, registry: HealthCheckRegistry): void;
//# sourceMappingURL=health.d.ts.map