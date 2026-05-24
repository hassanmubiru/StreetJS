import { type Worker } from 'node:cluster';
export interface ClusterOptions {
    workers?: number;
    heartbeatIntervalMs?: number;
    heartbeatTimeoutMs?: number;
    onWorkerStart?: (worker: Worker) => void;
    onWorkerExit?: (worker: Worker, code: number | null, signal: string | null) => void;
}
export declare class ClusterCoordinator {
    private readonly workerCount;
    private readonly workerMap;
    private readonly opts;
    private heartbeatTimer;
    constructor(opts?: ClusterOptions);
    /** Start all workers (called from primary) */
    start(): void;
    private _spawnWorker;
    private _handleWorkerMessage;
    private _checkHeartbeats;
    shutdown(): void;
}
/** Send heartbeat from worker to primary */
export declare function workerHeartbeat(intervalMs?: number): NodeJS.Timeout;
/** Signal readiness from worker to primary */
export declare function signalReady(): void;
//# sourceMappingURL=coordinator.d.ts.map