/**
 * @streetjs/workflow — the Runtime that drives the imperative Workflow_Function.
 *
 * The {@link WorkflowRuntime} is the engine's execution core (design "Driving the
 * function", "Execution and Durability Flow"). It takes a persisted
 * {@link WorkflowRun} and its registered {@link WorkflowFunction}, wires the
 * durable machinery around a per-run {@link WorkflowContext}, invokes the function
 * with `(ctx, input)`, and drives it forward to exactly one terminal disposition:
 *
 * 1. **Waiting.** When the function awaits a timer
 *    (`ctx.sleep`/`waitUntil`/`cron`/`interval`) or a signal/event
 *    (`ctx.events.waitFor`), the {@link Journal} settles the command as `waiting`,
 *    **persists the wait** (with the absolute `timerExpiresAt` or `waitingFor`
 *    name) and the `waiting` Run_Status, and throws a {@link WorkflowSuspension}
 *    to unwind the function. The runtime catches the suspension and finalizes the
 *    run as parked — the durable wait is already recorded, so nothing more is
 *    persisted (Requirements 9.1, 9.2, 7.5).
 * 2. **Completed.** When the function returns a value, the runtime records that
 *    value as the typed `output` and transitions the run to `completed`, both
 *    through {@link Journal.commit} (Requirement 3.2).
 * 3. **Failed / compensated.** When the function throws an error that is not a
 *    suspension, the runtime hands off to the {@link Compensator}. If at least one
 *    previously `completed` compensable activity was registered, saga rollback
 *    runs in reverse completion order and the run reaches `compensated`
 *    (Requirement 10). Otherwise the run transitions to `failed`, recording the
 *    terminal error (Requirement 3.3).
 *
 * **Replay-driving (Requirement 13.3).** The runtime owns the replay path: to
 * resume a run it simply **re-invokes the function from the top** with the same
 * input. Each already-settled command is short-circuited by the {@link Journal},
 * which returns its recorded outcome without re-executing the effect, so no
 * `completed` activity runs twice (Requirements 13.2, 20.3). Replay is silent
 * until the function reaches the first command with no recorded outcome (the
 * interruption frontier), from which point execution resumes **live**. Because a
 * resumed run may enter the runtime in a non-`running` Run_Status (a `waiting`
 * timer/event or a `paused` run being continued), the runtime first normalizes it
 * back to `running` through {@link Journal.commit} so subsequent transitions are
 * consistent with the state machine (design "Workflow Run State Machine").
 *
 * The runtime never imports the concrete pillar packages, and it depends on the
 * Activity Executor only through a small adapter that satisfies the injected
 * {@link ActivityRunner} contract of `./context.ts`, keeping the dependency
 * direction acyclic (runtime → journal/context/executor/compensator/coordinator →
 * types). The facade (`src/engine.ts`, task 14) constructs one runtime and calls
 * {@link WorkflowRuntime.drive} for every `run`/`resume`.
 *
 * _Requirements: 3.1, 3.2, 3.3, 7.1, 7.5, 9.1, 9.2, 13.3_
 */

import type { Clock } from "streetjs";
import { systemClock } from "streetjs";

import { Compensator } from "./compensator.js";
import type { ActivityRunInfo, ActivityRunResult, ActivityRunner } from "./context.js";
import { createContext } from "./context.js";
import type { SignalTimerCoordinator } from "./coordinator.js";
import { ActivityExecutor } from "./executor.js";
import { Journal, WorkflowSuspension, serializeError } from "./journal.js";
import type {
  Activity,
  ActivityOptions,
  Compensation,
  EventsLike,
  QueueLike,
  RealtimeLike,
  RunStatus,
  SerializedError,
  StorageLike,
  WorkflowFunction,
  WorkflowLogger,
  WorkflowRun,
  WorkflowStore,
} from "./types.js";

// ── Construction inputs ────────────────────────────────────────────────────────

/** The optional structural pillar bridges threaded onto every run's `ctx`. */
export interface RuntimeBridges {
  readonly storage?: StorageLike;
  readonly queue?: QueueLike;
  readonly events?: EventsLike;
  readonly realtime?: RealtimeLike;
}

/** Construction inputs for a {@link WorkflowRuntime}. */
export interface WorkflowRuntimeOptions {
  /** The persistence contract; the Journal and Compensator write through it (Req 11.2). */
  readonly store: WorkflowStore;
  /** The shared Signal/Timer Coordinator every wait and cancellation is routed through. */
  readonly coordinator: SignalTimerCoordinator;
  /** The shared Activity Executor that runs a single activity to a terminal outcome (Req 4–6). */
  readonly executor: ActivityExecutor;
  /** Injected Clock for all timestamps and timer math; defaults to {@link systemClock} (Req 20.1). */
  readonly clock?: Clock;
  /** Optional structural pillar bridges; each is optional and purely structural (Req 15–18). */
  readonly bridges?: RuntimeBridges;
  /** Optional factory yielding a run-scoped logger exposed as `ctx.logger` (Req 19.1). */
  readonly loggerFor?: (runId: string) => WorkflowLogger;
}

// ── Drive result ─────────────────────────────────────────────────────────────────

/**
 * The disposition of a single {@link WorkflowRuntime.drive} call.
 *
 * `status` is the Run_Status the drive finalized at: `waiting` (parked on a
 * timer/signal), `completed` (returned a value), `failed` (unhandled throw with no
 * compensation), or `compensated`/`compensating` (saga rollback ran). `run` is the
 * final persisted snapshot; `output` carries the typed return value on completion;
 * `error` carries the serialized terminal error on a failure not resolved by
 * compensation.
 */
export interface DriveResult<O = unknown> {
  /** The final persisted run snapshot after this drive. */
  readonly run: WorkflowRun;
  /** The Run_Status the drive finalized at. */
  readonly status: RunStatus;
  /** The typed workflow output, present when `status` is `"completed"` (Req 3.2). */
  readonly output?: O;
  /** The serialized terminal error, present when the run failed (Req 3.3). */
  readonly error?: SerializedError;
}

/** A compensation captured as a compensable activity completes during a live drive. */
interface CapturedCompensation {
  readonly seq: number;
  readonly rollback: Compensation<unknown>;
  readonly output: unknown;
}

// ── The runtime ──────────────────────────────────────────────────────────────────

/**
 * Drives the imperative Workflow_Function forward through the Journal, Executor,
 * Compensator, and Coordinator, finalizing exactly one terminal disposition per
 * drive (see the module doc).
 *
 * A single runtime instance is shared by the engine across all runs; each
 * {@link drive} call is independent, building its own per-run {@link Journal},
 * {@link WorkflowContext}, and compensation registry over the supplied snapshot.
 */
export class WorkflowRuntime {
  private readonly store: WorkflowStore;
  private readonly coordinator: SignalTimerCoordinator;
  private readonly executor: ActivityExecutor;
  private readonly clock: Clock;
  private readonly bridges: RuntimeBridges | undefined;
  private readonly loggerFor: ((runId: string) => WorkflowLogger) | undefined;

  constructor(options: WorkflowRuntimeOptions) {
    this.store = options.store;
    this.coordinator = options.coordinator;
    this.executor = options.executor;
    this.clock = options.clock ?? systemClock;
    this.bridges = options.bridges;
    this.loggerFor = options.loggerFor;
  }

  /**
   * Drive a Workflow_Run to its next terminal disposition.
   *
   * Builds a per-run {@link Journal} over the persisted snapshot, wires the
   * Activity Executor as the injected {@link ActivityRunner}, constructs the
   * `ctx` surface (with the Coordinator, Clock, bridges, and logger), and invokes
   * `fn(ctx, input)`. On a fresh run the function executes live; on a resume it is
   * re-invoked from the top and the Journal replays journaled commands until the
   * interruption frontier, then continues live (Requirements 13.2, 13.3, 20.3).
   *
   * @param run The persisted run snapshot to drive; its `input` is passed to `fn`.
   * @param fn  The registered Workflow_Function to invoke (Requirement 3.1).
   * @returns The {@link DriveResult} describing the finalized disposition.
   */
  async drive<I, O>(run: WorkflowRun, fn: WorkflowFunction<I, O>): Promise<DriveResult<O>> {
    const clock = this.clock;
    const journal = new Journal({ run, store: this.store, clock });
    const runId = journal.runId;
    const definition = run.definition;

    // Resuming a `waiting` (timer/event) or `paused` run re-enters the runtime in
    // a non-`running` status; normalize it back to `running` before replay so the
    // subsequent terminal transition is consistent with the state machine
    // (design "Workflow Run State Machine"). A freshly `running` run is untouched.
    if (journal.run.status !== "running") {
      await journal.commit({
        status: "running",
        history: [{ type: "run.status", at: clock(), from: journal.run.status, to: "running" }],
      });
    }

    // Compensations captured as compensable activities complete on the live path.
    // On replay the Journal returns recorded results without invoking the runner,
    // so only activities executed live in this drive are registered here.
    const compensations: CapturedCompensation[] = [];
    const executor = this.executor;

    // Adapter satisfying `./context.ts`'s injected ActivityRunner contract: run
    // one activity to a terminal outcome through the Executor (timeout, retry,
    // AbortSignal, middleware, direct/queue), capture its compensation on success,
    // and project the executor's outcome onto the runner result shape.
    async function runActivity<Out>(
      activity: Activity<Out>,
      options: ActivityOptions<Out> | undefined,
      info: ActivityRunInfo,
    ): Promise<ActivityRunResult<Out>> {
      const outcome = await executor.run<Out>({
        seq: info.seq,
        activity,
        options,
        runId: info.runId,
      });
      const attempts = outcome.attempts ?? 1;

      if (outcome.status === "completed") {
        if (options?.compensate !== undefined) {
          compensations.push({
            seq: info.seq,
            rollback: options.compensate as unknown as Compensation<unknown>,
            output: outcome.result,
          });
        }
        return {
          status: "completed",
          result: outcome.result as Out,
          attempts,
          ...(outcome.history !== undefined ? { history: outcome.history } : {}),
        };
      }
      if (outcome.status === "failed") {
        return {
          status: "failed",
          error: outcome.error,
          attempts,
          ...(outcome.history !== undefined ? { history: outcome.history } : {}),
        };
      }
      // The Executor settles activities to a terminal result or failure; a
      // `waiting` outcome would indicate a wiring error.
      throw new Error(`Activity command seq ${info.seq} produced an unexpected waiting outcome.`);
    }

    const runActivityAdapter: ActivityRunner = runActivity;

    const ctx = createContext({
      journal,
      coordinator: this.coordinator,
      clock,
      definition,
      runActivity: runActivityAdapter,
      ...(this.bridges !== undefined ? { bridges: this.bridges } : {}),
      ...(this.loggerFor !== undefined ? { logger: this.loggerFor(runId) } : {}),
    });

    try {
      const output = await fn(ctx, journal.run.input as I);
      return await this.finalizeCompleted<O>(journal, output as O);
    } catch (error) {
      if (WorkflowSuspension.is(error)) {
        // The Journal already persisted the `waiting` command and Run_Status; the
        // run is parked and will be re-driven by the Coordinator on resume.
        return { run: journal.run, status: journal.run.status };
      }
      return await this.finalizeFailure<O>(journal, compensations, error);
    }
  }

  /**
   * Record the returned value as the run's typed `output` and transition to
   * `completed` through {@link Journal.commit} (Requirement 3.2).
   */
  private async finalizeCompleted<O>(journal: Journal, output: O): Promise<DriveResult<O>> {
    const from = journal.run.status;
    const completed = await journal.commit({
      status: "completed",
      output,
      history: [{ type: "run.status", at: this.clock(), from, to: "completed" }],
    });
    return { run: completed, status: "completed", output };
  }

  /**
   * Handle an unhandled throw: attempt saga compensation first, and only fall back
   * to a plain `failed` transition when no completed compensable activity was
   * registered (Requirements 3.3, 10).
   *
   * A {@link Compensator} is built over the Journal's **latest** snapshot (which
   * holds every command recorded so far, including the terminally-failed one) and
   * seeded with the compensations captured during this drive. If it rolls anything
   * back the run reaches `compensating`/`compensated` and that snapshot is
   * terminal; otherwise the run transitions to `failed`, recording the serialized
   * error (which, for an activity-originated failure, is already present in the
   * History as an `activity.failed` event).
   */
  private async finalizeFailure<O>(
    journal: Journal,
    compensations: readonly CapturedCompensation[],
    error: unknown,
  ): Promise<DriveResult<O>> {
    const serialized = serializeError(error);

    if (compensations.length > 0) {
      const compensator = new Compensator({
        run: journal.run,
        store: this.store,
        clock: this.clock,
      });
      for (const captured of compensations) {
        compensator.register(captured.seq, captured.rollback, captured.output);
      }
      const compensated = await compensator.compensate();
      // Compensation ran when at least one completed compensable activity was
      // rolled back (the run reached `compensating`/`compensated`); that snapshot
      // is the terminal disposition (Requirements 10.2, 10.3).
      if (compensated.status === "compensated" || compensated.status === "compensating") {
        return { run: compensated, status: compensated.status };
      }
    }

    // No compensation applied: transition to `failed` and record the error.
    const from = journal.run.status;
    const failed = await journal.commit({
      status: "failed",
      history: [{ type: "run.status", at: this.clock(), from, to: "failed" }],
    });
    return { run: failed, status: "failed", error: serialized };
  }
}

/**
 * Convenience factory mirroring {@link WorkflowRuntime}'s constructor for callers
 * that prefer a functional construction style.
 */
export function createWorkflowRuntime(options: WorkflowRuntimeOptions): WorkflowRuntime {
  return new WorkflowRuntime(options);
}
