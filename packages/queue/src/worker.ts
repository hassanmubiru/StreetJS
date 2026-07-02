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
//  - Task 6.2 layers a per-attempt timeout that fires the `AbortSignal`, and
//    routes a reserved envelope whose `type` has no registered handler straight
//    to the DLQ with a descriptive error (here a no-handler job simply throws
//    and flows through the same failure path).
//  - Task 6.3 integrates per-queue rate limiting (defer-via-nack) before a
//    reserved job is executed.
// Both extend the seams below (`executeReservation`, `runHandler`,
// `handleFailure`) rather than reshaping the loop.

import type { Clock } from 'streetjs';
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
   * the middleware pipeline and handler, then `ack` on success (emitting
   * `job.completed`) or route the failure to the retry engine.
   *
   * Seam for task 6.2: this is where the per-attempt timeout + `AbortSignal`
   * wiring and the no-handler → straight-to-DLQ rule are layered in; task 6.3
   * inserts the rate-limit check before execution.
   */
  protected async executeReservation(reservation: Reservation): Promise<void> {
    const envelope = reservation.envelope;
    const ctx = this.buildContext(reservation);
    const start = this.ctx.clock();
    this.ctx.emitter.emit('job.started', { ctx });

    try {
      const handler = this.ctx.handlers.get(envelope.type);
      if (handler === undefined) {
        throw new Error(`No handler registered for job type "${envelope.type}".`);
      }
      await this.runHandler(ctx, envelope.payload, handler);
      await this.driver.ack(reservation);
      this.processed += 1;
      this.releaseDedupe(reservation);
      this.ctx.emitter.emit('job.completed', { ctx, durationMs: this.ctx.clock() - start });
    } catch (err) {
      await this.handleFailure(reservation, ctx, serializeError(err));
    }
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
  protected buildContext(reservation: Reservation): JobExecutionContext {
    const envelope = reservation.envelope;
    return {
      id: envelope.id,
      type: envelope.type,
      queue: reservation.queue,
      attempt: envelope.attempts,
      maxAttempts: envelope.maxAttempts,
      enqueuedAt: envelope.enqueuedAt,
      tenantId: envelope.tenantId,
      // Timeout wiring (firing this signal on timeout) lands in task 6.2.
      signal: new AbortController().signal,
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
