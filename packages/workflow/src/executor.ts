/**
 * @streetjs/workflow — the Activity Executor.
 *
 * The Activity Executor runs a **single `ctx.activity` command** to a terminal
 * result or a terminal failure, looping attempts according to the activity's
 * {@link RetryPolicy} (design "Activity execution"). It owns the per-attempt
 * concerns that make an activity reliable and observable:
 *
 * 1. **AbortSignal wiring** — every attempt runs under an {@link AbortSignal}
 *    that is aborted when the Workflow_Run is cancelled, so a cancelled run stops
 *    its in-flight activity (Requirement 4.4). The run-cancellation signal is
 *    supplied per run (an explicit `signal`, a `signalFor(runId)` factory such as
 *    {@link SignalTimerCoordinator.createAbortSignal}, or a non-aborting default),
 *    keeping the executor compilable and testable in isolation.
 * 2. **Middleware** — when {@link ActivityOptions.middleware} is declared, each
 *    attempt is wrapped by the declared {@link ActivityMiddleware} chain, applied
 *    fresh **on every attempt** so middleware observes each retry (Requirement
 *    4.5).
 * 3. **Timeout race** — when {@link ActivityOptions.timeout} is declared, the
 *    attempt is raced against a timer; if the timer wins, the attempt's
 *    {@link AbortSignal} is aborted and the timeout **counts as an attempt
 *    failure** (Requirement 5.1). With no timeout the attempt runs until it
 *    settles (Requirement 5.3). All timestamps are read from the injected
 *    {@link Clock} so the behavior is deterministic under a `FakeClock`.
 * 4. **Direct or queue execution** — the attempt runs directly or, when
 *    {@link ActivityOptions.viaQueue} is set and a queue {@link ActivityRunner}
 *    is wired, through `@streetjs/queue`; the recorded result is observationally
 *    equivalent either way (Requirements 16.2, 16.5). The `runActivity` shape of
 *    the {@link WorkflowQueueBridge} satisfies {@link ActivityRunner}
 *    structurally.
 * 5. **Retry / backoff** — on a failed attempt with attempts remaining under the
 *    {@link RetryPolicy}, the executor computes the delay with
 *    {@link computeBackoff} on the Clock, records a `retry.scheduled` History
 *    event, waits the delay, and schedules another attempt (Requirement 6.2).
 *    When the consumed attempt count equals `maxAttempts` the activity is
 *    **terminally failed** (Requirement 6.7) and the outcome is returned as
 *    `failed` for the Runtime to hand to the Compensator. With no
 *    {@link RetryPolicy} the activity is invoked **at most once** (Requirement
 *    6.8).
 *
 * The executor's {@link ActivityExecutor.run} produces the {@link CommandOutcome}
 * the Journal records for the activity command (its `attempts` count, recorded
 * result or error, and the ordered `activity.started` / `activity.completed` /
 * `activity.failed` / `retry.scheduled` History events). {@link
 * ActivityExecutor.commandSpec} adapts a request into a {@link JournalCommandSpec}
 * for direct wiring into the Journal, and {@link ActivityExecutor.execute} is an
 * ergonomic wrapper that resolves the result or throws on terminal failure.
 *
 * This module imports only the shared models from `./types.js`,
 * {@link computeBackoff} from `./backoff.js`, the {@link CommandOutcome} /
 * {@link JournalCommandSpec} shapes and {@link serializeError} from `./journal.js`,
 * and the `Clock` / `systemClock` primitives from `streetjs`. It does not import
 * the Runtime, the Compensator, or any concrete queue bridge, so it compiles and
 * tests independently, keeping the dependency direction acyclic.
 *
 * _Requirements: 4.1, 4.2, 4.4, 4.5, 5.1, 5.2, 5.3, 6.2, 6.7, 6.8, 16.2, 16.5_
 */

import type { Clock } from "streetjs";
import { systemClock } from "streetjs";

import { computeBackoff } from "./backoff.js";
import type { CommandOutcome, JournalCommandSpec, JournalExecuteInfo } from "./journal.js";
import { serializeError } from "./journal.js";
import type {
  Activity,
  ActivityMiddleware,
  ActivityOptions,
  HistoryEvent,
  SerializedError,
} from "./types.js";

// ── Injected collaborators ───────────────────────────────────────────────────────

/**
 * The queue-execution collaborator. Its `runActivity` runs a single activity
 * attempt either through `@streetjs/queue` (when the activity opts into queue
 * execution and the wired bridge supports it) or directly, always yielding an
 * observationally equivalent result (Requirements 16.2, 16.5). The
 * `WorkflowQueueBridge` produced by `bridgeWorkflowQueue` satisfies this shape
 * structurally, so the executor never imports the concrete bridge.
 */
export interface ActivityRunner {
  runActivity<Out>(
    activity: Activity<Out>,
    options?: { readonly viaQueue?: boolean; readonly signal?: AbortSignal },
  ): Promise<Out>;
}

/**
 * A cancellable delay primitive. Resolves after `ms` milliseconds, or early
 * (without throwing) when `signal` aborts, so a pending backoff/timeout timer is
 * released the moment the attempt settles or the run is cancelled. Injectable so
 * tests can drive delays deterministically; defaults to a `setTimeout`-based
 * implementation.
 */
export type DelayFn = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Construction inputs for an {@link ActivityExecutor}. */
export interface ActivityExecutorOptions {
  /**
   * The queue-execution collaborator (typically a `WorkflowQueueBridge`). When
   * omitted, activities run directly in-process; a `viaQueue` request still runs
   * directly, producing an equivalent result (Requirements 16.4, 16.5).
   */
  readonly runner?: ActivityRunner;
  /** Injected Clock for every timestamp and delay measurement; defaults to {@link systemClock}. */
  readonly clock?: Clock;
  /** Cancellable delay primitive for timeout and backoff scheduling; defaults to `setTimeout`. */
  readonly delay?: DelayFn;
  /** Random source in `[0, 1)` consulted by the `jitter` backoff strategy; defaults to `Math.random`. */
  readonly rng?: () => number;
  /**
   * Factory yielding the run-cancellation {@link AbortSignal} for a run id
   * (typically {@link SignalTimerCoordinator.createAbortSignal}). Used when a
   * request supplies no explicit `signal`; when both are absent a non-aborting
   * signal is used.
   */
  readonly signalFor?: (runId: string) => AbortSignal;
}

// ── Request / result shapes ──────────────────────────────────────────────────────

/** A single activity to execute to a terminal result or terminal failure. */
export interface ActivityExecutionRequest<Out> {
  /** The journaled sequence number of the activity command (keys its History events). */
  readonly seq: number;
  /** The user-supplied effectful work (Requirement 4.1). */
  readonly activity: Activity<Out>;
  /** Timeout, retry, metadata, middleware, and `viaQueue` options (Requirement 4.2). */
  readonly options?: ActivityOptions<Out>;
  /** The run this activity belongs to; used to resolve the cancellation signal. */
  readonly runId?: string;
  /**
   * An explicit run-cancellation signal (Requirement 4.4). Overrides the
   * `signalFor` factory when supplied.
   */
  readonly signal?: AbortSignal;
}

// ── Timeout error ────────────────────────────────────────────────────────────────

/**
 * Thrown internally when an activity attempt exceeds its declared `timeout`
 * (Requirement 5.1). It aborts the attempt's {@link AbortSignal} and is recorded
 * as the attempt's failure, so a remaining retry schedules another attempt
 * (Requirement 5.2).
 */
export class ActivityTimeoutError extends Error {
  /** The declared timeout in milliseconds that was exceeded. */
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Activity attempt exceeded its ${timeoutMs}ms timeout and was aborted.`);
    this.name = "ActivityTimeoutError";
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, ActivityTimeoutError.prototype);
  }
}

// ── Internals ────────────────────────────────────────────────────────────────────

/** A signal that never aborts, used when a run supplies no cancellation signal. */
const NEVER_ABORTS: AbortSignal = new AbortController().signal;

/** `setTimeout`-based cancellable delay: resolves after `ms`, or early on abort. */
const defaultDelay: DelayFn = (ms, signal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted === true) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      if (signal !== undefined) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

// ── The executor ─────────────────────────────────────────────────────────────────

/**
 * Runs one `ctx.activity` command to a terminal result or terminal failure,
 * applying the AbortSignal, middleware, timeout, direct/queue execution, and
 * retry/backoff concerns described in the module doc. A single executor is shared
 * by the engine across all runs; each {@link run} call is independent.
 */
export class ActivityExecutor {
  private readonly runner: ActivityRunner | undefined;
  private readonly clock: Clock;
  private readonly delay: DelayFn;
  private readonly rng: () => number;
  private readonly signalFor: ((runId: string) => AbortSignal) | undefined;

  constructor(options: ActivityExecutorOptions = {}) {
    this.runner = options.runner;
    this.clock = options.clock ?? systemClock;
    this.delay = options.delay ?? defaultDelay;
    this.rng = options.rng ?? Math.random;
    this.signalFor = options.signalFor;
  }

  /**
   * Execute an activity to its terminal {@link CommandOutcome}.
   *
   * Loops attempts per the {@link RetryPolicy} (`maxAttempts`, defaulting to a
   * single attempt when no policy is configured — Requirement 6.8). Each attempt
   * runs under a cancellation-and-timeout {@link AbortSignal}, wrapped by any
   * declared middleware, raced against the declared timeout, and routed directly
   * or through the queue. On a failed attempt with attempts remaining, the
   * backoff delay is computed on the Clock, a `retry.scheduled` event is
   * recorded, the delay elapses, and another attempt is scheduled (Requirement
   * 6.2). A `completed` outcome carries the recorded result; a terminal `failed`
   * outcome carries the last error for the Compensator (Requirement 6.7). Both
   * carry the consumed attempt count and the ordered History events.
   */
  async run<Out>(request: ActivityExecutionRequest<Out>): Promise<CommandOutcome> {
    const { seq, activity, options } = request;
    const retry = options?.retry;
    const maxAttempts = retry?.maxAttempts !== undefined ? Math.max(1, retry.maxAttempts) : 1;
    const metadata = options?.metadata;
    const timeout = options?.timeout;
    const viaQueue = options?.viaQueue ?? false;
    const middleware = options?.middleware ?? [];

    const runSignal = this.resolveRunSignal(request);
    const history: HistoryEvent[] = [];
    let attempt = 0;
    let lastError: SerializedError | undefined;

    while (attempt < maxAttempts) {
      attempt += 1;

      const startedAt = this.clock();
      history.push(
        metadata !== undefined
          ? { type: "activity.started", at: startedAt, seq, attempt, metadata }
          : { type: "activity.started", at: startedAt, seq, attempt },
      );

      try {
        const value = await this.runAttempt(activity, {
          attempt,
          metadata,
          middleware,
          runSignal,
          timeout,
          viaQueue,
        });
        const completedAt = this.clock();
        history.push({ type: "activity.completed", at: completedAt, seq, result: value });
        return { status: "completed", result: value, attempts: attempt, history };
      } catch (error) {
        const failedAt = this.clock();
        lastError = serializeError(error);
        history.push({ type: "activity.failed", at: failedAt, seq, attempt, error: lastError });

        // Schedule another attempt only while attempts remain under the policy
        // (Requirement 6.2); when consumed attempts reach maxAttempts the
        // activity is terminally failed (Requirement 6.7). With no policy,
        // maxAttempts === 1 so the activity ran at most once (Requirement 6.8).
        if (retry !== undefined && attempt < maxAttempts) {
          const delayMs = computeBackoff(retry.backoff, attempt, this.rng);
          const nextAttemptAt = failedAt + delayMs;
          history.push({ type: "retry.scheduled", at: failedAt, seq, attempt, delayMs, nextAttemptAt });
          await this.delay(delayMs, runSignal);
          if (runSignal.aborted) {
            break; // the run was cancelled during backoff: fail terminally.
          }
          continue;
        }
        break;
      }
    }

    return {
      status: "failed",
      error: lastError ?? serializeError(new Error("Activity failed with no recorded error.")),
      attempts: attempt,
      history,
    };
  }

  /**
   * Adapt a request into a {@link JournalCommandSpec} whose `execute` runs the
   * activity through {@link run}, for direct wiring into the Journal by the `ctx`
   * surface / Runtime. The command `kind` is `"activity"` and the declared
   * metadata is carried onto the recorded command (Requirement 4.2).
   */
  commandSpec<Out>(request: ActivityExecutionRequest<Out>): JournalCommandSpec {
    const spec: JournalCommandSpec = {
      kind: "activity",
      ...(request.options?.metadata !== undefined ? { metadata: request.options.metadata } : {}),
      execute: (info: JournalExecuteInfo): Promise<CommandOutcome> =>
        this.run({ ...request, seq: info.seq }),
    };
    return spec;
  }

  /**
   * Ergonomic wrapper: resolve the recorded result on success, or throw the
   * terminally-failed error (Requirement 6.7). Prefer {@link run} when the rich
   * {@link CommandOutcome} (attempts + History) is needed.
   */
  async execute<Out>(request: ActivityExecutionRequest<Out>): Promise<Out> {
    const outcome = await this.run(request);
    if (outcome.status === "completed") {
      return outcome.result as Out;
    }
    if (outcome.status === "failed") {
      const error = new Error(outcome.error.message);
      error.name = outcome.error.name;
      if (outcome.error.stack !== undefined) {
        error.stack = outcome.error.stack;
      }
      throw error;
    }
    // The executor never returns a `waiting` outcome (activities settle to a
    // terminal result or terminal failure), but narrow exhaustively for safety.
    throw new Error("Activity executor produced an unexpected waiting outcome.");
  }

  // ── Attempt execution ──────────────────────────────────────────────────────────

  /**
   * Run a single attempt: build the attempt's cancellation-and-timeout signal,
   * wrap the invocation with the declared middleware chain, and race it against
   * the declared timeout. Resolves with the activity result or rejects with the
   * attempt's failure (an activity error or an {@link ActivityTimeoutError}).
   */
  private async runAttempt<Out>(
    activity: Activity<Out>,
    ctx: {
      readonly attempt: number;
      readonly metadata: Record<string, unknown> | undefined;
      readonly middleware: readonly ActivityMiddleware[];
      readonly runSignal: AbortSignal;
      readonly timeout: number | undefined;
      readonly viaQueue: boolean;
    },
  ): Promise<Out> {
    // Per-attempt controller: aborts when the run is cancelled OR the timeout
    // fires, so the activity's AbortSignal reflects both (Requirements 4.4, 5.1).
    const attemptController = new AbortController();
    const releaseLink = this.linkAbort(ctx.runSignal, attemptController);

    // The base invocation always runs under the attempt's own signal so the
    // timeout/cancellation abort is honored regardless of middleware behavior.
    const baseInvoke = (): Promise<unknown> =>
      this.invoke(activity, ctx.viaQueue, attemptController.signal);

    const invoke = this.wrapMiddleware(baseInvoke, ctx.middleware, ctx.attempt, ctx.metadata);

    try {
      if (ctx.timeout === undefined) {
        return (await invoke()) as Out; // no timeout: run until it settles (Req 5.3).
      }
      return await this.raceTimeout<Out>(invoke, attemptController, ctx.timeout);
    } finally {
      releaseLink();
    }
  }

  /** Invoke the activity directly or through the queue runner (Requirements 16.2, 16.5). */
  private invoke<Out>(activity: Activity<Out>, viaQueue: boolean, signal: AbortSignal): Promise<Out> {
    if (this.runner !== undefined) {
      return this.runner.runActivity<Out>(activity, { viaQueue, signal });
    }
    return Promise.resolve(activity(signal));
  }

  /**
   * Wrap `base` with the declared middleware chain (outermost first), rebuilt on
   * every attempt so each retry is observed (Requirement 4.5). Each middleware
   * receives the inner layer as `next` and the current attempt/metadata as
   * `info`; the base invocation runs under the attempt signal irrespective of the
   * signal a middleware forwards, guaranteeing correct abort wiring.
   */
  private wrapMiddleware(
    base: () => Promise<unknown>,
    middleware: readonly ActivityMiddleware[],
    attempt: number,
    metadata: Record<string, unknown> | undefined,
  ): () => Promise<unknown> {
    if (middleware.length === 0) {
      return base;
    }
    const info = metadata !== undefined ? { attempt, metadata } : { attempt };
    let composed: () => Promise<unknown> = base;
    for (let i = middleware.length - 1; i >= 0; i -= 1) {
      const layer = middleware[i] as ActivityMiddleware;
      const inner = composed;
      composed = (): Promise<unknown> => Promise.resolve(layer((_signal) => inner(), info));
    }
    return composed;
  }

  /**
   * Race the invocation against a timer of `timeoutMs`. If the timer wins, the
   * attempt's {@link AbortSignal} is aborted and an {@link ActivityTimeoutError}
   * is thrown (counting as an attempt failure — Requirement 5.1). The timer is
   * always released once the race settles so no pending timeout leaks.
   */
  private async raceTimeout<Out>(
    invoke: () => Promise<unknown>,
    attemptController: AbortController,
    timeoutMs: number,
  ): Promise<Out> {
    const activityPromise = invoke() as Promise<Out>;
    // Prevent an unhandled rejection if the timeout wins the race while the
    // activity later rejects on its own.
    void activityPromise.catch(() => undefined);

    const timerController = new AbortController();
    const timeoutPromise = new Promise<Out>((_resolve, reject) => {
      void this.delay(timeoutMs, timerController.signal).then(() => {
        if (timerController.signal.aborted) {
          return; // the activity settled first; this timer was cancelled.
        }
        const error = new ActivityTimeoutError(timeoutMs);
        attemptController.abort(error);
        reject(error);
      });
    });

    try {
      return await Promise.race([activityPromise, timeoutPromise]);
    } finally {
      timerController.abort(); // release the timer whichever side won.
    }
  }

  // ── Signal wiring ──────────────────────────────────────────────────────────────

  /** Resolve the run-cancellation signal: explicit → factory → non-aborting default (Req 4.4). */
  private resolveRunSignal(request: {
    readonly signal?: AbortSignal;
    readonly runId?: string;
  }): AbortSignal {
    if (request.signal !== undefined) {
      return request.signal;
    }
    if (this.signalFor !== undefined && request.runId !== undefined) {
      return this.signalFor(request.runId);
    }
    return NEVER_ABORTS;
  }

  /**
   * Abort `attemptController` whenever `runSignal` aborts (run cancellation),
   * propagating the abort reason. Returns a disposer that detaches the listener
   * once the attempt settles.
   */
  private linkAbort(runSignal: AbortSignal, attemptController: AbortController): () => void {
    if (runSignal.aborted) {
      attemptController.abort(runSignal.reason);
      return () => undefined;
    }
    const onAbort = (): void => attemptController.abort(runSignal.reason);
    runSignal.addEventListener("abort", onAbort, { once: true });
    return () => runSignal.removeEventListener("abort", onAbort);
  }
}

/**
 * Convenience factory mirroring {@link ActivityExecutor}'s constructor for callers
 * that prefer a functional construction style.
 */
export function createActivityExecutor(options: ActivityExecutorOptions = {}): ActivityExecutor {
  return new ActivityExecutor(options);
}
