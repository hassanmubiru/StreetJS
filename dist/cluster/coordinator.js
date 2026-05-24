// src/cluster/coordinator.ts
// Cluster coordinator: spawns workers, IPC heartbeat, auto-restart on failure.
import cluster from 'node:cluster';
import { cpus } from 'node:os';
export class ClusterCoordinator {
    workerCount;
    workerMap = new Map();
    opts;
    heartbeatTimer = null;
    constructor(opts = {}) {
        this.workerCount = opts.workers ?? Math.max(1, cpus().length);
        this.opts = {
            workers: this.workerCount,
            heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 10_000,
            heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 30_000,
            onWorkerStart: opts.onWorkerStart ?? (() => undefined),
            onWorkerExit: opts.onWorkerExit ?? (() => undefined),
        };
    }
    /** Start all workers (called from primary) */
    start() {
        if (!cluster.isPrimary) {
            throw new Error('ClusterCoordinator.start() must be called from the primary process');
        }
        console.log(`[cluster] Primary ${process.pid} starting ${this.workerCount} workers`);
        for (let i = 0; i < this.workerCount; i++) {
            this._spawnWorker();
        }
        cluster.on('exit', (worker, code, signal) => {
            const state = this.workerMap.get(worker.id);
            if (state)
                this.workerMap.delete(worker.id);
            console.warn(`[cluster] Worker ${worker.process.pid} exited (code=${code}, signal=${signal}). Restarting...`);
            this.opts.onWorkerExit(worker, code, signal);
            // Auto-restart after brief delay to avoid tight restart loops
            setTimeout(() => this._spawnWorker(), 500).unref();
        });
        cluster.on('message', (worker, msg) => {
            this._handleWorkerMessage(worker, msg);
        });
        // Heartbeat monitor
        this.heartbeatTimer = setInterval(() => this._checkHeartbeats(), this.opts.heartbeatIntervalMs);
        this.heartbeatTimer.unref();
    }
    _spawnWorker() {
        const worker = cluster.fork();
        this.workerMap.set(worker.id, {
            worker,
            lastHeartbeat: Date.now(),
            ready: false,
        });
        this.opts.onWorkerStart(worker);
        console.log(`[cluster] Spawned worker ${worker.process.pid}`);
    }
    _handleWorkerMessage(worker, msg) {
        const state = this.workerMap.get(worker.id);
        if (!state)
            return;
        switch (msg.type) {
            case 'heartbeat':
                state.lastHeartbeat = Date.now();
                break;
            case 'ready':
                state.ready = true;
                console.log(`[cluster] Worker ${worker.process.pid} ready`);
                break;
            case 'telemetry':
                // Could forward telemetry to a central store
                break;
        }
    }
    _checkHeartbeats() {
        const now = Date.now();
        for (const [id, state] of this.workerMap.entries()) {
            if (now - state.lastHeartbeat > this.opts.heartbeatTimeoutMs) {
                console.warn(`[cluster] Worker ${state.worker.process.pid} missed heartbeat. Killing...`);
                state.worker.kill('SIGTERM');
                this.workerMap.delete(id);
            }
        }
    }
    shutdown() {
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        for (const { worker } of this.workerMap.values()) {
            worker.kill('SIGTERM');
        }
        this.workerMap.clear();
    }
}
/** Send heartbeat from worker to primary */
export function workerHeartbeat(intervalMs = 5_000) {
    const timer = setInterval(() => {
        if (process.send) {
            const msg = { type: 'heartbeat', ts: Date.now() };
            process.send(msg);
        }
    }, intervalMs);
    timer.unref();
    return timer;
}
/** Signal readiness from worker to primary */
export function signalReady() {
    if (process.send) {
        const msg = { type: 'ready', ts: Date.now() };
        process.send(msg);
    }
}
//# sourceMappingURL=coordinator.js.map