// src/testing.ts
// @streetjs/queue — Redis-free testing utilities (Req 16.1–16.4).
//
// `FakeQueue` records dispatch/schedule/events and drives execution
// synchronously; `MemoryQueue` runs a real Queue over the MemoryDriver with a
// real Worker; `TestHarness` builds a Queue with an injected Clock and helpers
// to advance the clock, promote due jobs, reserve, force failures, and assert
// events. `FakeQueue` is implemented in task 2.1; `MemoryQueue`/`TestHarness`
// land in task 2.2.

import type { Clock, RateLimitStore } from 'streetjs';
import {
  buildEnvelope,
  type BackoffPolicy,
  type Job,
  type JobEnvelope,
  type JobHandler,
  type JobOptions,
  type JobExecutionContext,
  type DeadLetterRecord,
  type SerializedError,
} from './job.js';
import type { Queue, DeadLetterApi, QueueOptions } from './facade.js';
import { createQueue } from './facade.js';
import type { QueueMiddleware } from './middleware.js';
import type { QueueEventMap } from './events.js';
import { QueueEventEmitter } from './events.js';
import type { Worker, WorkerOptions } from './worker.js';
import type { QueueDriver, Reservation } from './drivers/driver.js';
import { MemoryDriver } from './drivers/memory.js';
import { DEFAULT_BACKOFF, onFailure, type RetryDecision } from './retry.js';

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

/** Options for constructing a {@link MemoryQueue}. */
export interface MemoryQueueOptions extends Omit<QueueOptions, 'driver'> {
  /**
   * Backend driver. Defaults to a fresh {@link MemoryDriver} so the queue runs
   * entirely in-process with zero third-party runtime dependencies (Req 16.2).
   * Supplying a driver is chiefly useful for inspecting driver state in tests.
   */
  driver?: QueueDriver;
}

/**
 * A real {@link Queue} over the {@link MemoryDriver} with a real {@link Worker}
 * for end-to-end behavior without Redis (Req 16.2, 16.4).
 *
 * Unlike {@link FakeQueue} (which records calls and runs jobs synchronously with
 * no driver) and {@link TestHarness} (which drives the driver directly with an
 * injected, advanceable clock), `MemoryQueue` wires the *production* code path:
 * `createQueue({ driver: new MemoryDriver() })` plus the real worker loop
 * obtained from {@link Queue.work}. It opens no socket and needs no Redis.
 *
 * `MemoryQueue` implements the full {@link Queue} surface by delegation and also
 * exposes the underlying {@link queue} and {@link driver} for assertions. Its
 * {@link work} method is a straight passthrough to the real worker, so a call
 * such as `mq.work({ concurrency: 4 })` starts genuine end-to-end processing the
 * moment the worker reservation loop is available.
 */
export class MemoryQueue implements Queue {
  /** The underlying real {@link Queue} (MemoryDriver-backed). */
  readonly queue: Queue;

  constructor(options: MemoryQueueOptions = {}) {
    const { driver, ...queueOptions } = options;
    this.queue = createQueue({
      ...queueOptions,
      driver: driver ?? new MemoryDriver(),
    });
  }

  /** The active in-process driver (a {@link MemoryDriver} by default). */
  get driver(): QueueDriver {
    return this.queue.driver;
  }

  /** Inspect / operate on the dead-letter queue. */
  get deadLetters(): DeadLetterApi {
    return this.queue.deadLetters;
  }

  dispatch<T>(job: Job<T>, options?: JobOptions): Promise<string> {
    return this.queue.dispatch(job, options);
  }

  schedule(
    cron: string,
    job: (new () => Job<unknown>) | Job<unknown>,
    options?: JobOptions,
  ): void {
    this.queue.schedule(cron, job, options);
  }

  register<T>(type: string, handler: JobHandler<T>): void {
    this.queue.register(type, handler);
  }

  registerClass(
    jobCtor: new (...args: never[]) => Job<unknown>,
    handler: JobHandler<unknown>,
  ): void {
    this.queue.registerClass(jobCtor, handler);
  }

  use(middleware: QueueMiddleware): void {
    this.queue.use(middleware);
  }

  on<K extends keyof QueueEventMap>(event: K, handler: (e: QueueEventMap[K]) => void): void {
    this.queue.on(event, handler);
  }

  /**
   * Start end-to-end processing with a real {@link Worker}. This is a direct
   * passthrough to the real worker loop (no fake substitute); it drives the
   * genuine reserve → middleware → handler → retry/DLQ path over the
   * MemoryDriver.
   */
  work(options?: WorkerOptions): Worker {
    return this.queue.work(options);
  }

  /** Graceful shutdown: stop the worker, drain in-flight, close the driver. */
  close(): Promise<void> {
    return this.queue.close();
  }
}

/** Options for constructing a {@link TestHarness}. */
export interface TestHarnessOptions {
  /**
   * Seed value for the harness's mutable clock. The harness always owns an
   * internal, advanceable clock (`() => now`) so {@link TestHarness.advance} can
   * move time deterministically; `now` sets its starting value. Default 0.
   */
  now?: number;
  /**
   * Backward-compatible seed: when provided, the harness reads it once to seed
   * `now`. The harness does NOT delegate timing to this clock afterwards — it
   * injects its own advanceable clock into the queue so `advance` is meaningful.
   */
  clock?: Clock;
  /**
   * Backend driver under test. Defaults to a fresh {@link MemoryDriver}. A
   * driver is accepted so Property 8 can drive the same script against a
   * simulated-Redis driver, still with no socket.
   */
  driver?: QueueDriver;
  /** Queues {@link TestHarness.reserveAll} consumes, in priority order. Default ["default"]. */
  queues?: string[];
  /** Visibility lease (ms) granted by {@link TestHarness.reserveAll}. Default 30_000. */
  visibilityMs?: number;
  /** Default backoff forwarded to the queue and consulted by the harness executor. */
  defaultBackoff?: BackoffPolicy;
  /** Per-queue rate limits forwarded to the queue. */
  rateLimits?: QueueOptions['rateLimits'];
  /** Backing store for rate limits forwarded to the queue. */
  rateLimitStore?: RateLimitStore;
  /** Deterministic RNG in `[0, 1)` used for backoff jitter. Defaults to `Math.random`. */
  rng?: () => number;
}

/**
 * A registered handler entry for the harness's own execution path.
 */
interface HarnessClassHandler {
  readonly ctor: new (...args: never[]) => Job<unknown>;
  readonly handler: JobHandler<unknown>;
}

/**
 * Builds a {@link Queue} with an **injected, advanceable clock** and the
 * Redis-free helpers every property test and most unit tests are built on:
 * `enqueue`, `advance(ms)`, `reserveAll`, `failNext`, and `assertEvents`
 * (Req 16.3, 16.4).
 *
 * The harness is deliberately independent of the background worker loop: it
 * drives the {@link QueueDriver} **directly** so timing is fully deterministic
 * and no socket is ever opened. `enqueue` delegates to the real facade
 * `dispatch` (so envelope build, attempt-ceiling resolution, dedupe drop, and
 * delayed enqueue all exercise production code); `advance` moves the mutable
 * clock and runs delayed promotion (rate windows key off the same clock);
 * `reserveAll` repeatedly reserves ready jobs; `run`/`runReady` execute reserved
 * jobs through the middleware pipeline and consult the retry engine to either
 * re-enqueue (retry) or dead-letter, emitting the typed lifecycle events;
 * `failNext` forces the next execution(s) to fail; and `assertEvents` checks the
 * recorded event stream.
 *
 * Handlers/middleware/event subscriptions registered on the harness populate the
 * harness's own executor (the facade's worker loop is not used), so the harness
 * remains a complete, deterministic substrate on its own.
 */
export class TestHarness {
  /** Every lifecycle event emitted by the harness executor, in emit order. */
  readonly events: EmittedEvent[] = [];

  private now: number;
  private readonly driverImpl: QueueDriver;
  private readonly queueImpl: Queue;
  private readonly queues: string[];
  private readonly visibilityMs: number;
  private readonly defaultBackoff?: BackoffPolicy;
  private readonly rng: () => number;

  private readonly emitter = new QueueEventEmitter();
  private readonly handlers = new Map<string, JobHandler<unknown>>();
  private readonly classHandlers: HarnessClassHandler[] = [];
  private readonly middlewares: QueueMiddleware[] = [];
  /** FIFO of forced failures queued by {@link failNext}; consumed at execution. */
  private readonly forcedFailures: SerializedError[] = [];
  /** Job instances kept by id so executed reservations can resolve class handlers. */
  private readonly jobsById = new Map<string, Job<unknown>>();

  constructor(options: TestHarnessOptions = {}) {
    this.now = options.now ?? (options.clock ? options.clock() : 0);
    this.driverImpl = options.driver ?? new MemoryDriver();
    this.queues = options.queues ?? ['default'];
    this.visibilityMs = options.visibilityMs ?? 30_000;
    this.defaultBackoff = options.defaultBackoff;
    this.rng = options.rng ?? Math.random;

    this.queueImpl = createQueue({
      driver: this.driverImpl,
      clock: () => this.now,
      defaultBackoff: options.defaultBackoff,
      rateLimits: options.rateLimits,
      rateLimitStore: options.rateLimitStore,
    });
  }

  // ── Accessors ────────────────────────────────────────────────────────────────

  /** The queue under test (injected with the harness's advanceable clock). */
  get queue(): Queue {
    return this.queueImpl;
  }

  /** The active driver (a {@link MemoryDriver} by default). */
  get driver(): QueueDriver {
    return this.driverImpl;
  }

  /** The current value of the harness's mutable clock (epoch ms). */
  get clockNow(): number {
    return this.now;
  }

  /** The harness's advanceable clock (`() => now`). */
  get clock(): Clock {
    return () => this.now;
  }

  // ── Registration (feeds the harness executor, not the facade worker) ──────────

  /** Register the handler for a job type used by the harness executor. */
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

  /** Append a middleware to the harness execution pipeline (composed in order). */
  use(middleware: QueueMiddleware): void {
    this.middlewares.push(middleware);
  }

  /** Subscribe to a lifecycle event emitted by the harness executor. */
  on<K extends keyof QueueEventMap>(event: K, handler: (e: QueueEventMap[K]) => void): void {
    this.emitter.on(event, handler);
  }

  // ── Core helpers ───────────────────────────────────────────────────────────────

  /**
   * Enqueue a job through the real facade `dispatch` (Req 16.3). This exercises
   * production envelope build, attempt-ceiling resolution, dedupe drop, and
   * immediate-vs-delayed enqueue, all against the harness's injected clock.
   */
  async enqueue<T>(job: Job<T>, options?: JobOptions): Promise<string> {
    const id = await this.queueImpl.dispatch(job, options);
    this.jobsById.set(id, job as Job<unknown>);
    return id;
  }

  /**
   * Advance the mutable clock by `ms` and run delayed promotion so jobs whose
   * Due_Time has arrived become eligible (Req 16.3). Rate-limit windows key off
   * the same clock, so advancing time is all that is required to open them.
   */
  async advance(ms: number): Promise<void> {
    if (ms < 0) {
      throw new Error(`TestHarness.advance requires a non-negative delta, received ${ms}.`);
    }
    this.now += ms;
    await this.driverImpl.promoteDue(this.now);
  }

  /**
   * Reserve every currently-ready job (in priority order across the configured
   * queues), collecting the reservations. Does not execute them; pair with
   * {@link run} to process, or inspect ordering directly (Property 2).
   */
  async reserveAll(): Promise<Reservation[]> {
    const reservations: Reservation[] = [];
    for (;;) {
      // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
      const reservation = await this.driverImpl.reserve(this.queues, this.visibilityMs, this.now);
      if (!reservation) {
        break;
      }
      reservations.push(reservation);
    }
    return reservations;
  }

  /**
   * Force the next execution to fail with `error` (default a generic forced
   * failure). Multiple calls queue multiple forced failures, consumed FIFO by
   * subsequent {@link run} calls — the substrate for retry/DLQ property tests.
   */
  failNext(error?: unknown): void {
    this.forcedFailures.push(serializeError(error ?? new Error('TestHarness forced failure')));
  }

  /**
   * Execute a single reserved job through the middleware pipeline and handler,
   * then report the outcome to the driver and emit the lifecycle events:
   *  - success → `ack` + `job.completed`;
   *  - failure (thrown, forced via {@link failNext}, or no registered handler) →
   *    consult the retry engine and either `nack(runAt)` + `job.retry` for a
   *    further attempt or `moveToDeadLetter` + terminal `job.failed`.
   *
   * The envelope's `attempts` was already incremented by `reserve`, so
   * `ctx.attempt` is the 1-based current attempt.
   */
  async run(reservation: Reservation): Promise<void> {
    const envelope = reservation.envelope;
    const ctx: MutableContext = {
      id: envelope.id,
      type: envelope.type,
      queue: reservation.queue,
      attempt: envelope.attempts,
      maxAttempts: envelope.maxAttempts,
      enqueuedAt: envelope.enqueuedAt,
      tenantId: envelope.tenantId,
      signal: new AbortController().signal,
    };

    const start = this.now;
    this.record('job.started', { ctx });

    const forced = this.forcedFailures.shift();
    try {
      if (forced) {
        throw new ForcedFailure(forced);
      }
      const handler = this.resolveHandler(envelope.type, envelope.id);
      if (!handler) {
        throw new Error(`No handler registered for job type "${envelope.type}".`);
      }
      await this.runPipeline(ctx, envelope.payload, handler);
      await this.driverImpl.ack(reservation);
      this.record('job.completed', { ctx, durationMs: this.now - start });
    } catch (err) {
      const error = err instanceof ForcedFailure ? err.serialized : serializeError(err);
      await this.handleFailure(reservation, ctx, error);
    }
  }

  /**
   * Reserve and run every currently-ready job. Jobs re-enqueued as retries land
   * as delayed and are NOT picked up until a subsequent {@link advance} exposes
   * them, keeping the loop finite and deterministic. Returns the number run.
   */
  async runReady(): Promise<number> {
    const reservations = await this.reserveAll();
    for (const reservation of reservations) {
      // eslint-disable-next-line no-await-in-loop -- deterministic, no timers
      await this.run(reservation);
    }
    return reservations.length;
  }

  /**
   * Assert the recorded lifecycle-event stream matches `expected`, in order.
   * Each expectation is either an event name or `{ event, where? }`, where the
   * optional `where` predicate additionally checks the payload. Throws a
   * descriptive error on any mismatch (length or per-event).
   */
  assertEvents(
    expected: Array<
      | keyof QueueEventMap
      | { event: keyof QueueEventMap; where?: (payload: QueueEventMap[keyof QueueEventMap]) => boolean }
    >,
  ): void {
    const actual = this.events;
    if (actual.length !== expected.length) {
      throw new Error(
        `assertEvents: expected ${expected.length} event(s) [${expected
          .map((e) => (typeof e === 'string' ? e : e.event))
          .join(', ')}], but recorded ${actual.length} [${actual
          .map((e) => e.event)
          .join(', ')}].`,
      );
    }
    for (let i = 0; i < expected.length; i += 1) {
      const exp = expected[i]!;
      const got = actual[i]!;
      const expEvent = typeof exp === 'string' ? exp : exp.event;
      if (got.event !== expEvent) {
        throw new Error(
          `assertEvents: event #${i} expected "${expEvent}" but recorded "${got.event}".`,
        );
      }
      if (typeof exp !== 'string' && exp.where && !exp.where(got.payload)) {
        throw new Error(`assertEvents: event #${i} ("${expEvent}") payload failed the where predicate.`);
      }
    }
  }

  /** Graceful shutdown of the underlying queue/driver. */
  close(): Promise<void> {
    return this.queueImpl.close();
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private async handleFailure(
    reservation: Reservation,
    ctx: JobExecutionContext,
    error: SerializedError,
  ): Promise<void> {
    const decision: RetryDecision = onFailure(reservation.envelope, error, {}, {
      defaultBackoff: this.defaultBackoff ?? DEFAULT_BACKOFF,
      clock: () => this.now,
      rng: this.rng,
    });

    if (decision.kind === 'retry') {
      await this.driverImpl.nack(reservation, decision.runAt);
      this.record('job.retry', {
        ctx,
        error,
        nextRunAt: decision.runAt,
        nextAttempt: reservation.envelope.attempts + 1,
      });
    } else {
      await this.driverImpl.moveToDeadLetter(reservation, error);
      this.record('job.failed', { ctx, error });
    }
  }

  private resolveHandler(type: string, jobId: string): JobHandler<unknown> | undefined {
    const byType = this.handlers.get(type);
    if (byType) {
      return byType;
    }
    const job = this.jobsById.get(jobId);
    if (!job) {
      return undefined;
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
}

/** Internal marker carrying a pre-serialized forced failure from {@link TestHarness.failNext}. */
class ForcedFailure extends Error {
  constructor(readonly serialized: SerializedError) {
    super(serialized.message);
    this.name = 'ForcedFailure';
  }
}
