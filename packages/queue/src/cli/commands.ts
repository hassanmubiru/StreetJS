// src/cli/commands.ts
// @streetjs/queue — CLI commands registered through the reused core CliKernel
// (Req 15.1, 15.5).
//
// Provides `make:job`, `make:worker`, `queue:work`, `queue:listen`,
// `queue:retry`, `queue:failed`, and `queue:flush` as `@Command`-decorated
// methods. Operational commands (`queue:retry`/`queue:failed`/`queue:flush`)
// drive the `DeadLetterApi`. Implemented in task 16.1; the class below is a
// compiling scaffold.

import type { Queue } from '../facade.js';

/** Queue CLI command group registered with the core CliKernel. */
export class QueueCommands {
  constructor(protected readonly queue?: Queue) {}

  /** `street make:job <name>` — scaffold a Job. */
  makeJob(): void {
    throw new Error('QueueCommands.makeJob not implemented (task 16.1)');
  }

  /** `street make:worker <name>` — scaffold a Worker. */
  makeWorker(): void {
    throw new Error('QueueCommands.makeWorker not implemented (task 16.1)');
  }

  /** `street queue:work` — start a worker over the configured queues. */
  queueWork(): Promise<void> {
    throw new Error('QueueCommands.queueWork not implemented (task 16.1)');
  }

  /** `street queue:listen` — start a worker (alias of queue:work). */
  queueListen(): Promise<void> {
    throw new Error('QueueCommands.queueListen not implemented (task 16.1)');
  }

  /** `street queue:failed` — list dead-letter records. */
  queueFailed(): Promise<void> {
    throw new Error('QueueCommands.queueFailed not implemented (task 16.1)');
  }

  /** `street queue:retry` — re-enqueue dead-letter records with attempts reset. */
  queueRetry(): Promise<void> {
    throw new Error('QueueCommands.queueRetry not implemented (task 16.1)');
  }

  /** `street queue:flush` — purge dead-letter records. */
  queueFlush(): Promise<void> {
    throw new Error('QueueCommands.queueFlush not implemented (task 16.1)');
  }
}
