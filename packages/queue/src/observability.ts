// src/observability.ts
// @streetjs/queue — health check + metrics wiring (Req 12.1–12.6).
//
// Registers a queue health check against the reused core `HealthCheckRegistry`
// and exports queue-length/worker-status/latency/processed/failure metrics
// through the reused core `MetricsRegistry`. The full wiring lands in task 12.1;
// the function below is a compiling scaffold.

import type { HealthCheckRegistry, MetricsRegistry } from 'streetjs';
import type { QueueDriver } from './drivers/driver.js';
import type { Worker } from './worker.js';

/** Well-known name of the queue health check. */
export const QUEUE_HEALTH_CHECK_NAME = 'queue';

export interface QueueObservabilityDeps {
  driver: QueueDriver;
  worker?: Worker;
  health?: HealthCheckRegistry;
  metrics?: MetricsRegistry;
}

export interface QueueObservabilityHandle {
  /** Stop any refresh timers and unregister. */
  close(): void;
}

/**
 * Register the queue health check and metrics against the provided core
 * registries. Implemented in task 12.1.
 */
export function registerQueueObservability(
  _deps: QueueObservabilityDeps,
): QueueObservabilityHandle {
  throw new Error('registerQueueObservability not implemented (task 12.1)');
}
