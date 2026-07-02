// src/facade.ts
// @streetjs/queue — the strongly-typed Queue facade surface (Req 1.5, 1.6, 2.x,
// 3.x, 5.6, 5.8, 13.4, 14.x).
//
// Declares `QueueOptions`, `Queue`, `DeadLetterApi`, and the `createQueue`
// factory. The facade owns exactly one `QueueDriver` (default `MemoryDriver`),
// the handler registry, the middleware chain, the typed event emitter, the
// retry engine, and the scheduler. Dispatch/register/work/close semantics are
// implemented in task 5.1 (and the DLQ API in task 9.1); the class below is a
// compiling scaffold that establishes the public typed surface.

import type { HealthCheckRegistry, MetricsRegistry, RateLimitStore, Clock } from 'streetjs';
import type { BackoffPolicy, Job, JobHandler, JobOptions, DeadLetterRecord } from './job.js';
import type { QueueMiddleware } from './middleware.js';
import type { QueueEventMap } from './events.js';
import { QueueEventEmitter } from './events.js';
import type { Worker, WorkerOptions } from './worker.js';
import { WorkerImpl } from './worker.js';
import type { QueueDriver } from './drivers/driver.js';
import { MemoryDriver } from './drivers/memory.js';

export interface QueueOptions {
  /** Backend. Defaults to a MemoryDriver (zero-dep, in-process). */
  driver?: QueueDriver;
  /** Default named queue for dispatch. Default "default". */
  defaultQueue?: string;
  /** Default retry/backoff applied when a job/dispatch omits one. */
  defaultBackoff?: BackoffPolicy;
  /** Default per-attempt timeout (ms or human string). */
  defaultTimeout?: number | string;
  /** Per-queue rate limits: { requests, window } keyed by queue name. */
  rateLimits?: Record<string, { requests: number; window: string | number }>;
  /** Backing store for rate limits; defaults to core InMemoryRateLimitStore. */
  rateLimitStore?: RateLimitStore;
  /** Injected clock for deterministic delay/backoff/rate timing in tests. */
  clock?: Clock;
  /** Observability wiring (reuses core registries). */
  health?: HealthCheckRegistry;
  metrics?: MetricsRegistry;
}

export interface Queue {
  /** Enqueue a job for asynchronous processing. Returns the assigned job id. */
  dispatch<T>(job: Job<T>, options?: JobOptions): Promise<string>;

  /** Register a recurring job by cron expression (reuses core CronScheduler). */
  schedule(
    cron: string,
    job: (new () => Job<unknown>) | Job<unknown>,
    options?: JobOptions,
  ): void;

  /** Register the handler for a job type (typed to the job's payload). */
  register<T>(type: string, handler: JobHandler<T>): void;

  /** Register a Job subclass whose `type`/handler are derived from the class. */
  registerClass(
    jobCtor: new (...args: never[]) => Job<unknown>,
    handler: JobHandler<unknown>,
  ): void;

  /** Append a middleware to the execution pipeline (composed in order). */
  use(middleware: QueueMiddleware): void;

  /** Subscribe to a lifecycle event (typed by the event map). */
  on<K extends keyof QueueEventMap>(event: K, handler: (e: QueueEventMap[K]) => void): void;

  /** Start processing one or more queues with the given worker options. */
  work(options?: WorkerOptions): Worker;

  /** The active driver (MemoryDriver by default). */
  readonly driver: QueueDriver;

  /** Inspect / operate on the dead-letter queue. */
  readonly deadLetters: DeadLetterApi;

  /** Graceful shutdown: stop workers/scheduler, drain in-flight, close driver. */
  close(): Promise<void>;
}

/** DLQ operations backing `street queue:failed` / `queue:retry` / `queue:flush`. */
export interface DeadLetterApi {
  list(queue?: string, limit?: number): Promise<DeadLetterRecord[]>;
  /** Re-enqueue a dead-letter record with attempts reset. */
  retry(jobId: string): Promise<void>;
  retryAll(queue?: string): Promise<number>;
  flush(queue?: string): Promise<number>;
}

/**
 * Scaffold facade implementing the public {@link Queue} surface. Dispatch,
 * scheduling, worker wiring, and DLQ operations are implemented in tasks 5.1
 * and 9.1.
 */
class QueueFacade implements Queue {
  readonly driver: QueueDriver;
  readonly deadLetters: DeadLetterApi;

  protected readonly options: QueueOptions;
  protected readonly emitter = new QueueEventEmitter();

  constructor(options: QueueOptions = {}) {
    this.options = options;
    this.driver = options.driver ?? new MemoryDriver();
    this.deadLetters = {
      list: () => Promise.reject(new Error('deadLetters.list not implemented (task 9.1)')),
      retry: () => Promise.reject(new Error('deadLetters.retry not implemented (task 9.1)')),
      retryAll: () => Promise.reject(new Error('deadLetters.retryAll not implemented (task 9.1)')),
      flush: () => Promise.reject(new Error('deadLetters.flush not implemented (task 9.1)')),
    };
  }

  dispatch<T>(_job: Job<T>, _options?: JobOptions): Promise<string> {
    return Promise.reject(new Error('Queue.dispatch not implemented (task 5.1)'));
  }

  schedule(
    _cron: string,
    _job: (new () => Job<unknown>) | Job<unknown>,
    _options?: JobOptions,
  ): void {
    throw new Error('Queue.schedule not implemented (task 8.1)');
  }

  register<T>(_type: string, _handler: JobHandler<T>): void {
    throw new Error('Queue.register not implemented (task 5.1)');
  }

  registerClass(
    _jobCtor: new (...args: never[]) => Job<unknown>,
    _handler: JobHandler<unknown>,
  ): void {
    throw new Error('Queue.registerClass not implemented (task 5.1)');
  }

  use(_middleware: QueueMiddleware): void {
    throw new Error('Queue.use not implemented (task 10.1)');
  }

  on<K extends keyof QueueEventMap>(event: K, handler: (e: QueueEventMap[K]) => void): void {
    this.emitter.on(event, handler);
  }

  work(options?: WorkerOptions): Worker {
    return new WorkerImpl(this.driver, options);
  }

  close(): Promise<void> {
    return Promise.reject(new Error('Queue.close not implemented (task 5.1)'));
  }
}

/** Construct a {@link Queue}. Defaults to a zero-dependency in-process MemoryDriver. */
export function createQueue(options: QueueOptions = {}): Queue {
  return new QueueFacade(options);
}
