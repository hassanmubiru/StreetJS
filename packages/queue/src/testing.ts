// src/testing.ts
// @streetjs/queue — Redis-free testing utilities (Req 16.1–16.4).
//
// `FakeQueue` records dispatch/schedule/events and drives execution
// synchronously; `MemoryQueue` runs a real Queue over the MemoryDriver with a
// real Worker; `TestHarness` builds a Queue with an injected Clock and helpers
// to advance the clock, promote due jobs, reserve, force failures, and assert
// events. `FakeQueue` is implemented in task 2.1; `MemoryQueue`/`TestHarness`
// land in task 2.2.

import type { Clock } from 'streetjs';
import {
  buildEnvelope,
  type Job,
  type JobEnvelope,
  type JobHandler,
  type JobOptions,
  type JobExecutionContext,
  type DeadLetterRecord,
  type SerializedError,
} from './job.js';
import type { Queue, DeadLetterApi } from './facade.js';
import type { QueueMiddleware } from './middleware.js';
import type { QueueEventMap } from './events.js';
import { QueueEventEmitter } from './events.js';
import type { Worker, WorkerOptions } from './worker.js';
import type { QueueDriver } from './drivers/driver.js';

/** A recorded `dispatch(job, options)` call, with the assigned job id. */
export interface DispatchRecord<TPayload = unknown> {
  /** The job id `dispatch` returned for this call. */
  readonly id: string;
  /** The job instance passed to `dispatch`. */
  readonly job: Job<TPayload>;
  /** The dispatch-time options (as passed by the caller). */
  readonly options?: JobOptions;
  /** The resolved named queue the job was dispatched to. */
  readonly queue: string;
}

/** A recorded `schedule(cron, job, options)` call. */
export interface ScheduleRecord {
  readonly cron: string;
  readonly job: (new () => Job<unknown>) | Job<unknown>;
  readonly options?: JobOptions;
}

/** A recorded lifecycle event emitted while driving execution, in emit order. */
export interface EmittedEvent<K extends keyof QueueEventMap = keyof QueueEventMap> {
  readonly event: K;
  readonly payload: QueueEventMap[K];
}

/** Options for constructing a {@link FakeQueue}. */
export interface FakeQueueOptions {
  /**
   * Injected clock used to stamp envelopes and compute (deterministic)
   * durations. Defaults to a fixed `() => 0` clock so the fake never depends on
   * wall-clock timing (Req 16.4).
   */
  clock?: Clock;
}

/** A mutable execution context so tenant-isolation middleware can set `tenantId`. */
type MutableContext = {
  -readonly [K in keyof JobExecutionContext]: JobExecutionContext[K];
};

interface PendingJob {
  readonly envelope: JobEnvelope;
  readonly job: Job<unknown>;
}

interface DeadLetterEntry {
  readonly record: DeadLetterRecord;
  readonly envelope: JobEnvelope;
  readonly job: Job<unknown>;
}

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'Error', message: String(err) };
}

/**
 * A Redis-free, timing-free {@link Queue} test double (Req 16.1, 16.4).
 *
 * `FakeQueue` records every `dispatch` and `schedule` call and every emitted
 * lifecycle event, in order, on the public `dispatched`, `scheduled`, and
 * `events` arrays. It drives execution **synchronously** through `runNext()` /
 * `runAll()` — there is no background loop, no timers, no driver, and no
 * wall-clock timing — so tests can assert *that* a job was dispatched (and with
 * which options) and *that* handlers ran, without any scheduling.
 *
 * It intentionally implements no retry/backoff loop: a handler that throws is
 * recorded as a `job.failed` event and moved to the in-memory dead-letter list.
 * Use `MemoryQueue`/`TestHarness` for end-to-end retry/worker behavior.
 */
export class FakeQueue implements Queue {
  /** Every `dispatch` call, in call order. */
  readonly dispatched: DispatchRecord[] = [];
  /** Every `schedule` call, in call order. */
  readonly scheduled: ScheduleRecord[] = [];
  /** Every lifecycle event emitted while driving execution, in emit order. */
  readonly events: EmittedEvent[] = [];

  readonly deadLetters: DeadLetterApi;

  private readonly clock: Clock;
  private readonly emitter = new QueueEventEmitter();
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly classHandlers: Array<{
    ctor: new (...args: never[]) => Job<unknown>;
    handler: JobHandler<unknown>;
  }> = [];
  private readonly middlewares: QueueMiddleware[] = [];
  private readonly pending: PendingJob[] = [];
  private deadLetterEntries: DeadLetterEntry[] = [];
  private seq = 0;

  constructor(options: FakeQueueOptions = {}) {
    this.clock = options.clock ?? (() => 0);
    this.deadLetters = this.buildDeadLetterApi();
  }

  // ── Queue surface ───────────────────────────────────────────────────────────

  /** Record the dispatch and enqueue the job for synchronous execution. */
  dispatch<T>(job: Job<T>, options?: JobOptions): Promise<string> {
    const envelope = buildEnvelope(job, options, this.clock, this.seq++);
    this.dispatched.push({ id: envelope.id, job, options, queue: envelope.queue });
    this.pending.push({ envelope, job: job as Job<unknown> });
    return Promise.resolve(envelope.id);
  }

  /** Record the schedule call. FakeQueue never fires cron on a timer. */
  schedule(
    cron: string,
    job: (new () => Job<unknown>) | Job<unknown>,
    options?: JobOptions,
  ): void {
    this.scheduled.push({ cron, job, options });
  }

  /** Register the handler for a job type. */
  register<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler<unknown>);
  }

  /** Register a handler keyed by a `Job` subclass (matched via `instanceof`). */
  registerClass(
    jobCtor: new (...args: never[]) => Job<unknown>,
    handler: JobHandler<unknown>,
  ): void {
    this.classHandlers.push({ ctor: jobCtor, handler });
  }

  /** Append a middleware to the execution pipeline (composed in order). */
  use(middleware: QueueMiddleware): void {
    this.middlewares.push(middleware);
  }

  /** Subscribe to a lifecycle event. */
  on<K extends keyof QueueEventMap>(event: K, handler: (e: QueueEventMap[K]) => void): void {
    this.emitter.on(event, handler);
  }

  /**
   * FakeQueue drives execution synchronously via {@link runNext}/{@link runAll}
   * and has no background worker loop.
   */
  work(_options?: WorkerOptions): Worker {
    throw new Error(
      'FakeQueue has no worker loop; drive execution synchronously with runNext()/runAll().',
    );
  }

  /** FakeQueue has no backend driver; use runNext()/runAll() to execute jobs. */
  get driver(): QueueDriver {
    throw new Error('FakeQueue has no driver; it records dispatches and runs jobs synchronously.');
  }

  /** Clear all pending jobs and recorded state. */
  close(): Promise<void> {
    this.pending.length = 0;
    return Promise.resolve();
  }

  // ── Synchronous execution drivers ────────────────────────────────────────────

  /** How many dispatched jobs are waiting to be run. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Run the next pending dispatched job through its registered handler.
   * Returns `true` if a job ran, or `false` if there was nothing pending.
   */
  async runNext(): Promise<boolean> {
    const next = this.pending.shift();
    if (!next) {
      return false;
    }
    await this.execute(next);
    return true;
  }

  /**
   * Run every pending dispatched job (including any dispatched while running)
   * through its handler. Returns the number of jobs executed.
   */
  async runAll(): Promise<number> {
    let count = 0;
    while (this.pending.length > 0) {
      // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
      await this.runNext();
      count += 1;
    }
    return count;
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  private async execute(pending: PendingJob): Promise<void> {
    const { envelope, job } = pending;
    envelope.attempts += 1;

    const ctx: MutableContext = {
      id: envelope.id,
      type: envelope.type,
      queue: envelope.queue,
      attempt: envelope.attempts,
      maxAttempts: envelope.maxAttempts,
      enqueuedAt: envelope.enqueuedAt,
      tenantId: undefined,
      signal: new AbortController().signal,
    };

    const handler = this.resolveHandler(envelope.type, job);
    const start = this.clock();
    this.record('job.started', { ctx });

    try {
      if (!handler) {
        throw new Error(`No handler registered for job type "${envelope.type}".`);
      }
      await this.runPipeline(ctx, envelope.payload, handler);
      this.record('job.completed', { ctx, durationMs: this.clock() - start });
    } catch (err) {
      const error = serializeError(err);
      this.deadLetterEntries.push({
        record: this.toDeadLetterRecord(envelope, error),
        envelope,
        job,
      });
      this.record('job.failed', { ctx, error });
    }
  }

  private resolveHandler(type: string, job: Job<unknown>): JobHandler<unknown> | undefined {
    const byType = this.handlers.get(type);
    if (byType) {
      return byType;
    }
    return this.classHandlers.find((entry) => job instanceof entry.ctor)?.handler;
  }

  /** Compose middleware in registration order with the handler as terminal step. */
  private async runPipeline(
    ctx: JobExecutionContext,
    payload: unknown,
    handler: JobHandler<unknown>,
  ): Promise<void> {
    const chain = this.middlewares;
    let lastIndex = -1;

    const invoke = async (index: number): Promise<void> => {
      if (index <= lastIndex) {
        throw new Error('next() called multiple times in a queue middleware.');
      }
      lastIndex = index;
      const middleware = chain[index];
      if (middleware) {
        await middleware(ctx, payload, () => invoke(index + 1));
      } else {
        await handler(payload, ctx);
      }
    };

    await invoke(0);
  }

  private record<K extends keyof QueueEventMap>(event: K, payload: QueueEventMap[K]): void {
    this.events.push({ event, payload } as EmittedEvent);
    this.emitter.emit(event, payload);
  }

  private toDeadLetterRecord(envelope: JobEnvelope, error: SerializedError): DeadLetterRecord {
    return {
      id: envelope.id,
      type: envelope.type,
      queue: envelope.queue,
      payload: envelope.payload,
      attempts: envelope.attempts,
      maxAttempts: envelope.maxAttempts,
      backoff: envelope.backoff,
      error,
      enqueuedAt: envelope.enqueuedAt,
      failedAt: this.clock(),
    };
  }

  private buildDeadLetterApi(): DeadLetterApi {
    return {
      list: (queue?: string, limit?: number): Promise<DeadLetterRecord[]> => {
        let records = this.deadLetterEntries.map((entry) => entry.record);
        if (queue !== undefined) {
          records = records.filter((record) => record.queue === queue);
        }
        if (limit !== undefined) {
          records = records.slice(0, limit);
        }
        return Promise.resolve(records);
      },
      retry: (jobId: string): Promise<void> => {
        const index = this.deadLetterEntries.findIndex((entry) => entry.record.id === jobId);
        if (index !== -1) {
          const [entry] = this.deadLetterEntries.splice(index, 1);
          entry.envelope.attempts = 0;
          this.pending.push({ envelope: entry.envelope, job: entry.job });
        }
        return Promise.resolve();
      },
      retryAll: (queue?: string): Promise<number> => {
        const ids = this.deadLetterEntries
          .filter((entry) => queue === undefined || entry.record.queue === queue)
          .map((entry) => entry.record.id);
        for (const id of ids) {
          void this.deadLetters.retry(id);
        }
        return Promise.resolve(ids.length);
      },
      flush: (queue?: string): Promise<number> => {
        const before = this.deadLetterEntries.length;
        this.deadLetterEntries = this.deadLetterEntries.filter((entry) =>
          queue === undefined ? false : entry.record.queue !== queue,
        );
        return Promise.resolve(before - this.deadLetterEntries.length);
      },
    };
  }
}

/** Runs a real Queue over the MemoryDriver with a real Worker (no Redis). */
export class MemoryQueue {
  constructor() {
    throw new Error('MemoryQueue not implemented (task 2.2)');
  }
}

export interface TestHarnessOptions {
  clock?: Clock;
}

/** Builds a Queue with an injected Clock plus advance/reserve/assert helpers. */
export class TestHarness {
  constructor(_options: TestHarnessOptions = {}) {
    throw new Error('TestHarness not implemented (task 2.2)');
  }

  /** The queue under test. */
  get queue(): Queue {
    throw new Error('TestHarness.queue not implemented (task 2.2)');
  }

  /** Enqueue a job. */
  enqueue(_job: Job<unknown>, _options?: JobOptions): Promise<string> {
    throw new Error('TestHarness.enqueue not implemented (task 2.2)');
  }

  /** Advance the injected clock, running delayed promotion and rate windows. */
  advance(_ms: number): Promise<void> {
    throw new Error('TestHarness.advance not implemented (task 2.2)');
  }
}
