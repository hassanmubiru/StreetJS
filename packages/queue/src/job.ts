// src/job.ts
// @streetjs/queue — job definitions, options, the serialized envelope model, and
// execution context (Req 1.6, 2.1, 2.5, 6.3, 8.3).
//
// This module declares the strongly-typed developer-facing job surface (the
// `Job<TPayload>` base class and `JobOptions`) alongside the internal data model
// a driver stores and reserves (`JobEnvelope`), the per-execution context handed
// to handlers/middleware (`JobExecutionContext`), and the dead-letter/error
// shapes (`DeadLetterRecord`, `SerializedError`). It also implements
// `buildEnvelope`, which resolves per-dispatch defaults and the attempt ceiling
// into an immutable envelope (task 3.1).

import { randomUUID } from 'node:crypto';
import { parseWindow, type Clock } from 'streetjs';

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

/** Default named queue used when a dispatch omits an explicit `queue` (Req 2.5). */
export const DEFAULT_QUEUE = 'default';
/** Default priority assigned when a dispatch omits an explicit `priority` (Req 8.3). */
export const DEFAULT_PRIORITY = 0;
/** Default attempt ceiling when neither `retries` nor `maxAttempts` is provided (Req 5.6). */
export const DEFAULT_MAX_ATTEMPTS = 1;

/**
 * Resolve the attempt ceiling (total attempts allowed, initial + retries) from
 * the `retries`/`maxAttempts` options.
 *
 * Precedence rules (Req 5.6, 5.8):
 *  - WHEN `retries` is provided, the ceiling is `retries + 1`, and any
 *    `maxAttempts` value is ignored (even when both are present).
 *  - ELSE WHEN `maxAttempts` is provided, the ceiling is `maxAttempts`.
 *  - ELSE the ceiling defaults to 1 (no retry).
 */
export function resolveMaxAttempts(options?: JobOptions): number {
  if (options?.retries !== undefined) {
    return options.retries + 1;
  }
  if (options?.maxAttempts !== undefined) {
    return options.maxAttempts;
  }
  return DEFAULT_MAX_ATTEMPTS;
}

/** Resolve a `number | string` duration to milliseconds, parsing human strings. */
function resolveDurationMs(duration: number | string | undefined): number | undefined {
  if (duration === undefined) {
    return undefined;
  }
  return typeof duration === 'number' ? duration : parseWindow(duration);
}

/**
 * Build the serialized {@link JobEnvelope} for a dispatched job.
 *
 * Merges the job's per-instance `options` with the dispatch-time `options`
 * (dispatch-time values take precedence), resolves the default queue
 * (`"default"`, Req 2.5) and default priority (`0`, Req 8.3), resolves the
 * attempt ceiling per {@link resolveMaxAttempts} (Req 5.6, 5.8), resolves the
 * per-attempt `timeout` to `timeoutMs` (parsing human strings via the reused
 * core `parseWindow`), assigns a unique `id`, stamps `enqueuedAt` from the
 * injected `clock`, and carries `seq`, `backoff`, and `dedupeKey`. `attempts`
 * is initialized to 0 (Req 2.1).
 *
 * The returned envelope does not carry the delayed run time (`runAt`); the
 * facade passes that separately to `driver.enqueueDelayed`.
 *
 * @param job    The job instance being dispatched.
 * @param options Dispatch-time option overrides (merged over `job.options`).
 * @param clock  Injected clock (`() => number`) used for `enqueuedAt`.
 * @param seq    Monotonic enqueue sequence for FIFO tie-breaking within a priority.
 */
export function buildEnvelope<TPayload>(
  job: Job<TPayload>,
  options: JobOptions | undefined,
  clock: Clock,
  seq: number,
): JobEnvelope<TPayload> {
  // Dispatch-time options override per-instance job options.
  const merged: JobOptions = { ...job.options, ...options };

  return {
    id: randomUUID(),
    type: job.type,
    queue: merged.queue ?? DEFAULT_QUEUE,
    payload: job.payload,
    priority: merged.priority ?? DEFAULT_PRIORITY,
    attempts: 0,
    maxAttempts: resolveMaxAttempts(merged),
    backoff: merged.backoff,
    timeoutMs: resolveDurationMs(merged.timeout),
    enqueuedAt: clock(),
    seq,
    dedupeKey: merged.dedupeKey,
    tenantId: undefined,
  };
}
