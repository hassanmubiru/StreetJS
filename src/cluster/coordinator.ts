// src/cluster/coordinator.ts
// Cluster coordinator: spawns workers, IPC heartbeat, auto-restart on failure.

import cluster, { type Worker } from 'node:cluster';
import { cpus } from 'node:os';
import type { IpcMessage } from '../core/types.js';

export interface ClusterOptions {
  workers?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  onWorkerStart?: (worker: Worker) => void;
  onWorkerExit?: (worker: Worker, code: number | null, signal: string | null) => void;
}

interface WorkerState {
  worker: Worker;
  lastHeartbeat: number;
  ready: boolean;
}

export class ClusterCoordinator {
  private readonly workerCount: number;
  private readonly workerMap = new Map<number, WorkerState>();
  private readonly opts: Required<ClusterOptions>;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private _started = false;

  // Stored listener references for cleanup
  private readonly _onExit: (worker: Worker, code: number | null, signal: string | null) => void;
  private readonly _onMessage: (worker: Worker, msg: IpcMessage) => void;

  constructor(opts: ClusterOptions = {}) {
    this.workerCount = opts.workers ?? Math.max(1, cpus().length);
    this.opts = {
      workers: this.workerCount,
      heartbeatIntervalMs: opts.heartbeatIntervalMs ?? 10_000,
      heartbeatTimeoutMs: opts.heartbeatTimeoutMs ?? 30_000,
      onWorkerStart: opts.onWorkerStart ?? (() => undefined),
      onWorkerExit: opts.onWorkerExit ?? (() => undefined),
    };

    this._onExit = (worker, code, signal) => {
      const state = this.workerMap.get(worker.id);
      if (state) this.workerMap.delete(worker.id);

      console.warn(`[cluster] Worker ${worker.process.pid} exited (code=${code}, signal=${signal}). Restarting...`);
      this.opts.onWorkerExit(worker, code, signal);

      // Auto-restart after brief delay to avoid tight restart loops
      setTimeout(() => this._spawnWorker(), 500).unref();
    };

    this._onMessage = (worker, msg) => {
      this._handleWorkerMessage(worker, msg);
    };
  }

  /** Start all workers (called from primary) */
  start(): void {
    if (!cluster.isPrimary) {
      throw new Error('ClusterCoordinator.start() must be called from the primary process');
    }

    // Guard against multiple start() calls to prevent listener pile-up
    if (this._started) {
      console.warn('[cluster] start() called again — ignoring duplicate call');
      return;
    }
    this._started = true;

    console.log(`[cluster] Primary ${process.pid} starting ${this.workerCount} workers`);

    for (let i = 0; i < this.workerCount; i++) {
      this._spawnWorker();
    }

    cluster.on('exit', this._onExit);
    cluster.on('message', this._onMessage);

    // Heartbeat monitor
    this.heartbeatTimer = setInterval(() => this._checkHeartbeats(), this.opts.heartbeatIntervalMs);
    this.heartbeatTimer.unref();
  }

  private _spawnWorker(): void {
    const worker = cluster.fork();
    this.workerMap.set(worker.id, {
      worker,
      lastHeartbeat: Date.now(),
      ready: false,
    });
    this.opts.onWorkerStart(worker);
    console.log(`[cluster] Spawned worker ${worker.process.pid}`);
  }

  private _handleWorkerMessage(worker: Worker, msg: IpcMessage): void {
    const state = this.workerMap.get(worker.id);
    if (!state) return;

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

  private _checkHeartbeats(): void {
    const now = Date.now();
    for (const [id, state] of this.workerMap.entries()) {
      if (now - state.lastHeartbeat > this.opts.heartbeatTimeoutMs) {
        console.warn(`[cluster] Worker ${state.worker.process.pid} missed heartbeat. Killing...`);
        state.worker.kill('SIGTERM');
        this.workerMap.delete(id);
      }
    }
  }

  shutdown(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Clean up cluster listeners to prevent memory leaks
    cluster.removeListener('exit', this._onExit);
    cluster.removeListener('message', this._onMessage);

    for (const { worker } of this.workerMap.values()) {
      worker.kill('SIGTERM');
    }
    this.workerMap.clear();
    this._started = false;
  }
}

/** Send heartbeat from worker to primary */
export function workerHeartbeat(intervalMs = 5_000): NodeJS.Timeout {
  const timer = setInterval(() => {
    if (process.send) {
      const msg: IpcMessage = { type: 'heartbeat', ts: Date.now() };
      process.send(msg);
    }
  }, intervalMs);
  timer.unref();
  return timer;
}

/** Signal readiness from worker to primary */
export function signalReady(): void {
  if (process.send) {
    const msg: IpcMessage = { type: 'ready', ts: Date.now() };
    process.send(msg);
  }
}
