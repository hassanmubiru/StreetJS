/**
 * @streetjs/cluster — the StreetJS clustering foundation.
 *
 * A primary-process cluster coordinator that spawns workers across CPUs with
 * IPC heartbeat monitoring and auto-restart, plus worker-side heartbeat/ready
 * helpers. Zero runtime dependencies. Public API only.
 *
 * ```ts
 * import cluster from 'node:cluster';
 * import { ClusterCoordinator, workerHeartbeat, signalReady } from '@streetjs/cluster';
 *
 * if (cluster.isPrimary) {
 *   new ClusterCoordinator({ workers: 4 }).start();
 * } else {
 *   startServer();
 *   signalReady();
 *   workerHeartbeat();
 * }
 * ```
 *
 * > This is the standalone home of the coordinator that also backs the
 * > `streetjs/cluster` subpath; the `streetjs` framework re-exports it, so there
 * > is a single implementation.
 */

export {
  ClusterCoordinator,
  workerHeartbeat,
  signalReady,
  type ClusterOptions,
  type IpcMessage,
} from './coordinator.js';

/**
 * Dependency-injection token for a {@link ClusterCoordinator}. This package
 * depends on no container, so the token is a plain unique symbol.
 */
export const CLUSTER_COORDINATOR: unique symbol = Symbol.for('@streetjs/cluster:Coordinator');
