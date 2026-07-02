// src/facade.ts
// @streetjs/queue — the strongly-typed Queue facade (Req 1.5, 1.6, 2.1, 2.2,
// 2.3, 2.5, 3.1, 3.2, 3.5, 5.6, 5.8, 13.4, 14.5, 14.6, 14.7).
//
// The facade owns exactly one `QueueDriver` (default `MemoryDriver`), the
// handler registry, the middleware chain container, and the typed event
// emitter. It implements dispatch (envelope build + attempt-ceiling resolution
// + dedupe drop + immediate/delayed enqueue), handler registration, middleware
// registration, event subscription, `work` (returns a `Worker`), the
// dead-letter API surface (fully implemented in task 9.1), and graceful `close`.
//
// Scheduling (`schedule`) is wired in task 8.1 and the DLQ operations in task
// 9.1; those method bodies remain scaffolds here so this task stays focused on
// dispatch/register/lifecycle.

import { systemClock, parseWindow, InMemoryRateLimitStore } from 'streetjs';
import type { HealthCheckRegistry, MetricsRegistry, RateLimitStore, Clock } from 'streetjs';
import type { BackoffPolicy, Job, JobHandler, JobOptions, DeadLetterRecord } from './job.js';
import { buildEnvelope, DEFAULT_QUEUE } from './job.js';
import type { QueueMiddleware } from './middleware.js';
import type { QueueEventMap } from './events.js';
import { QueueEventEmitter } from './events.js';
import type { Worker, WorkerOptions, WorkerContext } from './worker.js';
import { WorkerImpl } from './worker.js';
import type { ResolvedRateLimit } from './worker.js';
import type { QueueDriver } from './drivers/driver.js';
import { MemoryDriver } from './drivers/memory.js';
import { Scheduler, type SchedulerLock } from './scheduler.js';

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
  /**
   * Optional distributed lock for multi-instance exactly-one-fire cron
   * scheduling (Req 4.5). When omitted, each running instance fires a scheduled
   * job once per tick (Req 4.6).
   */
  scheduleLock?: SchedulerLock;
  /**
   * Delayed-promotion tick interval in ms for the scheduler's promotion loop.
   * Default 1000. Lower values reduce delayed-job latency at the cost of more
   * frequent `promoteDue` calls.
   */
  schedulerTickIntervalMs?: number;
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
 * The strongly-typed {@link Queue} implementation. Owns one {@link QueueDriver},
 * the handler registry, the middleware chain, and the typed event emitter.
 */
class QueueFacade implements Queue {
  readonly driver: QueueDriver;
  readonly deadLetters: DeadLetterApi;

  protected readonly options: QueueOptions;
  protected readonly emitter = new QueueEventEmitter();
  /** Injected clock; defaults to wall-clock time (Req 3.1, 3.2). */
  protected readonly clock: Clock;

  /**
   * Resolved per-queue rate limits keyed by queue name, with the window
   * normalized to milliseconds via core `parseWindow` (Req 9.1). Undefined when
   * no `rateLimits` were configured.
   */
  protected readonly rateLimits?: ReadonlyMap<string, ResolvedRateLimit>;
  /**
   * Backing store for the sliding-window rate limiter, shared across every
   * worker so their windows agree (Req 9.4). Defaults to the core
   * `InMemoryRateLimitStore` bound to the injected clock. Present iff
   * {@link rateLimits} is present.
   */
  protected readonly rateLimitStore?: RateLimitStore;

  /** Typed handler registry, keyed by job `type` (Req 2.3). */
  protected readonly handlers = new Map<string, JobHandler<unknown>>();
  /** Middleware chain container, composed in registration order (Req 10.1). */
  protected readonly middleware: QueueMiddleware[] = [];
  /** Workers created via {@link work}, tracked so {@link close} can drain them. */
  protected readonly workers = new Set<Worker>();

  /**
   * The scheduler owning the delayed-promotion loop and cron dispatch (Req 3.x,
   * 4.x). Constructed eagerly so {@link schedule} can register cron entries
   * synchronously (surfacing `CronParseError` at registration), but its
   * promotion loop and cron timers are started lazily on the first {@link work}
   * call — never on mere `createQueue` — so the deterministic `TestHarness`
   * (which drives `promoteDue` itself) stays deterministic and leaks no timers.
   */
  protected readonly scheduler: Scheduler;
  /** True once the scheduler's loop/cron timers have been started (via work()). */
  private schedulerStarted = false;

  /**
   * Facade-owned dedupe registry keyed by `queue\u0000dedupeKey`, mapping to the
   * id of the still-pending/ready job that occupies that key (Req 14.5, 14.7).
   * A duplicate dispatch whose key is already present is dropped (no second
   * envelope) and the existing job id is returned. Entries are removed via
   * {@link releaseDedupeKey}, the documented removal hook the worker calls once
   * a job is acked or dead-lettered.
   */
  protected readonly activeDedupeKeys = new Map<string, string>();

  /**
   * Monotonic dispatch counter. Every call to {@link dispatch} increments this,
   * including a dropped duplicate, so both the original and the dropped
   * duplicate count toward queue dispatch metrics (Req 14.7). Task 12.x wires
   * this onto the core `MetricsRegistry`; kept internal here by design.
   */
  protected dispatchCount = 0;

  /** Monotonic enqueue sequence for FIFO tie-breaking within a priority. */
  protected seq = 0;

  /** Cached driver initialization promise (see {@link ensureInitialized}). */
  private initPromise?: Promise<void>;
  /** Set once {@link close} has been invoked. */
  private closed = false;

  constructor(options: QueueOptions = {}) {
    this.options = options;
    this.clock = options.clock ?? systemClock;
    this.driver = options.driver ?? new MemoryDriver();

    // Resolve per-queue rate limits once (windows normalized to ms) and, when
    // any are configured, bind a shared sliding-window store to the injected
    // clock so every worker enforces the same window (Req 9.1, 9.4).
    this.rateLimits = resolveRateLimits(options.rateLimits);
    this.rateLimitStore =
      this.rateLimits === undefined
        ? undefined
        : options.rateLimitStore ?? new InMemoryRateLimitStore({ clock: this.clock });

    // The scheduler drives delayed-job promotion and cron dispatch. Its dispatch
    // hook is this facade's own `dispatch` so a fired cron entry flows through
    // the exact production dispatch path (envelope build, dedupe, enqueue). The
    // promotion loop and cron timers stay dormant until the first `work()` call.
    this.scheduler = new Scheduler(this.driver, (job, opts) => this.dispatch(job, opts), {
      clock: this.clock,
      tickIntervalMs: options.schedulerTickIntervalMs,
      lock: options.scheduleLock,
    });
    // The DLQ operations are implemented in task 9.1; expose the surface now.
    this.deadLetters = {
      list: () => Promise.reject(new Error('deadLetters.list not implemented (task 9.1)')),
      retry: () => Promise.reject(new Error('deadLetters.retry not implemented (task 9.1)')),
      retryAll: () => Promise.reject(new Error('deadLetters.retryAll not implemented (task 9.1)')),
      flush: () => Promise.reject(new Error('deadLetters.flush not implemented (task 9.1)')),
    };
  }

  async dispatch<T>(job: Job<T>, options?: JobOptions): Promise<string> {
    // The driver must be initialized before any enqueue. A configured driver
    // whose init rejects surfaces a descriptive error and never falls back to
    // Memory (Req 13.4).
    await this.ensureInitialized();

    // Every dispatch counts toward dispatch metrics, including one that ends up
    // dropped as a duplicate (Req 14.7).
    this.dispatchCount += 1;

    // Merge per-instance job options under dispatch-time options (dispatch-time
    // wins), mirroring buildEnvelope's own merge so the resolved queue, dedupe
    // key, delay, and runAt agree with the built envelope.
    const merged: JobOptions = { ...job.options, ...options };
    const queue = merged.queue ?? DEFAULT_QUEUE;

    // Dedupe drop: if a still-pending/ready job in the same queue already holds
    // this dedupe key, drop the duplicate (enqueue no second envelope) and
    // return the existing job id (Req 14.5, 14.7).
    if (merged.dedupeKey !== undefined) {
      const key = dedupeRegistryKey(queue, merged.dedupeKey);
      const existingId = this.activeDedupeKeys.get(key);
      if (existingId !== undefined) {
        return existingId;
      }
      // Reserve the key with the id of the envelope we are about to enqueue.
      const envelope = buildEnvelope(job, options, this.clock, this.nextSeq());
      this.activeDedupeKeys.set(key, envelope.id);
      await this.enqueueEnvelope(queue, envelope, merged);
      return envelope.id;
    }

    const envelope = buildEnvelope(job, options, this.clock, this.nextSeq());
    await this.enqueueEnvelope(queue, envelope, merged);
    return envelope.id;
  }

  schedule(
    cron: string,
    job: (new () => Job<unknown>) | Job<unknown>,
    options?: JobOptions,
  ): void {
    // Delegate cron parsing/next-fire to the scheduler (which wraps the core
    // `CronScheduler`). A malformed expression throws `CronParseError`
    // synchronously here with no partial registration (Req 4.1, 4.3). A fired
    // entry dispatches a fresh job instance through this facade (Req 4.2).
    this.scheduler.schedule(cron, job, options);
  }

  register<T>(type: string, handler: JobHandler<T>): void {
    this.handlers.set(type, handler as JobHandler<unknown>);
  }

  registerClass(
    jobCtor: new (...args: never[]) => Job<unknown>,
    handler: JobHandler<unknown>,
  ): void {
    this.handlers.set(resolveJobType(jobCtor), handler);
  }

  use(middleware: QueueMiddleware): void {
    this.middleware.push(middleware);
  }

  on<K extends keyof QueueEventMap>(event: K, handler: (e: QueueEventMap[K]) => void): void {
    this.emitter.on(event, handler);
  }

  work(options?: WorkerOptions): Worker {
    // Kick off driver initialization so a configured driver whose init rejects
    // surfaces the error. The worker awaits this same readiness promise before
    // its first reservation and stops without reserving if it rejects. Attach a
    // no-op catch so a rejection observed here is not treated as unhandled; the
    // dispatch path and close still observe/re-throw the same cached rejection.
    const ready = this.ensureInitialized();
    void ready.catch(() => undefined);
    const worker = new WorkerImpl(this.buildWorkerContext(ready), options);
    this.workers.add(worker);
    return worker;
  }

  /**
   * Assemble the execution seam the worker consumes: the active driver, the
   * shared handler registry and middleware chain, the typed event emitter, the
   * injected clock, the default backoff, the dedupe-key removal hook, and the
   * driver-readiness gate (Req 7.x, 8.4, 14.1). Keeping this a plain data
   * context leaves the worker decoupled from the facade's internals.
   */
  private buildWorkerContext(ready: Promise<void>): WorkerContext {
    return {
      driver: this.driver,
      handlers: this.handlers,
      middleware: this.middleware,
      emitter: this.emitter,
      clock: this.clock,
      defaultBackoff: this.options.defaultBackoff,
      rateLimits: this.rateLimits,
      rateLimitStore: this.rateLimitStore,
      releaseDedupeKey: (queue, dedupeKey, jobId) =>
        this.releaseDedupeKey(queue, dedupeKey, jobId),
      ready,
    };
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    // Stop reserving new jobs and await in-flight completion across all workers,
    // then close the driver (Req 14.6).
    await Promise.all([...this.workers].map((worker) => worker.stop()));
    await this.driver.close();
  }

  /**
   * Removal hook for the dedupe registry (Req 14.5). Once a job is acked or
   * dead-lettered it is no longer pending/ready, so its dedupe key must be
   * released to admit a fresh dispatch. Called by the worker/DLQ paths (tasks
   * 6.x/9.1); a no-op when the key is absent or the job no longer occupies it.
   */
  releaseDedupeKey(queue: string, dedupeKey: string, jobId?: string): void {
    const key = dedupeRegistryKey(queue, dedupeKey);
    if (jobId === undefined || this.activeDedupeKeys.get(key) === jobId) {
      this.activeDedupeKeys.delete(key);
    }
  }

  /**
   * Enqueue an envelope immediately when there is no future run time, else store
   * it as delayed at the resolved Due_Time (Req 3.1, 3.2, 3.5).
   */
  private async enqueueEnvelope(
    queue: string,
    envelope: ReturnType<typeof buildEnvelope>,
    merged: JobOptions,
  ): Promise<void> {
    const runAt = this.resolveRunAt(merged);
    if (runAt !== undefined && runAt > this.clock()) {
      await this.driver.enqueueDelayed(queue, envelope, runAt);
    } else {
      await this.driver.enqueue(queue, envelope);
    }
  }

  /**
   * Resolve the Due_Time for a dispatch:
   *  - an explicit `runAt` Date maps to its epoch ms (Req 3.2);
   *  - a `delay` (ms or human string via core `parseWindow`) maps to
   *    `now + delay` (Req 3.1);
   *  - otherwise there is no future run time (immediately eligible, Req 3.5).
   */
  private resolveRunAt(merged: JobOptions): number | undefined {
    if (merged.runAt !== undefined) {
      return merged.runAt.getTime();
    }
    if (merged.delay !== undefined) {
      const delayMs = typeof merged.delay === 'number' ? merged.delay : parseWindow(merged.delay);
      return this.clock() + delayMs;
    }
    return undefined;
  }

  /**
   * Initialize the driver exactly once, caching the promise. A rejection is
   * wrapped in a descriptive error and re-thrown on every await; the facade
   * never swaps in the Memory driver as a silent fallback (Req 13.4).
   */
  private ensureInitialized(): Promise<void> {
    if (this.initPromise === undefined) {
      this.initPromise = this.driver.init().catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Queue driver failed to initialize: ${message}`);
      });
    }
    return this.initPromise;
  }

  private nextSeq(): number {
    return this.seq++;
  }
}

/** Compose the dedupe registry key from the queue name and dedupe key. */
function dedupeRegistryKey(queue: string, dedupeKey: string): string {
  return `${queue}\u0000${dedupeKey}`;
}

/**
 * Resolve the configured `rateLimits` option into a queue → {@link ResolvedRateLimit}
 * map, normalizing each human window (`"5m"`) to milliseconds via core
 * `parseWindow` (a numeric window is taken as milliseconds directly). Returns
 * `undefined` when no rate limits are configured so the worker skips the check
 * entirely (Req 9.1, 9.4).
 */
function resolveRateLimits(
  rateLimits: QueueOptions['rateLimits'],
): ReadonlyMap<string, ResolvedRateLimit> | undefined {
  if (rateLimits === undefined) {
    return undefined;
  }
  const resolved = new Map<string, ResolvedRateLimit>();
  for (const [queue, { requests, window }] of Object.entries(rateLimits)) {
    const windowMs = typeof window === 'number' ? window : parseWindow(window);
    resolved.set(queue, { requests, windowMs });
  }
  return resolved;
}

/**
 * Derive a job `type` from its class by instantiating it with no payload and
 * reading the stable `type` field. Job subclasses fix `type` as an instance
 * field, so a payload-less construction is sufficient to read it.
 */
function resolveJobType(jobCtor: new (...args: never[]) => Job<unknown>): string {
  try {
    const instance = new (jobCtor as unknown as new () => Job<unknown>)();
    return instance.type;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `registerClass could not derive a job type from ${jobCtor.name || 'the provided class'}: ${message}`,
    );
  }
}

/** Construct a {@link Queue}. Defaults to a zero-dependency in-process MemoryDriver. */
export function createQueue(options: QueueOptions = {}): Queue {
  return new QueueFacade(options);
}
