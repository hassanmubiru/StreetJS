/**
 * @streetjs/workflow — the Compensator and the Saga authoring helpers.
 *
 * This module implements the **saga rollback** machinery (Requirement 10). When
 * an Activity terminally fails and at least one previously `completed` Activity
 * declared a Compensation_Action, the {@link Compensator} drives the run through
 * the `compensating` → `compensated` lifecycle, invoking each completed
 * activity's `rollback` in **reverse completion order, exactly once each**
 * (Requirements 10.2, 10.3). A completed activity that declared no
 * Compensation_Action is skipped and the remaining activities are still
 * compensated (Requirement 10.4); a `rollback` that itself throws is recorded as
 * a `compensation.failed` History event and the remaining compensations still
 * run (Requirement 10.5).
 *
 * Compensation functions are not serializable, so they are never stored on the
 * durable {@link CommandRecord}. Instead the Compensator keeps an in-process
 * registry keyed by the journaled command `seq`; the runtime (and the
 * {@link Saga} helpers below) call {@link Compensator.register} as each
 * compensable activity completes — including during replay-driven resume, so the
 * registry is rebuilt deterministically before a rollback runs. Exactly-once is
 * guaranteed durably by the `compensated` flag on each {@link CommandRecord}: a
 * command whose flag is already set is never rolled back again, even across a
 * process restart (design "Compensation").
 *
 * The {@link createSaga} factory exposes the `step()` / `compensate()` /
 * `rollback()` authoring surface (Requirement 10.6) over exactly the same
 * Compensator machinery: `step` runs an activity, `compensate` runs an activity
 * and registers its `rollback`, and `rollback` triggers the reverse-order
 * compensation now.
 *
 * This module imports only the shared models from `./types.js` and the `Clock`
 * primitive from `streetjs`; it depends on no sibling execution module, keeping
 * the dependency direction acyclic.
 *
 * _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_
 */

import type { Clock } from "streetjs";

import type {
  Activity,
  ActivityOptions,
  Compensation,
  HistoryEvent,
  RunStatus,
  Saga,
  SerializedError,
  WorkflowRun,
  WorkflowStore,
} from "./types.js";

/**
 * Project an arbitrary thrown value into the JSON-safe {@link SerializedError}
 * recorded in the History. Real `Error` instances preserve their `name`,
 * `message`, and `stack`; anything else is stringified into a generic error.
 */
function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return error.stack !== undefined
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

/** A registered compensation: the command `seq` it undoes and its bound rollback. */
interface CompensationRegistration {
  /** The journaled sequence number of the completed command this rolls back. */
  readonly seq: number;
  /**
   * The rollback closure with its recorded `output` already bound; it receives
   * only the {@link AbortSignal} threaded through the compensation run.
   */
  readonly invoke: (signal: AbortSignal) => Promise<void>;
}

/**
 * Runs an activity on behalf of a {@link Saga}, returning both the typed result
 * and the journaled `seq` assigned to the command so the Saga can register a
 * compensation against it. This is supplied by the runtime/executor (wired in a
 * later task); the Compensator and Saga depend only on this structural shape,
 * never on a concrete executor module.
 */
export type SagaActivityRunner = <Out>(
  fn: Activity<Out>,
  options?: ActivityOptions<Out>,
) => Promise<{ readonly output: Out; readonly seq: number }>;

/** Construction inputs for a {@link Compensator}. */
export interface CompensatorOptions {
  /** The run whose completed compensable activities may be rolled back. */
  readonly run: WorkflowRun;
  /** The persistence contract; every transition is saved before advancing. */
  readonly store: WorkflowStore;
  /** The injected Clock; all History `at` timestamps are read from it. */
  readonly clock: Clock;
}

/**
 * Drives reverse-order saga rollback for a single {@link WorkflowRun}
 * (Requirement 10).
 *
 * A Compensator is scoped to one run. The runtime registers a compensation for
 * every compensable activity as it completes (via {@link register}); on terminal
 * activity failure it calls {@link compensate}, which transitions the run to
 * `compensating`, runs each registered rollback whose command is `completed` and
 * not yet compensated in **reverse completion order exactly once**, records the
 * per-activity `compensation.*` History events, and finally transitions the run
 * to `compensated`. The evolving run snapshot is persisted through the
 * {@link WorkflowStore} before each step so the lifecycle survives a restart.
 */
export class Compensator {
  /** The current in-memory run snapshot; replaced immutably on every mutation. */
  private run: WorkflowRun;
  private readonly store: WorkflowStore;
  private readonly clock: Clock;

  /** Registered compensations, in the order their activities completed. */
  private readonly registrations: CompensationRegistration[] = [];

  constructor(options: CompensatorOptions) {
    this.run = options.run;
    this.store = options.store;
    this.clock = options.clock;
  }

  /** The latest run snapshot reflecting any compensation progress. */
  get current(): WorkflowRun {
    return this.run;
  }

  /**
   * Register the Compensation_Action of a `completed` compensable activity so it
   * can be rolled back later (Requirement 10.1). The `output` recorded for the
   * activity is bound now, matching the {@link Compensation} signature
   * `(output, signal) => ...`. Called by the runtime and by the {@link Saga}
   * helpers as each compensable activity completes, including during
   * replay-driven resume so the registry is rebuilt before any rollback runs.
   *
   * A duplicate registration for a `seq` that already has one is ignored, so
   * replay cannot enqueue the same rollback twice.
   */
  register<Out>(seq: number, rollback: Compensation<Out>, output: Out): void {
    if (this.registrations.some((r) => r.seq === seq)) {
      return;
    }
    this.registrations.push({
      seq,
      invoke: async (signal: AbortSignal): Promise<void> => {
        await rollback(output, signal);
      },
    });
  }

  /**
   * Run saga rollback for the run's completed compensable activities
   * (Requirements 10.2–10.5).
   *
   * Behaviour:
   * - Selects every command that is `completed`, has a registered compensation,
   *   and is not already `compensated`, ordered by **reverse completion order**
   *   (latest `completedAt` first, breaking ties by descending `seq`).
   * - When there is no such activity the run is left untouched and returned; the
   *   caller (runtime) is responsible for the plain `failed` transition
   *   (Requirement 10.2 only triggers with at least one completed compensable
   *   activity).
   * - Otherwise transitions the run to `compensating`, then for each selected
   *   command records `compensation.started`, invokes its `rollback` exactly
   *   once, and records `compensation.completed` on success or
   *   `compensation.failed` on error (continuing either way). The command's
   *   `compensated` flag is set as soon as its rollback has run — success or
   *   failure — so it is never retried, even after a restart.
   * - When every applicable compensation has run, transitions to `compensated`
   *   (Requirement 10.3).
   *
   * @param signal Optional AbortSignal threaded into each rollback; defaults to
   *   a never-aborted signal.
   * @returns The final run snapshot.
   */
  async compensate(signal?: AbortSignal): Promise<WorkflowRun> {
    const abort = signal ?? new AbortController().signal;
    const registered = new Map(this.registrations.map((r) => [r.seq, r]));

    const targets = this.run.commands
      .filter(
        (command) =>
          command.status === "completed" &&
          command.compensated !== true &&
          registered.has(command.seq),
      )
      .sort((a, b) => {
        const aAt = a.completedAt ?? a.seq;
        const bAt = b.completedAt ?? b.seq;
        if (bAt !== aAt) {
          return bAt - aAt;
        }
        return b.seq - a.seq;
      });

    // Requirement 10.2: compensation is only entered when there is at least one
    // completed compensable activity to roll back.
    if (targets.length === 0) {
      return this.run;
    }

    await this.transition("compensating");

    for (const command of targets) {
      const registration = registered.get(command.seq);
      // Defensive: a target is always registered, but guard to satisfy types.
      if (registration === undefined) {
        continue;
      }

      await this.appendHistory({ type: "compensation.started", at: this.clock(), seq: command.seq });

      try {
        await registration.invoke(abort);
        // Mark exactly-once (ran) before recording the successful outcome.
        this.markCompensated(command.seq);
        await this.appendHistory({
          type: "compensation.completed",
          at: this.clock(),
          seq: command.seq,
        });
      } catch (error) {
        // Requirement 10.5: record the failure and continue the remaining
        // compensations. The rollback still ran exactly once, so mark it.
        this.markCompensated(command.seq);
        await this.appendHistory({
          type: "compensation.failed",
          at: this.clock(),
          seq: command.seq,
          error: serializeError(error),
        });
      }
    }

    // Requirement 10.3: every applicable compensation has run to completion.
    await this.transition("compensated");
    return this.run;
  }

  /**
   * Transition the run to `to`, recording a `run.status` History event, and
   * persist the snapshot. A no-op when the status is unchanged.
   */
  private async transition(to: RunStatus): Promise<void> {
    const from = this.run.status;
    if (from === to) {
      return;
    }
    const at = this.clock();
    this.run = {
      ...this.run,
      status: to,
      history: [...this.run.history, { type: "run.status", at, from, to }],
      updatedAt: at,
    };
    await this.store.save(this.run);
  }

  /**
   * Append a History event to the in-memory run and persist the snapshot,
   * making the audit record durable before the next step advances.
   */
  private async appendHistory(event: HistoryEvent): Promise<void> {
    this.run = {
      ...this.run,
      history: [...this.run.history, event],
      updatedAt: this.clock(),
    };
    await this.store.save(this.run);
  }

  /**
   * Set the `compensated` flag on the command with the given `seq` in the
   * in-memory run. The change is persisted by the History append that
   * immediately follows, keeping the marker and its audit event in one save.
   */
  private markCompensated(seq: number): void {
    this.run = {
      ...this.run,
      commands: this.run.commands.map((command) =>
        command.seq === seq ? { ...command, compensated: true } : command,
      ),
      updatedAt: this.clock(),
    };
  }
}

/**
 * Build the {@link Saga} authoring helpers over a {@link Compensator}
 * (Requirement 10.6).
 *
 * The three helpers are thin ergonomics over the same machinery:
 * - `step(fn, options)` runs an activity and returns its result. If `options`
 *   declares a `compensate`, it is registered so the step participates in
 *   rollback exactly like a `compensate(...)` call.
 * - `compensate(fn, rollback, options)` runs an activity and registers the given
 *   `rollback` against its journaled command. The explicit `rollback` takes
 *   precedence over any `options.compensate`.
 * - `rollback()` triggers reverse-order compensation now via the Compensator.
 *
 * @param compensator The run-scoped Compensator that owns the registry.
 * @param run A {@link SagaActivityRunner} that executes an activity and returns
 *   its result and journaled `seq`.
 */
export function createSaga(compensator: Compensator, run: SagaActivityRunner): Saga {
  return {
    async step<Out>(fn: Activity<Out>, options?: ActivityOptions<Out>): Promise<Out> {
      const { output, seq } = await run(fn, options);
      if (options?.compensate !== undefined) {
        compensator.register(seq, options.compensate, output);
      }
      return output;
    },

    async compensate<Out>(
      fn: Activity<Out>,
      rollback: Compensation<Out>,
      options?: ActivityOptions<Out>,
    ): Promise<Out> {
      const { output, seq } = await run(fn, options);
      compensator.register(seq, rollback, output);
      return output;
    },

    async rollback(): Promise<void> {
      await compensator.compensate();
    },
  };
}

/**
 * Convenience factory mirroring {@link Compensator}'s constructor for callers
 * that prefer a functional construction style.
 */
export function createCompensator(options: CompensatorOptions): Compensator {
  return new Compensator(options);
}
