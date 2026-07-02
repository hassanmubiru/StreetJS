// src/worker.ts
// @streetjs/queue — worker types and a scaffold reservation loop
// (Req 7.1–7.5, 8.4, 9.1–9.4, 14.1, 14.2, 14.4).
//
// This module declares the public `Worker`/`WorkerOptions`/`WorkerStatus`
// surface. The concrete concurrency-bounded reservation loop (priority order,
// per-queue rate limiting, per-attempt timeout, retry/DLQ routing) is
// implemented in tasks 6.1–6.3; the class below is a compiling scaffold.

import type { QueueDriver } from './drivers/driver.js';

export interface WorkerOptions {
  /** Which queues to consume (priority order among queues left-to-right). */
  queues?: string[];
  /** Max jobs processed concurrently by this worker. Default 1. */
  concurrency?: number;
  /** Poll interval when the driver has no push wake-up. Default 1000ms. */
  pollIntervalMs?: number;
  /** Stop after the queue drains (used by tests / one-shot runs). */
  stopWhenEmpty?: boolean;
}

export interface Worker {
  /** Begin the reservation loop. Idempotent. */
  start(): void;
  /** Stop reserving new jobs and await in-flight completion (graceful drain). */
  stop(): Promise<void>;
  /** Live status surfaced to the health check / metrics. */
  status(): WorkerStatus;
}

export interface WorkerStatus {
  running: boolean;
  concurrency: number;
  /** Currently executing. */
  inFlight: number;
  processed: number;
  failed: number;
  queues: string[];
}

/**
 * Scaffold worker. The reservation loop, concurrency bound, rate limiting,
 * timeout handling, and retry/DLQ routing are implemented in tasks 6.1–6.3.
 */
export class WorkerImpl implements Worker {
  protected running = false;
  protected readonly queues: string[];
  protected readonly concurrency: number;
  protected readonly pollIntervalMs: number;
  protected readonly stopWhenEmpty: boolean;
  protected inFlight = 0;
  protected processed = 0;
  protected failed = 0;

  constructor(
    protected readonly driver: QueueDriver,
    options: WorkerOptions = {},
  ) {
    this.queues = options.queues ?? ['default'];
    this.concurrency = options.concurrency ?? 1;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.stopWhenEmpty = options.stopWhenEmpty ?? false;
  }

  start(): void {
    throw new Error('WorkerImpl.start not implemented (task 6.1)');
  }

  async stop(): Promise<void> {
    throw new Error('WorkerImpl.stop not implemented (task 6.1)');
  }

  status(): WorkerStatus {
    return {
      running: this.running,
      concurrency: this.concurrency,
      inFlight: this.inFlight,
      processed: this.processed,
      failed: this.failed,
      queues: [...this.queues],
    };
  }
}
