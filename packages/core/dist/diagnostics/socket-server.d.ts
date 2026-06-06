import type { RouteProfiler } from './route-profiler.js';
import type { JobQueueMetrics } from '../jobs/queue.js';
/**
 * Minimal structural view of a job-metrics provider (e.g. a `JobQueue`).
 * Declared structurally — rather than importing the concrete `JobQueue` class —
 * so the diagnostics server stays loosely coupled and free of import cycles.
 */
export interface JobMetricsSource {
    metrics(): Promise<JobQueueMetrics>;
}
export interface DiagnosticsServerOptions {
    /** Path to the Unix domain socket (default: /tmp/street-<pid>.sock) */
    socketPath?: string;
    /** RouteProfiler instance to snapshot */
    profiler: RouteProfiler;
    /** Optional job-metrics source (e.g. a JobQueue) to include in snapshots. */
    jobQueue?: JobMetricsSource;
}
export declare class DiagnosticsServer {
    private readonly _socketPath;
    private readonly _profiler;
    private readonly _jobQueue;
    private _server;
    private readonly _clients;
    private _pushTimer;
    constructor(opts: DiagnosticsServerOptions);
    /** Start listening on the Unix domain socket and push snapshots every second. */
    start(): void;
    /** Stop the server, close all clients, and remove the socket file. */
    stop(): void;
    private _snapshot;
    private _pushSnapshot;
    private _broadcastSnapshot;
}
/** Check if a given socket path is stale (process no longer running). */
export declare function isStaleSocket(socketPath: string): Promise<boolean>;
//# sourceMappingURL=socket-server.d.ts.map