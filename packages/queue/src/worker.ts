// src/worker.ts
// @streetjs/queue — worker types and the concurrency-bounded reservation loop
// (Req 7.1–7.5, 8.4, 14.1; timeout/no-handler/retry-DLQ refinement in 6.2 and
// per-queue rate limiting in 6.3).
//
// This module declares the public `Worker`/`WorkerOptions`/`WorkerStatus`
// surface and implements `WorkerImpl`: a reservation loop that bounds in-flight
// execution to `concurrency`, reserves from the highest-priority non-empty
// queue in the configured order (the driver enforces the ordering), polls at
// `pollIntervalMs`, and supports an optional `onWake` push to trigger an
// immediate reserve attempt. The loop runs each reserved job to completion:
// success → `ack`; failure → the retry engine decides `nack(runAt)` (retry) or
// `moveToDeadLetter` (exhaustion).
//
// Scope note (what is deliberately left to later tasks):
//  - Task 6.2 (implemented) layers a per-attempt timeout that fires the
//    `AbortSignal` and emits `job.timeout`, and routes a reserved envelope whose
//    `type` has no registered handler straight to the DLQ with a descriptive
//    error (a permanent failure that bypasses the retry engine).
//  - Task 6.3 integrates per-queue rate limiting (defer-via-nack) before a
//    reserved job is executed.
// Both extend the seams below (`executeReservation`, `runHandler`,
// `handleFailure`, `runWithTimeout`) rather than reshaping the loop.

import type { Clock, RateLimitStore } from 'streetjs';
import type {
  BackoffPolicy,
  JobExecutionContext,
  JobHandler,
  SerializedError,
} from './job.js';
import type { QueueMiddleware } from './middleware.js';
import type { QueueEventEmitter } from './events.js';
import { DEFAULT_BACKOFF, onFailure, type RetryDecision } from './retry.js';
import type { QueueDriver, Reservation } from './drivers/driver.js';

export interface WorkerOptions {
  /** Which queues to consume (priority order among queues left-to-right). */
  queues?: string[];
  /** Max jobs processed concurrently by this worker. Default 1. */
  concurrency?: number;
  /** Poll interval when the driver has no push wake-up. Default 1000ms. */
  pollIntervalMs?: number;
  /** Stop after the queue drains (used by tests / one-shot runs). */
  stopWhenEmpty?: boolean;
  /** Visibility lease (ms) granted to each reservation. Default 30_000. */
  visibilityMs?: number;
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
 * A resolved per-queue rate limit: at most `requests` jobs may be *started*
 * within any sliding window of `windowMs` milliseconds (Req 9.1). The facade
 * resolves human window strings (e.g. `"5m"`) to `windowMs` via core
 * `parseWindow` before populating the {@link WorkerContext}.
 */
export interface ResolvedRateLimit {
  /** Max jobs started per window (`R`). */
  readonly requests: number;
  /** Sliding window length in milliseconds (`W`). */
  readonly windowMs: number;
}

/**
 * Everything the worker needs from the facade to execute a reserved job. The
 * facade owns the handler registry, the middleware chain, the event emitter,
 * the retry-engine wiring (clock, default backoff, rng), and the dedupe-key
 * removal hook; it passes them here so the worker's loop can consume the active
 * driver and run jobs to completion. Keeping this a plain data seam lets the
 * facade and worker stay decoupled from each other's internals.
 */
export interface WorkerContext {
  /** The active driver the loop reserves from / acks / nacks against. */
  readonly driver: QueueDriver;
  /** Typed handler registry keyed by job `type` (shared with the facade). */
  readonly handlers: Map<string, JobHandler<unknown>>;
  /** Middleware chain, composed in registration order (shared with the facade). */
  readonly middleware: readonly QueueMiddleware[];
  /** Facade-owned typed emitter for lifecycle events. */
  readonly emitter: QueueEventEmitter;
  /** Injected clock used for timing/backoff (deterministic in tests). */
  readonly clock: Clock;
  /** Default backoff applied when a job/dispatch omits one. */
  readonly defaultBackoff?: BackoffPolicy;
  /** Deterministic RNG in `[0, 1)` for backoff jitter. Defaults to `Math.random`. */
  readonly rng?: () => number;
  /**
   * Resolved per-queue rate limits keyed by queue name (Req 9.1). When a queue
   * has an entry, the worker enforces its `R`-per-`W` quota before starting a
   * reserved job. Absent when no limits are configured.
   */
  readonly rateLimits?: ReadonlyMap<string, ResolvedRateLimit>;
  /**
   * Backing store for the sliding-window rate limiter (Req 9.4). Reuses the core
   * `RateLimitStore` abstraction with an injectable `Clock` for deterministic
   * timing. Present iff {@link rateLimits} is present.
   */
  readonly rateLimitStore?: RateLimitStore;
  /**
   * Release a dedupe key once its job is no longer pending/ready (acked or
   * dead-lettered), so a fresh dispatch with the same key is admitted (Req 14.5).
   */
  readonly releaseDedupeKey: (queue: string, dedupeKey: string, jobId?: string) => void;
  /**
   * Resolves once the driver is initialized. The worker awaits this before its
   * first reservation; if it rejects (configured driver failed to init), the
   * worker stops without reserving.
   */
  readonly ready?: Promise<void>;
}

/** Default visibility lease granted to each reservation when none is configured. */
const DEFAULT_VISIBILITY_MS = 30_000;

/** Serialize an unknown thrown value into the structured error shape. */
function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'Error', message: String(err) };
}

/**
 * The concurrency-bounded reservation loop (Req 7.1–7.5, 8.4, 14.1).
 *
 * Invariants:
 *  - never more than `concurrency` jobs execute simultaneously; reservation is
 *    deferred while `inFlight === concurrency` (Req 7.1, 7.2);
 *  - reservation comes from the highest-priority non-empty queue in the
 *    configured order, delegated to the driver (Req 8.4);
 *  - `start` is idempotent (Req 7.4); `stop` drains in-flight work gracefully.
 */
export class WorkerImpl implements Worker {
  protected running = false;
  protected readonly queues: string[];
  protected readonly concurrency: number;
  protected readonly pollIntervalMs: number;
  protected readonly stopWhenEmpty: boolean;
  protected readonly visibilityMs: number;
  protected inFlight = 0;
  protected processed = 0;
  protected failed = 0;

  protected readonly driver: QueueDriver;
  protected readonly ctx: WorkerContext;

  /**
   * Resolved per-queue rate limits and the backing sliding-window store
   * (Req 9.1–9.4). Both are undefined when no limits are configured, in which
   * case {@link admitUnderRateLimit} is a no-op.
   */
  protected readonly rateLimits?: ReadonlyMap<string, ResolvedRateLimit>;
  protected readonly rateLimitStore?: RateLimitStore;
  /**
   * Serializes the rate limiter's read-modify (count → hit) so two concurrent
   * executions cannot both observe `count < R` and both record a start, which
   * would let more than `R` jobs start in a window. Rate checks chain off this
   * promise; only the count+hit critical section is serialized (the subsequent
   * nack/execute run outside it).
   */
  private rateCheckChain: Promise<unknown> = Promise.resolve();

  /** Promises for currently-executing jobs; awaited on {@link stop} to drain. */
  private readonly inFlightPromises = new Set<Promise<void>>();
  /** Poll timer handle; cleared on {@link stop}. */
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  /** Guards against overlapping pump passes (reserve is async). */
  private pumping = false;
  /** True once the driver-ready gate has been observed (successfully). */
  private readyChecked = false;
  /** Registered once so repeated {@link start} calls do not re-subscribe. */
  private wakeRegistered = false;

  constructor(context: WorkerContext, options: WorkerOptions = {}) {
    this.ctx = context;
    this.driver = context.driver;
    this.queues = options.queues ?? ['default'];
    this.concurrency = options.concurrency ?? 1;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.stopWhenEmpty = options.stopWhenEmpty ?? false;
    this.visibilityMs = options.visibilityMs ?? DEFAULT_VISIBILITY_MS;
    this.rateLimits = context.rateLimits;
    this.rateLimitStore = context.rateLimitStore;
  }

  /** Begin the reservation loop. Idempotent (Req 7.4). */
  start(): void {
    if (this.running) {
      return;
    }
    this.running = true;

    // Optional push wake-up: an immediate reserve attempt when the driver signals
    // new work may be ready. Registered once for the worker's lifetime.
    if (!this.wakeRegistered && typeof this.driver.onWake === 'function') {
      this.driver.onWake(() => this.scheduleTick());
      this.wakeRegistered = true;
    }

    // Poll at the configured interval as a fallback when there is no push.
    this.pollTimer = setInterval(() => this.scheduleTick(), this.pollIntervalMs);
    // Do not keep the event loop alive solely for polling.
    this.pollTimer.unref?.();

    this.scheduleTick();
  }

  /** Stop reserving new jobs and await in-flight completion (graceful drain). */
  async stop(): Promise<void> {
    this.running = false;
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
    // Await the in-flight jobs so callers observe a fully drained worker.
    await Promise.all([...this.inFlightPromises]);
  }

  /** Live status surfaced to the health check / metrics. */
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

  /** Schedule a pump pass on the microtask queue (coalesces bursts of triggers). */
  private scheduleTick(): void {
    if (!this.running) {
      return;
    }
    queueMicrotask(() => {
      void this.pump();
    });
  }

  /**
   * Reserve and dispatch jobs up to the concurrency bound. Never reserves while
   * `inFlight === concurrency` (Req 7.1, 7.2). A single pass runs at a time;
   * completing jobs re-trigger a pass to fill freed slots.
   */
  private async pump(): Promise<void> {
    if (this.pumping || !this.running) {
      return;
    }
    this.pumping = true;
    try {
      // Gate on driver readiness once. A rejected readiness (configured driver
      // failed to init) stops the worker without reserving.
      if (!this.readyChecked) {
        if (this.ctx.ready !== undefined) {
          try {
            await this.ctx.ready;
          } catch {
            this.running = false;
            return;
          }
        }
        this.readyChecked = true;
        if (!this.running) {
          return;
        }
      }

      while (this.running && this.inFlight < this.concurrency) {
        const reservation = await this.driver.reserve(this.queues, this.visibilityMs, this.ctx.clock());
        if (reservation === null) {
          // Nothing ready. Optionally stop when drained and idle.
          if (this.stopWhenEmpty && this.inFlight === 0) {
            void this.stop();
          }
          break;
        }

        this.inFlight += 1;
        const promise = this.executeReservation(reservation).finally(() => {
          this.inFlight -= 1;
          this.inFlightPromises.delete(promise);
          // A slot just freed — try to fill it.
          this.scheduleTick();
        });
        this.inFlightPromises.add(promise);
      }
    } finally {
      this.pumping = false;
    }
  }

  /**
   * Run a single reserved job to completion: emit `job.started`, execute through
   * the middleware pipeline and handler under a per-attempt timeout, then `ack`
   * on success (emitting `job.completed`) or route the failure appropriately.
   *
   * Two failure paths (task 6.2):
   *  - **No registered handler** for the envelope's `type` is a PERMANENT
   *    failure (Req 2.4): the job is moved straight to the DLQ with a
   *    descriptive error and does NOT consult the retry engine.
   *  - **Any other failure** (a thrown handler error or a per-attempt timeout,
   *    Req 14.4) routes through the retry engine, which either re-enqueues for
   *    a further attempt or dead-letters at exhaustion (Req 6.1, 6.2, 14.2).
   *
   * The per-attempt timeout (Req 14.4) fires the execution `AbortSignal` so a
   * cooperative handler can observe cancellation, emits `job.timeout`
   * (Req 11.5), and surfaces the timeout as a failure.
   *
   * Task 6.3 inserts the rate-limit check before execution.
   */
  protected async executeReservation(reservation: Reservation): Promise<void> {
    // Per-queue rate limiting (Req 9.1–9.4): if starting this job would exceed
    // the configured `R`-per-`W` quota, defer it via nack (never started, never
    // dropped) and return without emitting `job.started` or counting it as
    // processed/failed. The deferred job is promoted and retried automatically
    // once the window admits it.
    if (!(await this.admitUnderRateLimit(reservation))) {
      return;
    }

    const envelope = reservation.envelope;
    const controller = new AbortController();
    const ctx = this.buildContext(reservation, controller.signal);
    const start = this.ctx.clock();
    this.ctx.emitter.emit('job.started', { ctx });

    // No registered handler → PERMANENT failure moved straight to the DLQ,
    // bypassing the retry engine entirely (Req 2.4).
    const handler = this.ctx.handlers.get(envelope.type);
    if (handler === undefined) {
      await this.deadLetterPermanent(reservation, ctx, {
        name: 'Error',
        message: `No handler registered for job type "${envelope.type}".`,
      });
      return;
    }

    try {
      await this.runWithTimeout(ctx, envelope.payload, handler, controller, envelope.timeoutMs);
      await this.driver.ack(reservation);
      this.processed += 1;
      this.releaseDedupe(reservation);
      this.ctx.emitter.emit('job.completed', { ctx, durationMs: this.ctx.clock() - start });
    } catch (err) {
      await this.handleFailure(reservation, ctx, serializeError(err));
    }
  }

  /**
   * Enforce the per-queue rate limit before a reserved job is started
   * (Req 9.1–9.4). Returns `true` when the job may start (and records the start
   * in the sliding window), or `false` when the job was deferred.
   *
   * Semantics for a queue configured with `R` requests per window `W`:
   *  - Read the current window count via the core `RateLimitStore` WITHOUT
   *    recording. If starting the job would exceed the quota (`count >= R`), the
   *    window is full → **defer, never drop** (Req 9.2): nack the reservation to
   *    a later Due_Time (`now + W`, a safe retry-after that lets the window
   *    admit it) so the scheduler promotes it and the loop retries it
   *    automatically once the window opens (Req 9.3).
   *  - Otherwise record the start (`hit`) and admit the job (Req 9.1).
   *
   * Attempt budget: `reserve()` already incremented `envelope.attempts`. A rate
   * deferral must be transparent to the retry budget — it must NOT consume an
   * attempt toward `maxAttempts` (a rate-limited job is not a failed job). So we
   * decrement the attempt consumed at reserve before the nack; when the deferred
   * job is re-reserved it consumes the attempt afresh, leaving the ceiling
   * intact (keeps Property 5 / Req 14.2 honest). This deferral never consults
   * the retry engine and never increments `failed`.
   *
   * The read-modify (count → hit) is serialized on {@link rateCheckChain} so two
   * concurrent executions cannot both observe `count < R` and both start,
   * upholding "at most `R` started per window" even at `concurrency > 1`.
   */
  protected async admitUnderRateLimit(reservation: Reservation): Promise<boolean> {
    const limit = this.rateLimits?.get(reservation.queue);
    const store = this.rateLimitStore;
    if (limit === undefined || store === undefined) {
      return true; // no limit configured for this queue
    }

    // Serialize the count→hit critical section against other concurrent checks.
    const decision = this.rateCheckChain.then(async () => {
      const now = this.ctx.clock();
      const inWindow = await store.count(reservation.queue, now, limit.windowMs);
      if (inWindow >= limit.requests) {
        return { admitted: false as const, now };
      }
      // Under the quota — record the start atomically within the gate (Req 9.1).
      await store.hit(reservation.queue, now, limit.windowMs);
      return { admitted: true as const, now };
    });
    // Keep the chain alive regardless of outcome; swallow to avoid breaking it.
    this.rateCheckChain = decision.then(
      () => undefined,
      () => undefined,
    );

    const { admitted, now } = await decision;
    if (admitted) {
      return true;
    }

    // Window is full: return the attempt consumed at reserve so the deferral is
    // transparent to the retry budget, then defer (never drop) to a later
    // Due_Time that guarantees the window can admit it (Req 9.2, 9.3, 14.2).
    reservation.envelope.attempts -= 1;
    await this.driver.nack(reservation, now + limit.windowMs);
    return false;
  }


   * (Req 14.4). When `timeoutMs` is undefined the handler runs unbounded. When a
   * timeout is set, the handler races a real `setTimeout` timer (timeouts are an
   * inherently wall-clock concern; the injected clock stays reserved for
   * deterministic backoff/scheduling). If the timer wins the race it:
   *   1. fires the execution `AbortSignal` via `controller.abort()`,
   *   2. emits `job.timeout` with `{ ctx, timeoutMs }` (Req 11.5), and
   *   3. rejects so the caller treats the timeout as a failure (Req 14.4).
   * The timer is always cleared once the race settles, so no timer is leaked
   * when the handler finishes first.
   */
  protected async runWithTimeout(
    ctx: JobExecutionContext,
    payload: unknown,
    handler: JobHandler<unknown>,
    controller: AbortController,
    timeoutMs: number | undefined,
  ): Promise<void> {
    if (timeoutMs === undefined) {
      await this.runHandler(ctx, payload, handler);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        // Fire the cooperative cancellation signal (Req 14.4).
        controller.abort();
        // Emit the timeout event before surfacing the failure (Req 11.5).
        this.ctx.emitter.emit('job.timeout', { ctx, timeoutMs });
        reject(new Error(`Job "${ctx.type}" exceeded its per-attempt timeout of ${timeoutMs}ms.`));
      }, timeoutMs);
      // Do not keep the event loop alive solely for a pending timeout.
      timer.unref?.();
    });

    try {
      await Promise.race([this.runHandler(ctx, payload, handler), timeout]);
    } finally {
      // Clear the timer whether the handler or the timeout settled first, so a
      // handler that finishes before the deadline leaks no timer.
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Move a reserved job straight to the dead-letter store as a PERMANENT failure
   * (e.g. no registered handler, Req 2.4). Unlike {@link handleFailure} this does
   * NOT consult the retry engine: it dead-letters once, counts the failure,
   * releases the dedupe key, and emits the terminal `job.failed` event.
   */
  protected async deadLetterPermanent(
    reservation: Reservation,
    ctx: JobExecutionContext,
    error: SerializedError,
  ): Promise<void> {
    await this.driver.moveToDeadLetter(reservation, error);
    this.failed += 1;
    this.releaseDedupe(reservation);
    this.ctx.emitter.emit('job.failed', { ctx, error });
  }

  /**
   * On failure, consult the retry engine: `nack(runAt)` for a further attempt
   * (emitting `job.retry`) or `moveToDeadLetter` at exhaustion (emitting the
   * terminal `job.failed` and releasing the dedupe key).
   */
  protected async handleFailure(
    reservation: Reservation,
    ctx: JobExecutionContext,
    error: SerializedError,
  ): Promise<void> {
    const decision: RetryDecision = onFailure(reservation.envelope, error, {}, {
      defaultBackoff: this.ctx.defaultBackoff ?? DEFAULT_BACKOFF,
      clock: this.ctx.clock,
      rng: this.ctx.rng,
    });

    if (decision.kind === 'retry') {
      await this.driver.nack(reservation, decision.runAt);
      this.ctx.emitter.emit('job.retry', {
        ctx,
        error,
        nextRunAt: decision.runAt,
        nextAttempt: reservation.envelope.attempts + 1,
      });
    } else {
      await this.driver.moveToDeadLetter(reservation, error);
      this.failed += 1;
      this.releaseDedupe(reservation);
      this.ctx.emitter.emit('job.failed', { ctx, error });
    }
  }

  /** Build the per-execution context. `attempts` was incremented at reserve. */
  protected buildContext(reservation: Reservation, signal: AbortSignal): JobExecutionContext {
    const envelope = reservation.envelope;
    return {
      id: envelope.id,
      type: envelope.type,
      queue: reservation.queue,
      attempt: envelope.attempts,
      maxAttempts: envelope.maxAttempts,
      enqueuedAt: envelope.enqueuedAt,
      tenantId: envelope.tenantId,
      // The execution AbortSignal fired on a per-attempt timeout (Req 14.4).
      signal,
    };
  }

  /**
   * Compose middleware in registration order with the handler as the terminal
   * step. Each middleware receives the context, the payload, and a `next`
   * continuation; a middleware that calls `next` more than once is rejected.
   */
  protected async runHandler(
    ctx: JobExecutionContext,
    payload: unknown,
    handler: JobHandler<unknown>,
  ): Promise<void> {
    const chain = this.ctx.middleware;
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

  /** Release the reservation's dedupe key once it is no longer pending/ready. */
  private releaseDedupe(reservation: Reservation): void {
    const dedupeKey = reservation.envelope.dedupeKey;
    if (dedupeKey !== undefined) {
      this.ctx.releaseDedupeKey(reservation.queue, dedupeKey, reservation.envelope.id);
    }
  }
}
