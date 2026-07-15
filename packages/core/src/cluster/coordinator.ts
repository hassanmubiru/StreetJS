// src/cluster/coordinator.ts
//
// The cluster coordinator now lives in the standalone @streetjs/cluster package
// (single source of truth). This module re-exports it so the `streetjs/cluster`
// subpath and all internal imports keep working unchanged — dependency
// inversion, not duplication.

export { ClusterCoordinator, workerHeartbeat, signalReady } from '@streetjs/cluster';
export type { ClusterOptions, IpcMessage } from '@streetjs/cluster';
