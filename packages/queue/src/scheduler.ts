// src/scheduler.ts
// @streetjs/queue — delayed-job promotion loop + cron scheduling (Req 3.1, 3.2,
// 4.1–4.6, 5.1).
//
// Wraps the reused core `CronScheduler` for recurring dispatch and runs a
// due-time promotion loop (`driver.promoteDue(now)`) for delayed jobs. The full
// implementation lands in task 8.1; the class below is a compiling scaffold.

import type { Clock } from 'streetjs';
import type { Job, JobOptions } from './job.js';
import type { QueueDriver } from './drivers/driver.js';

export interface SchedulerOptions {
  clock?: Clock;
  /** Promotion tick interval in ms. Default 1000. */
  tickIntervalMs?: number;
}

/** Promotes due delayed jobs and dispatches cron entries through the facade. */
export class Scheduler {
  constructor(
    protected readonly driver: QueueDriver,
    protected readonly dispatch: (job: Job<unknown>, options?: JobOptions) => Promise<string>,
    protected readonly options: SchedulerOptions = {},
  ) {}

  /** Register a recurring job by cron expression (delegates to core CronScheduler). */
  schedule(
    _cron: string,
    _job: (new () => Job<unknown>) | Job<unknown>,
    _options?: JobOptions,
  ): void {
    throw new Error('Scheduler.schedule not implemented (task 8.1)');
  }

  /** Begin the delayed-promotion loop. */
  start(): void {
    throw new Error('Scheduler.start not implemented (task 8.1)');
  }

  /** Stop the promotion loop and cron scheduler. */
  async stop(): Promise<void> {
    throw new Error('Scheduler.stop not implemented (task 8.1)');
  }
}
