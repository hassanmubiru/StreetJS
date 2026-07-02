// src/job.ts
// @streetjs/queue — job definitions, options, the serialized envelope model, and
// execution context (Req 1.6, 2.1, 2.5, 6.3, 8.3).
//
// This module declares the strongly-typed developer-facing job surface (the
// `Job<TPayload>` base class and `JobOptions`) alongside the internal data model
// a driver stores and reserves (`JobEnvelope`), the per-execution context handed
// to handlers/middleware (`JobExecutionContext`), and the dead-letter/error
// shapes (`DeadLetterRecord`, `SerializedError`). Implementation of
// `buildEnvelope`/attempt-ceiling resolution lands in task 3.1.

/**
 * A retry/backoff strategy. `"exponential"` mirrors the core JobQueue's
 * `min(initial * mult^attempt, maxDelay)`; `"fixed"` uses a constant delay.
 */
export interface BackoffPolicy {
  strategy: 'fixed' | 'exponential';
  /** Base delay. Accepts ms or a human string ("5s") parsed via core parseWindow. */
  delay: number | string;
  /** Multiplier for 'exponential'. Ignored for 'fixed'. Default 2. */
  multiplier?: number;
  /** Upper bound on any single backoff delay (ms or human string). */
  maxDelay?: number | string;
  /** Optional random jitter fraction [0,1] applied to the computed delay. */
  jitter?: number;
}

/** Per-dispatch options. All optional; sensible defaults applied by the facade. */
export interface JobOptions {
  /** Named queue this job lands on. Default: "default". */
  queue?: string;
  /** Delay before the job becomes eligible. ms or human string ("5m"). */
  delay?: number | string;
  /** Absolute earliest run time (alternative to delay). */
  runAt?: Date;
  /** Higher runs first. Default 0. Ties broken FIFO by enqueue order. */
  priority?: number;
  /** Total attempts allowed (initial + retries). Default 1 (no retry). */
  maxAttempts?: number;
  /**
   * Convenience alias: retries = maxAttempts - 1. If both are set, `retries`
   * takes precedence (attempt ceiling = retries + 1) and `maxAttempts` is ignored.
   */
  retries?: number;
  /** Backoff policy applied between attempts. Default: exponential 1s x2 cap 30s. */
  backoff?: BackoffPolicy;
  /** Per-attempt execution timeout (ms or human string). Emits job.timeout. */
  timeout?: number | string;
  /** Idempotency/dedupe key; a duplicate pending job with the same key is dropped. */
  dedupeKey?: string;
}

/** Base class for a strongly-typed job. Subclasses fix `type` and payload shape. */
export abstract class Job<TPayload = unknown> {
  /** Stable, unique type identifier used to route to a handler. */
  abstract readonly type: string;
  /** The typed payload serialized into the envelope. */
  readonly payload: TPayload;
  /** Per-instance option overrides (merged under dispatch-time options). */
  readonly options?: JobOptions;

  constructor(payload: TPayload, options?: JobOptions) {
    this.payload = payload;
    this.options = options;
  }
}

/** A typed handler for a job type. Receives the payload and an execution context. */
export type JobHandler<TPayload = unknown> = (
  payload: TPayload,
  ctx: JobExecutionContext,
) => Promise<void> | void;

/** Context handed to handlers and middleware for one execution. */
export interface JobExecutionContext {
  readonly id: string;
  readonly type: string;
  readonly queue: string;
  /** 1-based attempt number. */
  readonly attempt: number;
  readonly maxAttempts: number;
  /** Epoch ms at which the job was originally enqueued. */
  readonly enqueuedAt: number;
  /** Set by tenant-isolation middleware; visible for the rest of the execution. */
  readonly tenantId?: string;
  /** Cooperative cancellation signal fired on timeout. */
  readonly signal: AbortSignal;
}

/**
 * The serialized unit a driver stores and reserves. Carries everything needed
 * to route, order, retry, time-out, and dead-letter a job independent of the
 * originating `Job` instance.
 */
export interface JobEnvelope<TPayload = unknown> {
  /** Unique job id assigned at dispatch. */
  readonly id: string;
  /** Job type used to route to a handler. */
  readonly type: string;
  /** Named queue the envelope lives on. */
  readonly queue: string;
  /** Typed payload copied from the job. */
  readonly payload: TPayload;
  /** Higher runs first; default 0. */
  priority: number;
  /** Consumed attempts; initialized to 0 at dispatch and incremented at reserve. */
  attempts: number;
  /** Total attempts allowed (initial + retries). */
  readonly maxAttempts: number;
  /** Resolved backoff policy applied between attempts. */
  readonly backoff?: BackoffPolicy;
  /** Resolved per-attempt timeout in ms, if any. */
  readonly timeoutMs?: number;
  /** Epoch ms at which the envelope was first enqueued. */
  readonly enqueuedAt: number;
  /** Monotonic enqueue sequence used for FIFO tie-breaking within a priority. */
  readonly seq: number;
  /** Idempotency/dedupe key, if provided. */
  readonly dedupeKey?: string;
  /** Tenant id propagated by tenant-isolation middleware. */
  tenantId?: string;
}

/** A structured, serialized representation of a failure. */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * A dead-letter record surfaced through the `DeadLetterApi` and CLI. Carries the
 * job id, type, queue, payload, consumed attempts, serialized error, and timestamps.
 */
export interface DeadLetterRecord<TPayload = unknown> {
  readonly id: string;
  readonly type: string;
  readonly queue: string;
  readonly payload: TPayload;
  /** Attempts consumed before the job was dead-lettered. */
  readonly attempts: number;
  /** Attempt ceiling the re-enqueued job is again eligible for. */
  readonly maxAttempts: number;
  /** Resolved backoff carried over for a subsequent retry. */
  readonly backoff?: BackoffPolicy;
  /** The failure that caused the job to be dead-lettered. */
  readonly error: SerializedError;
  /** Epoch ms at which the job was originally enqueued. */
  readonly enqueuedAt: number;
  /** Epoch ms at which the job was moved to the dead-letter store. */
  readonly failedAt: number;
}
