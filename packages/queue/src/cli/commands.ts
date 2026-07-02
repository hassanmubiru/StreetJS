// src/cli/commands.ts
// @streetjs/queue — CLI commands registered through the reused core CliKernel
// (Req 15.1, 15.5).
//
// Provides `make:job`, `make:worker`, `queue:work`, `queue:listen`,
// `queue:retry`, `queue:failed`, and `queue:flush` as `@Command`-decorated
// methods. The generator commands delegate to the pure functions in
// `generators.ts`; the operational commands (`queue:failed`/`queue:retry`/
// `queue:flush`) drive the facade's `DeadLetterApi`, and `queue:work`/
// `queue:listen` start a worker over the configured queues.
//
// How the class obtains a Queue: the queue used by the `queue:*` operations is
// resolved lazily. A concrete `Queue` (or a factory) may be injected via the
// constructor — this is how the CLI tests (task 16.2) drive `queue:failed`/
// `queue:retry`/`queue:flush` against a probe queue — and when neither is
// supplied the class builds a default (zero-dependency, MemoryDriver) queue via
// `createQueue()`. The generator commands need no queue at all.
//
// The class carries no class-level decorator, so no constructor dependency
// metadata is emitted and the core `CliKernel` can `container.resolve` it with
// no registered dependencies (it is constructed with its default options).

import { Command } from 'streetjs';
import type { ParsedArgs } from 'streetjs';
import { createQueue } from '../facade.js';
import type { Queue } from '../facade.js';
import {
  generateJob,
  generateWorker,
  isValidGeneratorName,
  writeScaffold,
  type GenerateResult,
} from './generators.js';

/** Construction options for {@link QueueCommands}. */
export interface QueueCommandsOptions {
  /** A concrete queue for the `queue:*` operations (used by tests). */
  queue?: Queue;
  /** A factory used to lazily build the queue when none is injected. */
  createQueue?: () => Queue;
}

/** Queue CLI command group registered with the core CliKernel. */
export class QueueCommands {
  private readonly injectedQueue?: Queue;
  private readonly queueFactory: () => Queue;
  private lazyQueue?: Queue;

  constructor(options: QueueCommandsOptions = {}) {
    this.injectedQueue = options.queue;
    this.queueFactory = options.createQueue ?? (() => createQueue());
  }

  // ── Generators ──────────────────────────────────────────────────────────────

  /** `street make:job <Name> [--dir ./jobs]` — scaffold a Job. */
  @Command('make:job', 'Scaffold a new Job class (make:job <Name> [--dir <dir>])')
  makeJob(args: ParsedArgs): void {
    this.runGenerator(args, 'job', (name, dir) => generateJob(name, dir));
  }

  /** `street make:worker <Name> [--dir ./workers]` — scaffold a Worker. */
  @Command('make:worker', 'Scaffold a new Worker (make:worker <Name> [--dir <dir>])')
  makeWorker(args: ParsedArgs): void {
    this.runGenerator(args, 'worker', (name, dir) => generateWorker(name, dir));
  }

  // ── Operational (dead-letter) commands ────────────────────────────────────────

  /** `street queue:failed [--queue <name>]` — list dead-letter records (Req 15.5). */
  @Command('queue:failed', 'List dead-letter records (queue:failed [--queue <name>])')
  async queueFailed(args: ParsedArgs): Promise<void> {
    const queue = this.optionalQueueName(args);
    const records = await this.getQueue().deadLetters.list(queue);
    if (records.length === 0) {
      console.log('[queue] No dead-letter records.');
      return;
    }
    console.log(`[queue] ${records.length} dead-letter record(s):`);
    for (const record of records) {
      console.log(
        `  ${record.id} | ${record.type} | queue=${record.queue} | ` +
          `attempts=${record.attempts} | ${record.error.name}: ${record.error.message}`,
      );
    }
  }

  /**
   * `street queue:retry [<jobId>|--id <jobId>] [--queue <name>]` — re-enqueue
   * dead-letter records with attempts reset (Req 15.5). With a job id, retries
   * that single record; otherwise retries every record (optionally scoped to a
   * queue).
   */
  @Command('queue:retry', 'Re-enqueue dead-letter records with attempts reset (queue:retry [<jobId>])')
  async queueRetry(args: ParsedArgs): Promise<void> {
    const deadLetters = this.getQueue().deadLetters;
    const jobId = this.resolveJobId(args);
    if (jobId !== undefined) {
      await deadLetters.retry(jobId);
      console.log(`[queue] Re-enqueued dead-letter job ${jobId}.`);
      return;
    }
    const queue = this.optionalQueueName(args);
    const count = await deadLetters.retryAll(queue);
    console.log(`[queue] Re-enqueued ${count} dead-letter record(s).`);
  }

  /** `street queue:flush [--queue <name>]` — purge dead-letter records (Req 15.5). */
  @Command('queue:flush', 'Purge dead-letter records (queue:flush [--queue <name>])')
  async queueFlush(args: ParsedArgs): Promise<void> {
    const queue = this.optionalQueueName(args);
    const count = await this.getQueue().deadLetters.flush(queue);
    console.log(`[queue] Purged ${count} dead-letter record(s).`);
  }

  // ── Worker commands ───────────────────────────────────────────────────────────

  /**
   * `street queue:work [--queues a,b] [--concurrency N]` — start a worker over
   * the configured queues (Req 15.1).
   */
  @Command('queue:work', 'Start a worker over the configured queues (queue:work [--queues a,b] [--concurrency N])')
  async queueWork(args: ParsedArgs): Promise<void> {
    await this.startWorker(args);
  }

  /** `street queue:listen` — start a worker (alias of queue:work). */
  @Command('queue:listen', 'Start a worker over the configured queues (alias of queue:work)')
  async queueListen(args: ParsedArgs): Promise<void> {
    await this.startWorker(args);
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  /**
   * Resolve, validate, render, and write a generator scaffold. Validation runs
   * before any file is generated; a failed validation aborts with no file
   * written (Req 15.2, 15.7) and an existing target is never overwritten
   * (Req 15.3). A non-existent target is generated cleanly (Req 15.6).
   */
  private runGenerator(
    args: ParsedArgs,
    kind: 'job' | 'worker',
    generate: (name: string, dir?: string) => GenerateResult,
  ): void {
    const name = this.resolveName(args);
    if (!isValidGeneratorName(name)) {
      console.error(
        `[queue] Invalid ${kind} name: "${name}". ` +
          `Use a PascalCase identifier (a letter followed by letters or digits).`,
      );
      process.exitCode = 1;
      return;
    }

    const dir = typeof args.flags['dir'] === 'string' ? args.flags['dir'] : undefined;
    const result = generate(name, dir);
    try {
      writeScaffold(result);
    } catch (err) {
      console.error(`[queue] ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
      return;
    }
    console.log(`[queue] Generated ${kind}: ${result.path}`);
  }

  /** Start a worker over the queues/concurrency parsed from flags. */
  private async startWorker(args: ParsedArgs): Promise<void> {
    const queue = this.getQueue();
    const queues = this.parseQueues(args);
    const concurrency = this.parseConcurrency(args);
    const worker = queue.work({ queues, concurrency });
    worker.start();
    const status = worker.status();
    console.log(
      `[queue] Worker started over queues [${status.queues.join(', ')}] ` +
        `at concurrency ${status.concurrency}.`,
    );
  }

  /** Lazily resolve the queue used by the `queue:*` operations. */
  private getQueue(): Queue {
    if (this.injectedQueue !== undefined) {
      return this.injectedQueue;
    }
    if (this.lazyQueue === undefined) {
      this.lazyQueue = this.queueFactory();
    }
    return this.lazyQueue;
  }

  /** Read the generator name from the first positional arg or `--name`. */
  private resolveName(args: ParsedArgs): string {
    const positional = args.positional[0];
    if (typeof positional === 'string') {
      return positional;
    }
    return typeof args.flags['name'] === 'string' ? args.flags['name'] : '';
  }

  /** Read an optional job id from the first positional arg or `--id`. */
  private resolveJobId(args: ParsedArgs): string | undefined {
    if (typeof args.flags['id'] === 'string') {
      return args.flags['id'];
    }
    const positional = args.positional[0];
    return typeof positional === 'string' ? positional : undefined;
  }

  /** Read an optional `--queue <name>` scope. */
  private optionalQueueName(args: ParsedArgs): string | undefined {
    return typeof args.flags['queue'] === 'string' ? args.flags['queue'] : undefined;
  }

  /** Parse `--queues a,b,c` into a queue list, or `undefined` to use the default. */
  private parseQueues(args: ParsedArgs): string[] | undefined {
    const raw = args.flags['queues'];
    if (typeof raw !== 'string') {
      return undefined;
    }
    const queues = raw
      .split(',')
      .map((q) => q.trim())
      .filter((q) => q.length > 0);
    return queues.length > 0 ? queues : undefined;
  }

  /** Parse `--concurrency N` into a positive integer, or `undefined` for the default. */
  private parseConcurrency(args: ParsedArgs): number | undefined {
    const raw = args.flags['concurrency'];
    if (raw === undefined || raw === true) {
      return undefined;
    }
    const parsed = Number.parseInt(String(raw), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  }
}
