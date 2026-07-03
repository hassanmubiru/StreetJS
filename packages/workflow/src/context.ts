/**
 * @streetjs/workflow — the typed Workflow_Context (`ctx`) surface.
 *
 * {@link createContext} builds the per-run `ctx` object handed to every
 * `Workflow_Function` (design "The Workflow_Context (`ctx`) Surface"). It is the
 * single place that wires the imperative surface a workflow author uses onto the
 * durable machinery of the engine, honouring the journaled, deterministic-replay
 * execution model:
 *
 * - **Every effectful member is a journaled command.** `ctx.activity`, the
 *   `ctx.parallel.*` combinators, the timers (`ctx.sleep`/`waitUntil`/`cron`/
 *   `interval`), the four pillar bridge surfaces (`ctx.queue`/`events`/`storage`/
 *   `realtime`), and `ctx.state.set` are all routed through the {@link Journal}
 *   via {@link Journal.process} / {@link Journal.setState}. On first execution the
 *   effect runs and its outcome is recorded and persisted **before** control
 *   returns; on replay the recorded outcome is returned without re-executing the
 *   effect (Requirements 3.4, 4.1, 4.3, 15.1, 16.1, 17.1, 18.1, 19.4, 20.3).
 * - **Every wait is routed through the Coordinator.** The timers build their
 *   journaled outcome through {@link SignalTimerCoordinator.timerOutcome}, so a
 *   zero/negative/past duration or a non-future absolute time continues without
 *   entering `waiting` (Requirement 9.6) while a future expiry parks the run with
 *   its **absolute** expiry preserved across a restart (Requirements 9.1, 9.2,
 *   9.5). `ctx.events.waitFor` consumes an early-buffered signal when present and
 *   otherwise parks the run as `waiting` on the named event (Requirement 17.2).
 * - **Local helpers are deterministic and un-journaled.** `ctx.if`/`switch`/
 *   `match` (with their default branches), `ctx.logger`, `ctx.clock`, and
 *   `ctx.metadata` consume no `seq`; they are reconstructed by re-execution during
 *   replay (Requirements 8.1–8.5, 19.1–19.3, design step 1). `ctx.state` reads are
 *   served from the loaded durable snapshot so they survive replay (Requirement
 *   19.4).
 * - **The bridge surfaces are present and typed regardless of wiring.** They are
 *   built from the optional structural `*Like` bridges through the
 *   `integrations/*` factories, which already raise a descriptive
 *   {@link WorkflowConfigError} when a bridge is used without being wired and
 *   otherwise run unaffected (Requirements 15.3, 15.4, 16.4, 18.4).
 *
 * To keep the dependency direction acyclic and avoid a hard dependency on the
 * still-being-built Activity Executor (`src/executor.ts`, task 9.1), the function
 * that actually runs a single activity — applying its timeout, Retry_Policy,
 * AbortSignal, and middleware — is **injected** as the {@link ActivityRunner}
 * callback in {@link CreateContextOptions.runActivity}. The engine (task 14)
 * supplies an adapter over the real `ActivityExecutor`; tests can supply a plain
 * function. This module therefore imports the Journal, the Coordinator, the four
 * bridge factories, and the shared types — never the executor.
 *
 * _Requirements: 3.4, 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3,
 * 9.4, 9.6, 15.1, 16.1, 17.1, 17.2, 18.1, 19.1, 19.2, 19.3, 19.4_
 */

import type { Clock } from "streetjs";

import { bridgeWorkflowEvents } from "./integrations/events.js";
import { bridgeWorkflowQueue } from "./integrations/queue.js";
import { bridgeWorkflowRealtime } from "./integrations/realtime.js";
import { bridgeWorkflowStorage } from "./integrations/storage.js";
import type { CommandOutcome } from "./journal.js";
import { Journal, serializeError } from "./journal.js";
import { SignalTimerCoordinator } from "./coordinator.js";
import type {
  Activity,
  ActivityOptions,
  Branch,
  EventsLike,
  HistoryEvent,
  ParallelInput,
  QueueLike,
  RealtimeLike,
  SerializedError,
  StorageLike,
  WorkflowContext,
  WorkflowLogger,
  WorkflowMetadata,
  WorkflowState,
} from "./types.js";

// ── Injected activity runner contract ────────────────────────────────────────────

/**
 * Information handed to the injected {@link ActivityRunner} for a single
 * `ctx.activity` (or parallel child) invocation.
 *
 * The runner owns AbortSignal creation and cancellation wiring (Requirement 4.4)
 * because it is adapted over the `ActivityExecutor`, which is constructed by the
 * engine with the shared {@link SignalTimerCoordinator}; the context only tells
 * it which run/command it is executing on.
 */
export interface ActivityRunInfo {
  /** The journaled sequence number assigned to the activity command. */
  readonly seq: number;
  /** The Workflow_Run this activity belongs to. */
  readonly runId: string;
  /** The registered Workflow_Definition name. */
  readonly definition: string;
  /** The injected Clock, so the runner measures timeouts/backoff on the same time source. */
  readonly clock: Clock;
}

/**
 * The settled outcome the {@link ActivityRunner} reports back for one activity.
 *
 * The runner runs the activity to a terminal outcome (exhausting retries and
 * honouring the timeout), so it returns either a `completed` result or a `failed`
 * error together with the consumed `attempts` and any `History` events
 * (`activity.started`/`activity.failed`/`retry.scheduled`/`activity.completed`)
 * it produced. The context forwards these onto the journaled command record so
 * they are persisted atomically with the outcome (write-before-advance).
 */
export interface ActivityRunResult<Out> {
  /** Whether the activity settled successfully or terminally failed. */
  readonly status: "completed" | "failed";
  /** The typed result, present when `status` is `"completed"`. */
  readonly result?: Out;
  /** The serialized terminal error, present when `status` is `"failed"`. */
  readonly error?: SerializedError;
  /** The consumed attempt count (initial + retries), at least 1. */
  readonly attempts: number;
  /** History events produced while running the activity, recorded with the command. */
  readonly history?: readonly HistoryEvent[];
}

/**
 * The injected function that runs a single activity attempt-set to completion.
 *
 * Supplied through {@link CreateContextOptions.runActivity} so the context never
 * imports the Activity Executor directly. The engine adapts the real
 * `ActivityExecutor` onto this shape; a test may pass a plain function that
 * simply invokes the activity.
 */
export type ActivityRunner = <Out>(
  activity: Activity<Out>,
  options: ActivityOptions<Out> | undefined,
  info: ActivityRunInfo,
) => Promise<ActivityRunResult<Out>>;

// ── createContext options ──────────────────────────────────────────────────────────

/** Construction inputs for {@link createContext}. */
export interface CreateContextOptions {
  /** The per-run Journal driving record/replay; its `runId` identifies the run. */
  readonly journal: Journal;
  /** The shared Signal/Timer Coordinator every wait is routed through. */
  readonly coordinator: SignalTimerCoordinator;
  /** The injected Clock exposed as `ctx.clock` and used for all timer math (Req 19.2, 20.1). */
  readonly clock: Clock;
  /** The registered Workflow_Definition name, surfaced on `ctx.metadata` (Req 19.3). */
  readonly definition: string;
  /** Runs one activity to a terminal outcome; injected to avoid a hard executor dependency. */
  readonly runActivity: ActivityRunner;
  /** Optional structural pillar bridges; each is optional and purely structural (Req 15–18). */
  readonly bridges?: {
    readonly storage?: StorageLike;
    readonly queue?: QueueLike;
    readonly events?: EventsLike;
    readonly realtime?: RealtimeLike;
  };
  /** The run-scoped logger exposed as `ctx.logger`; a silent logger is used when omitted (Req 19.1). */
  readonly logger?: WorkflowLogger;
  /**
   * Invoked when `ctx.events.waitFor` parks the run on a named event, so the
   * runtime (task 13) can observe the waiting intent (Requirement 17.2). Purely
   * observational; the durable `waiting` transition is recorded by the Journal.
   */
  readonly onWaitForEvent?: (event: string) => void;
}

/** A logger that discards entries; the engine injects a real run-scoped logger. */
const SILENT_LOGGER: WorkflowLogger = {
  debug(): void {},
  info(): void {},
  warn(): void {},
  error(): void {},
};

/**
 * Build the typed `ctx` surface for a single Workflow_Run.
 *
 * @param options - The run's {@link Journal}, the shared
 *   {@link SignalTimerCoordinator}, the injected {@link Clock}, the definition
 *   name, the injected {@link ActivityRunner}, and the optional structural pillar
 *   bridges and logger.
 * @returns The {@link WorkflowContext} passed to the Workflow_Function. Every
 *   effectful member is journaled; every wait is routed through the coordinator;
 *   local helpers are deterministic and un-journaled.
 */
export function createContext(options: CreateContextOptions): WorkflowContext {
  const { journal, coordinator, clock, definition, runActivity } = options;
  const runId = journal.runId;
  const logger = options.logger ?? SILENT_LOGGER;

  // The four pillar bridge surfaces. Each is present and typed regardless of
  // wiring; the factory raises a descriptive WorkflowConfigError when an unwired
  // surface is used and otherwise leaves absent bridges as harmless no-ops
  // (Requirements 15.3, 15.4, 16.4, 18.4).
  const storageBridge = bridgeWorkflowStorage(options.bridges?.storage);
  const queueBridge = bridgeWorkflowQueue(options.bridges?.queue);
  const realtimeBridge = bridgeWorkflowRealtime(options.bridges?.realtime);

  // Publish failures are fire-and-forget: the events bridge catches them and
  // hands them here so the enclosing `events.publish` journaled command can
  // record a `publish.failed` History event atomically with its outcome, without
  // the failure propagating into the Workflow_Function (Requirement 17.5).
  const pendingPublishFailures: HistoryEvent[] = [];
  const eventsBridge = bridgeWorkflowEvents(options.bridges?.events, {
    onPublishFailure: (event, error): void => {
      pendingPublishFailures.push({ type: "publish.failed", at: clock(), event, error });
    },
    onWaitFor: (event): void => {
      options.onWaitForEvent?.(event);
    },
  });

  // The most recently consumed activity attempt count, surfaced as
  // `ctx.metadata.attempt` (Requirement 19.3). It reflects the last activity the
  // function ran; it is 0 before any activity executes.
  let currentAttempt = 0;

  const metadata: WorkflowMetadata = {
    runId,
    definition,
    get attempt(): number {
      return currentAttempt;
    },
  };

  const state: WorkflowState = {
    get<T>(key: string): T | undefined {
      // Served from the loaded durable snapshot, so reads survive replay (19.4).
      return journal.readState<T>(key);
    },
    set<T>(key: string, value: T): Promise<void> {
      // Persisted as a journaled `state.set` command (Requirement 19.4).
      return journal.setState<T>(key, value);
    },
  };

  // ── ctx.activity (Requirement 4) ────────────────────────────────────────────────

  function activity<Out>(fn: Activity<Out>, opts?: ActivityOptions<Out>): Promise<Out> {
    return journal.process<Out>({
      kind: "activity",
      ...(opts?.metadata !== undefined ? { metadata: opts.metadata } : {}),
      execute: async ({ seq }): Promise<CommandOutcome> => {
        const outcome = await runActivity(fn, opts, { seq, runId, definition, clock });
        currentAttempt = outcome.attempts;
        if (outcome.status === "completed") {
          return {
            status: "completed",
            result: outcome.result,
            attempts: outcome.attempts,
            ...(outcome.history !== undefined ? { history: outcome.history } : {}),
          };
        }
        return {
          status: "failed",
          error: outcome.error ?? { name: "Error", message: "Activity failed." },
          attempts: outcome.attempts,
          ...(outcome.history !== undefined ? { history: outcome.history } : {}),
        };
      },
    });
  }

  // ── ctx.parallel (Requirement 7, deterministic positional ordering) ──────────────

  /** Run a set of activities as one journaled command, collecting their results. */
  async function runParallelChildren(
    activities: readonly Activity<unknown>[],
    seq: number,
  ): Promise<readonly ActivityRunResult<unknown>[]> {
    // `Promise.all` preserves positional order of the input regardless of the
    // order in which the children settle (Requirements 7.2, 7.4, 7.6).
    return Promise.all(
      activities.map((child) => runActivity(child, undefined, { seq, runId, definition, clock })),
    );
  }

  /** The combined History and, on failure, the first recorded terminal error. */
  function combineChildren(results: readonly ActivityRunResult<unknown>[]): {
    readonly history: readonly HistoryEvent[];
    readonly failure: ActivityRunResult<unknown> | undefined;
  } {
    const history: HistoryEvent[] = [];
    let failure: ActivityRunResult<unknown> | undefined;
    for (const result of results) {
      if (result.history !== undefined) {
        history.push(...result.history);
      }
      if (failure === undefined && result.status === "failed") {
        failure = result;
      }
    }
    return { history, failure };
  }

  const parallel: WorkflowContext["parallel"] = {
    all<T extends readonly unknown[]>(activities: ParallelInput<T>): Promise<T> {
      return journal.process<T>({
        kind: "parallel.all",
        execute: async ({ seq }): Promise<CommandOutcome> => {
          const results = await runParallelChildren(activities as readonly Activity<unknown>[], seq);
          const { history, failure } = combineChildren(results);
          // A single terminal failure fails the whole `all` only after every
          // other activity in the collection has settled (Requirement 7.5).
          if (failure !== undefined) {
            return {
              status: "failed",
              error: failure.error ?? { name: "Error", message: "A parallel activity failed." },
              ...(history.length > 0 ? { history } : {}),
            };
          }
          return {
            status: "completed",
            result: results.map((result) => result.result) as unknown as T,
            ...(history.length > 0 ? { history } : {}),
          };
        },
      });
    },

    race<T>(activities: readonly Activity<T>[]): Promise<T> {
      return journal.process<T>({
        kind: "parallel.race",
        execute: async ({ seq }): Promise<CommandOutcome> => {
          try {
            // `Promise.any` resolves with the first activity to settle
            // successfully, ignoring failures until all fail (Requirement 7.3).
            const winner = await Promise.any(
              activities.map(async (child): Promise<T> => {
                const result = await runActivity(child, undefined, { seq, runId, definition, clock });
                if (result.status === "failed") {
                  throw new Error(result.error?.message ?? "A raced activity failed.");
                }
                return result.result as T;
              }),
            );
            return { status: "completed", result: winner };
          } catch (error) {
            // Every raced activity failed (an AggregateError from Promise.any).
            return { status: "failed", error: serializeError(error) };
          }
        },
      });
    },

    map<A, B>(items: readonly A[], mapper: (item: A, index: number) => Activity<B>): Promise<readonly B[]> {
      return journal.process<readonly B[]>({
        kind: "parallel.map",
        execute: async ({ seq }): Promise<CommandOutcome> => {
          const children = items.map((item, index) => mapper(item, index) as Activity<unknown>);
          const results = await runParallelChildren(children, seq);
          const { history, failure } = combineChildren(results);
          if (failure !== undefined) {
            return {
              status: "failed",
              error: failure.error ?? { name: "Error", message: "A mapped activity failed." },
              ...(history.length > 0 ? { history } : {}),
            };
          }
          return {
            status: "completed",
            result: results.map((result) => result.result) as B[],
            ...(history.length > 0 ? { history } : {}),
          };
        },
      });
    },
  };

  // ── ctx.if / switch / match (Requirement 8, local + deterministic) ───────────────

  function ifHelper(condition: boolean): {
    then(branch: Branch): { else(branch: Branch): Promise<void> } & Promise<void>;
  } {
    return {
      then(branch: Branch): { else(branch: Branch): Promise<void> } & Promise<void> {
        // The `then`-only path: execute the `then` branch when the condition is
        // true and nothing otherwise (Requirement 8.1). Deferred until awaited so
        // that calling `.else(...)` instead runs the else-aware path exactly once.
        const runThenOnly = async (): Promise<void> => {
          if (condition) {
            await branch();
          }
        };
        const thenable = {
          else(elseBranch: Branch): Promise<void> {
            // With an else branch, run `then` when true and `else` when false,
            // never both (Requirements 8.1, 8.2).
            return (async (): Promise<void> => {
              if (condition) {
                await branch();
              } else {
                await elseBranch();
              }
            })();
          },
          then<TResult1 = void, TResult2 = never>(
            onfulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ): Promise<TResult1 | TResult2> {
            return runThenOnly().then(onfulfilled, onrejected);
          },
          catch<TResult = never>(
            onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
          ): Promise<void | TResult> {
            return runThenOnly().catch(onrejected);
          },
          finally(onfinally?: (() => void) | null): Promise<void> {
            return runThenOnly().finally(onfinally);
          },
          [Symbol.toStringTag]: "Promise",
        };
        return thenable as unknown as { else(branch: Branch): Promise<void> } & Promise<void>;
      },
    };
  }

  async function switchHelper<T>(
    selector: T,
    cases: ReadonlyMap<T, Branch>,
    defaultBranch?: Branch,
  ): Promise<void> {
    // Execute the matching case, or the default branch when none matches
    // (Requirements 8.3, 8.5). Local and un-journaled.
    const branch = cases.get(selector) ?? defaultBranch;
    if (branch !== undefined) {
      await journal.local(() => branch());
    }
  }

  async function matchHelper<T>(
    value: T,
    patterns: readonly [pattern: (v: T) => boolean, branch: Branch][],
    defaultBranch?: Branch,
  ): Promise<void> {
    // Execute the branch of the first matching pattern, else the default branch
    // (Requirements 8.4, 8.5). Local and un-journaled.
    for (const [pattern, branch] of patterns) {
      if (pattern(value)) {
        await branch();
        return;
      }
    }
    if (defaultBranch !== undefined) {
      await defaultBranch();
    }
  }

  // ── ctx timers (Requirement 9, journaled waits via the Coordinator) ──────────────

  async function sleep(durationMs: number): Promise<void> {
    await journal.process<void>({
      kind: "sleep",
      execute: ({ seq, now }): CommandOutcome =>
        // A zero/negative duration is already expired, so the run continues
        // without entering `waiting` (Requirement 9.6); otherwise it parks until
        // `now + durationMs` on the Clock (Requirement 9.1).
        coordinator.timerOutcome({ seq, now, expiresAt: now + durationMs }),
    });
  }

  async function waitUntil(atEpochMs: number): Promise<void> {
    await journal.process<void>({
      kind: "waitUntil",
      execute: ({ seq, now }): CommandOutcome =>
        // A non-future absolute time is already expired (Requirement 9.6);
        // otherwise the run parks until `atEpochMs` on the Clock (Requirement 9.2).
        coordinator.timerOutcome({ seq, now, expiresAt: atEpochMs }),
    });
  }

  async function cron(expression: string, body: Branch): Promise<void> {
    // Park until the next time the cron expression fires on the Clock
    // (Requirement 9.3), then run the body. Because the next fire is strictly in
    // the future the run always parks; the absolute expiry is preserved across a
    // restart by the Journal record (Requirement 9.5).
    await journal.process<void>({
      kind: "cron",
      execute: ({ seq, now }): CommandOutcome =>
        coordinator.timerOutcome({ seq, now, expiresAt: computeNextCronTime(expression, now) }),
    });
    await body();
  }

  async function interval(durationMs: number, body: Branch): Promise<void> {
    // Park for one interval on the Clock (Requirement 9.4), then run the body.
    await journal.process<void>({
      kind: "interval",
      execute: ({ seq, now }): CommandOutcome =>
        coordinator.timerOutcome({ seq, now, expiresAt: now + durationMs }),
    });
    await body();
  }

  // ── ctx.queue / events / storage / realtime (Requirements 15–18, journaled) ──────

  const queue: WorkflowContext["queue"] = {
    dispatch(job: string, payload: unknown): Promise<string> {
      return journal.process<string>({
        kind: "queue.dispatch",
        execute: async (): Promise<CommandOutcome> => {
          // Throws a WorkflowConfigError when no QueueLike is wired (16.1 error path).
          const jobId = await queueBridge.queue.dispatch(job, payload);
          return { status: "completed", result: jobId };
        },
      });
    },
  };

  const events: WorkflowContext["events"] = {
    publish(event: string, payload: unknown): Promise<void> {
      return journal.process<void>({
        kind: "events.publish",
        execute: async ({ now }): Promise<CommandOutcome> => {
          const before = pendingPublishFailures.length;
          // Fire-and-forget: the bridge swallows a publish failure and routes it
          // to `onPublishFailure`, which appends to `pendingPublishFailures`. We
          // drain this call's failures and record them with the command (17.5).
          await eventsBridge.events.publish(event, payload);
          const failures = pendingPublishFailures.splice(before);
          void now;
          return {
            status: "completed",
            result: undefined,
            ...(failures.length > 0 ? { history: failures } : {}),
          };
        },
      });
    },

    waitFor<P>(event: string, opts?: { parse?: (p: unknown) => P }): Promise<P> {
      return journal.process<P>({
        kind: "events.waitFor",
        execute: (): CommandOutcome => {
          // Consume an early-delivered, still-buffered signal without entering
          // `waiting` (Requirement 17.2). Signals are buffered into the run's
          // `pendingSignals` by the coordinator on delivery.
          const buffered = journal.run.pendingSignals.find(
            (signal) => signal.name === event && !signal.consumed,
          );
          if (buffered !== undefined) {
            const payload = opts?.parse ? opts.parse(buffered.payload) : (buffered.payload as P);
            return { status: "completed", result: payload };
          }
          // Otherwise park as `waiting` on the named event; the coordinator
          // resumes the run exactly once when a matching signal is delivered.
          options.onWaitForEvent?.(event);
          return { status: "waiting", waitingFor: event, runStatus: "waiting" };
        },
      });
    },

    subscribe(event: string, handler: (payload: unknown) => void): () => void {
      // A live subscription is not a replayable effect: it is run locally and
      // returns the bridge's unsubscribe function (Requirement 17.3). Throws a
      // WorkflowConfigError when no EventsLike is wired.
      return journal.local(() => eventsBridge.events.subscribe(event, handler));
    },
  };

  const storage: WorkflowContext["storage"] = {
    put(key: string, content: Uint8Array | string, opts?: Record<string, unknown>): Promise<void> {
      return journal.process<void>({
        kind: "storage.put",
        execute: async (): Promise<CommandOutcome> => {
          await storageBridge.put(key, content, opts);
          return { status: "completed", result: undefined };
        },
      });
    },
    get(key: string): Promise<{ found: boolean; bytes?: Uint8Array; metadata?: unknown }> {
      return journal.process<{ found: boolean; bytes?: Uint8Array; metadata?: unknown }>({
        kind: "storage.get",
        execute: async (): Promise<CommandOutcome> => ({
          status: "completed",
          result: await storageBridge.get(key),
        }),
      });
    },
    delete(key: string): Promise<void> {
      return journal.process<void>({
        kind: "storage.delete",
        execute: async (): Promise<CommandOutcome> => {
          await storageBridge.delete(key);
          return { status: "completed", result: undefined };
        },
      });
    },
    move(from: string, to: string): Promise<void> {
      return journal.process<void>({
        kind: "storage.move",
        execute: async (): Promise<CommandOutcome> => {
          await storageBridge.move(from, to);
          return { status: "completed", result: undefined };
        },
      });
    },
    copy(from: string, to: string): Promise<void> {
      return journal.process<void>({
        kind: "storage.copy",
        execute: async (): Promise<CommandOutcome> => {
          await storageBridge.copy(from, to);
          return { status: "completed", result: undefined };
        },
      });
    },
  };

  const realtime: WorkflowContext["realtime"] = {
    broadcast(channel: string, payload: unknown): Promise<void> {
      return journal.process<void>({
        kind: "realtime.broadcast",
        execute: async (): Promise<CommandOutcome> => {
          // Throws a WorkflowConfigError when no RealtimeLike is wired; a wired
          // broadcast is best-effort and never fails the run (Requirement 18.1).
          await realtimeBridge.realtime.broadcast(channel, payload);
          return { status: "completed", result: undefined };
        },
      });
    },
  };

  const ctx: WorkflowContext = {
    activity,
    parallel,
    if: ifHelper,
    switch: switchHelper,
    match: matchHelper,
    sleep,
    waitUntil,
    cron,
    interval,
    queue,
    events,
    storage,
    realtime,
    logger,
    clock,
    metadata,
    state,
  };

  return ctx;
}

// ── Cron next-fire computation ─────────────────────────────────────────────────────

/**
 * Compute the next time (Clock epoch ms, UTC) a standard 5-field cron expression
 * fires strictly after `fromMs`.
 *
 * Fields are `minute hour day-of-month month day-of-week`, each supporting `*`,
 * single values, comma lists, `a-b` ranges, and `a-b/step` (or `*​/step`) steps.
 * Day-of-week is `0`–`6` with `0` = Sunday. Evaluation is UTC-based so the result
 * is deterministic under a Fake_Clock. The search scans forward minute-by-minute
 * up to roughly four years; if no match is found (an unsatisfiable expression) it
 * falls back to one minute after `fromMs`.
 *
 * This keeps the workflow engine's scheduling self-contained rather than
 * introducing a separate scheduling system (Requirement 9.7): the coordinator's
 * absolute-expiry timer machinery does the actual waiting.
 */
export function computeNextCronTime(expression: string, fromMs: number): number {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(
      `Invalid cron expression "${expression}": expected 5 space-separated fields (minute hour day-of-month month day-of-week).`,
    );
  }

  const minutes = parseCronField(fields[0] as string, 0, 59, expression);
  const hours = parseCronField(fields[1] as string, 0, 23, expression);
  const daysOfMonth = parseCronField(fields[2] as string, 1, 31, expression);
  const months = parseCronField(fields[3] as string, 1, 12, expression);
  const daysOfWeek = parseCronField(fields[4] as string, 0, 6, expression);

  // Start from the top of the next minute strictly after `fromMs`.
  const start = new Date(Math.floor(fromMs / 60_000) * 60_000 + 60_000);
  const maxIterations = 366 * 4 * 24 * 60; // ~4 years of minutes.
  const cursor = new Date(start.getTime());

  for (let i = 0; i < maxIterations; i += 1) {
    const matchesMonth = months.has(cursor.getUTCMonth() + 1);
    const matchesMinute = minutes.has(cursor.getUTCMinutes());
    const matchesHour = hours.has(cursor.getUTCHours());
    const matchesDom = daysOfMonth.has(cursor.getUTCDate());
    const matchesDow = daysOfWeek.has(cursor.getUTCDay());
    // Standard cron day matching: when both day-of-month and day-of-week are
    // restricted, a match on either satisfies the day constraint.
    const domRestricted = daysOfMonth.size < 31;
    const dowRestricted = daysOfWeek.size < 7;
    const matchesDay =
      domRestricted && dowRestricted ? matchesDom || matchesDow : matchesDom && matchesDow;

    if (matchesMonth && matchesDay && matchesHour && matchesMinute) {
      return cursor.getTime();
    }
    cursor.setTime(cursor.getTime() + 60_000);
  }

  return start.getTime();
}

/**
 * Parse a single cron field into the set of matching integers within
 * `[min, max]`. Supports `*`, `*​/step`, single values, comma lists, `a-b`
 * ranges, and `a-b/step` stepped ranges.
 */
function parseCronField(field: string, min: number, max: number, expression: string): ReadonlySet<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const [rangePart, stepPart] = part.split("/");
    const step = stepPart === undefined ? 1 : Number.parseInt(stepPart, 10);
    if (!Number.isInteger(step) || step <= 0) {
      throw new Error(`Invalid cron expression "${expression}": invalid step in "${part}".`);
    }

    let rangeStart = min;
    let rangeEnd = max;
    if (rangePart !== "*" && rangePart !== undefined) {
      const bounds = rangePart.split("-");
      if (bounds.length === 1) {
        const value = Number.parseInt(bounds[0] as string, 10);
        if (!Number.isInteger(value) || value < min || value > max) {
          throw new Error(`Invalid cron expression "${expression}": value "${bounds[0]}" out of range ${min}-${max}.`);
        }
        // A single value with a step (`v/step`) is treated as `v-max/step`.
        rangeStart = value;
        rangeEnd = stepPart === undefined ? value : max;
      } else if (bounds.length === 2) {
        rangeStart = Number.parseInt(bounds[0] as string, 10);
        rangeEnd = Number.parseInt(bounds[1] as string, 10);
        if (
          !Number.isInteger(rangeStart) ||
          !Number.isInteger(rangeEnd) ||
          rangeStart < min ||
          rangeEnd > max ||
          rangeStart > rangeEnd
        ) {
          throw new Error(`Invalid cron expression "${expression}": invalid range "${rangePart}".`);
        }
      } else {
        throw new Error(`Invalid cron expression "${expression}": invalid field "${part}".`);
      }
    }

    for (let value = rangeStart; value <= rangeEnd; value += step) {
      values.add(value);
    }
  }

  return values;
}
