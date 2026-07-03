/**
 * @streetjs/workflow — the Journal / Replay engine.
 *
 * The Journal is the heart of the **journaled, deterministic-replay** execution
 * model (design "The Replay (Journaled, Deterministic-Replay) Execution Model").
 * A `Workflow_Function` is an ordinary async function; the engine makes it
 * durable by routing **every effectful `ctx` command** through this Journal,
 * which:
 *
 * 1. **Allocates a monotonically incrementing `seq`** in the exact order the
 *    function issues effectful commands. Purely local computation (`ctx.if`,
 *    `ctx.switch`, `ctx.match`, `ctx.logger`, `ctx.clock` reads, `ctx.metadata`)
 *    is deterministic and is **not** journaled — see {@link Journal.local}
 *    (Requirement 20, design step 1).
 * 2. **On first execution — records.** It runs the supplied effect thunk,
 *    records the outcome as a {@link CommandRecord}/{@link HistoryEvent} keyed by
 *    that `seq`, and **persists the run through the {@link WorkflowStore} before
 *    returning control** to the function (write-before-advance, Requirements
 *    4.1, 11.2).
 * 3. **On replay — returns the recorded outcome.** To resume an interrupted run
 *    the runtime re-invokes the function from the top; the Journal returns the
 *    recorded outcome for each already-settled `seq` **without re-executing the
 *    effect** (Requirements 4.3, 13.2, 20.3). A `completed` activity is never
 *    invoked again.
 * 4. **Surfaces a {@link ResumeIntegrityError}** when a `completed` command's
 *    recorded result is missing, or when the replayed function issues a command
 *    of a different `kind` than the journal recorded (a non-determinism guard);
 *    the run must then transition to `failed` without re-invoking the activity
 *    (Requirement 13.4).
 *
 * Because the durable `state` is loaded with the run (the Journal is constructed
 * over the persisted snapshot), `ctx.state` reads survive replay without
 * re-executing any `state.set` command (Requirement 19.4). All timestamps are
 * read from the injected {@link Clock}, so a run driven twice from the same
 * input, Clock, and activity results produces the same ordered History and the
 * same terminal Run_Status (Requirement 20.2).
 *
 * This module imports only the shared models from `./types.js`, the
 * {@link ResumeIntegrityError} from `./errors.js`, and the `Clock`/`systemClock`
 * primitives from `streetjs`; it depends on no sibling execution module, keeping
 * the dependency direction acyclic (leaf → types/errors, never the reverse).
 *
 * _Requirements: 4.1, 4.3, 11.2, 13.2, 19.4, 20.2, 20.3_
 */

import type { Clock } from "streetjs";
import { systemClock } from "streetjs";

import { ResumeIntegrityError } from "./errors.js";
import type {
  CommandKind,
  CommandRecord,
  HistoryEvent,
  RunStatus,
  SerializedError,
  WorkflowRun,
  WorkflowStore,
} from "./types.js";

// ── Error (de)serialization ─────────────────────────────────────────────────────

/**
 * Project an arbitrary thrown value into the JSON-safe {@link SerializedError}
 * recorded in the journal and History. Real `Error` instances preserve their
 * `name`, `message`, and `stack`; anything else is stringified generically.
 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return error.stack !== undefined
      ? { name: error.name, message: error.message, stack: error.stack }
      : { name: error.name, message: error.message };
  }
  return { name: "Error", message: String(error) };
}

/**
 * Reconstruct a throwable `Error` from a recorded {@link SerializedError} so a
 * previously `failed` command reproduces the same failure deterministically on
 * replay, and a terminally-failed live command unwinds the function normally.
 */
function deserializeError(error?: SerializedError): Error {
  const reconstructed = new Error(error?.message ?? "Workflow command failed.");
  if (error?.name !== undefined) {
    reconstructed.name = error.name;
  }
  if (error?.stack !== undefined) {
    reconstructed.stack = error.stack;
  }
  return reconstructed;
}

// ── Suspension signal ────────────────────────────────────────────────────────────

/**
 * Control-flow signal thrown by {@link Journal.process} when a command settles
 * as `waiting` (a timer, signal, or event wait). Throwing unwinds the imperative
 * `Workflow_Function` so the run can be parked; the runtime/coordinator catches
 * this to persist the wait and suspend, then re-drives the function on resume so
 * the same `seq` is re-evaluated (design "Command Journaling Sequence").
 *
 * It is intentionally **not** an `Error` subclass: it is normal control flow, not
 * a failure, and must never be mistaken for a workflow error by `catch` blocks
 * inside a `Workflow_Function`. Use {@link WorkflowSuspension.is} to detect it.
 */
export class WorkflowSuspension {
  /** The journaled sequence number of the command that parked the run. */
  readonly seq: number;
  /** The kind of command that parked the run. */
  readonly kind: CommandKind;
  /** The signal/event name being awaited, when the wait is signal/event based. */
  readonly waitingFor: string | undefined;
  /** Absolute Timer expiry (Clock epoch ms), when the wait is timer based. */
  readonly timerExpiresAt: number | undefined;

  constructor(
    seq: number,
    kind: CommandKind,
    waitingFor?: string,
    timerExpiresAt?: number,
  ) {
    this.seq = seq;
    this.kind = kind;
    this.waitingFor = waitingFor;
    this.timerExpiresAt = timerExpiresAt;
  }

  /** Narrowing guard: `true` when `value` is a {@link WorkflowSuspension}. */
  static is(value: unknown): value is WorkflowSuspension {
    return value instanceof WorkflowSuspension;
  }
}

// ── Command outcomes ─────────────────────────────────────────────────────────────

/** Fields shared by every {@link CommandOutcome}. */
interface OutcomeBase {
  /** Consumed attempt count; defaults to 1 for settled commands, 0 for waits. */
  readonly attempts?: number;
  /** History events to append atomically with the command record. */
  readonly history?: readonly HistoryEvent[];
  /** Optional run-level Run_Status transition to persist with this command. */
  readonly runStatus?: RunStatus;
  /** Durable per-run state to merge into the run (used by `state.set`). */
  readonly statePatch?: Record<string, unknown>;
  /** Extra {@link CommandRecord} fields (e.g. `nextAttemptAt`, `compensated`). */
  readonly record?: Partial<CommandRecord>;
}

/** The effect completed and produced a (possibly `undefined`) recorded result. */
export interface CompletedOutcome extends OutcomeBase {
  readonly status: "completed";
  /** The recorded result, reused verbatim on replay (Requirement 4.1). */
  readonly result: unknown;
}

/** The effect terminally failed; the recorded error is re-thrown on replay. */
export interface FailedOutcome extends OutcomeBase {
  readonly status: "failed";
  readonly error: SerializedError;
}

/** The effect parked the run; the function suspends via {@link WorkflowSuspension}. */
export interface WaitingOutcome extends OutcomeBase {
  readonly status: "waiting";
  /** Signal/event name awaited, when signal/event based (Requirement 17.2). */
  readonly waitingFor?: string;
  /** Absolute Timer expiry preserved across restart, when timer based (Req 9.5). */
  readonly timerExpiresAt?: number;
}

/** The outcome an effect thunk reports back to the Journal on a live execution. */
export type CommandOutcome = CompletedOutcome | FailedOutcome | WaitingOutcome;

/** Information handed to an effect thunk when it runs live (never on replay). */
export interface JournalExecuteInfo {
  /** The `seq` assigned to this command. */
  readonly seq: number;
  /** The Clock time captured immediately before the effect ran. */
  readonly now: number;
}

/** A single journaled command: its kind, metadata, and its live effect thunk. */
export interface JournalCommandSpec {
  /** The journaled command kind (purely local helpers never reach the Journal). */
  readonly kind: CommandKind;
  /** Metadata recorded with the command (Requirement 4.2). */
  readonly metadata?: Record<string, unknown>;
  /**
   * The effect to run on first execution. It is invoked **only** on a live
   * execution — never during replay of an already-settled command — and reports
   * the outcome the Journal records and persists.
   */
  readonly execute: (info: JournalExecuteInfo) => CommandOutcome | Promise<CommandOutcome>;
}

/** A run-level patch persisted through {@link Journal.commit} (write-before-advance). */
export interface RunPatch {
  readonly status?: RunStatus;
  readonly output?: unknown;
  readonly history?: readonly HistoryEvent[];
}

// ── Mutable record builder helper ────────────────────────────────────────────────

/** A structurally-mutable {@link CommandRecord} used while assembling a record. */
type MutableRecord = { -readonly [K in keyof CommandRecord]: CommandRecord[K] };

// ── The Journal ──────────────────────────────────────────────────────────────────

/** Options for constructing a {@link Journal} over a loaded run snapshot. */
export interface JournalOptions {
  /** The persisted run snapshot to drive; its `state` is already loaded (Req 19.4). */
  readonly run: WorkflowRun;
  /** The persistence store the journal writes through before advancing (Req 11.2). */
  readonly store: WorkflowStore;
  /** Injected Clock for all timestamps; defaults to {@link systemClock} (Req 20.1). */
  readonly clock?: Clock;
}

/**
 * The per-run Journal / Replay engine.
 *
 * Holds the authoritative in-memory {@link WorkflowRun} snapshot and a replay
 * cursor. {@link Journal.process} is the single entry point for every effectful
 * command: while the cursor still points at recorded, settled commands it
 * **replays** them (returning recorded results / re-throwing recorded errors
 * without re-executing); once the cursor reaches the interruption frontier it
 * **executes live**, records the outcome, and persists the run before returning.
 *
 * The Journal never mutates the run snapshot in place — every change rebuilds the
 * snapshot and is persisted through the store before the in-memory reference is
 * advanced — so a failed persistence leaves both the store and the journal on the
 * last successfully persisted state (Requirement 11.5, delegated to the store).
 */
export class Journal {
  /** The persistence store; the write-before-advance target (Requirement 11.2). */
  private readonly store: WorkflowStore;
  /** Injected Clock for deterministic timestamps (Requirements 20.1, 20.2). */
  private readonly clock: Clock;
  /** The authoritative, immutably-replaced run snapshot. */
  private current: WorkflowRun;
  /** Replay cursor: index of the next command position to process. */
  private cursor = 0;

  constructor(options: JournalOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    this.current = options.run;
  }

  /** The current authoritative run snapshot (durable source of truth). */
  get run(): WorkflowRun {
    return this.current;
  }

  /** The run identifier this journal drives. */
  get runId(): string {
    return this.current.runId;
  }

  /**
   * `true` while the cursor still points at recorded commands — i.e. the run is
   * being replayed toward its interruption frontier rather than executing live.
   */
  get replaying(): boolean {
    return this.cursor < this.current.commands.length;
  }

  /** The number of command positions processed so far in this drive. */
  get position(): number {
    return this.cursor;
  }

  /**
   * Run a purely local, deterministic helper **without journaling** it
   * (`ctx.if`/`switch`/`match`, logging, clock reads, metadata). Local commands
   * consume no `seq` and are reconstructed by re-execution during replay (design
   * step 1). Provided as the single, explicit place that documents the skip.
   */
  local<T>(fn: () => T): T {
    return fn();
  }

  /** Read a durable per-run state value; survives replay because state is loaded. */
  readState<T>(key: string): T | undefined {
    return this.current.state[key] as T | undefined;
  }

  /**
   * Write a durable per-run state value as a journaled `state.set` command
   * (Requirement 19.4). On replay the write is not re-applied — the loaded
   * snapshot already holds the persisted value — so `ctx.state` reads survive.
   */
  async setState<T>(key: string, value: T): Promise<void> {
    await this.process<void>({
      kind: "state.set",
      metadata: { key },
      execute: () => ({
        status: "completed",
        result: undefined,
        statePatch: { [key]: value },
      }),
    });
  }

  /**
   * Persist a run-level patch (Run_Status transition, terminal `output`, and/or
   * History events) through the same write-before-advance discipline, keeping the
   * Journal the single writer of the durable snapshot. Returns the persisted run.
   */
  async commit(patch: RunPatch): Promise<WorkflowRun> {
    const now = this.clock();
    const persisted: WorkflowRun = {
      ...this.current,
      status: patch.status ?? this.current.status,
      ...(patch.output !== undefined ? { output: patch.output } : {}),
      history:
        patch.history !== undefined
          ? [...this.current.history, ...patch.history]
          : this.current.history,
      updatedAt: now,
    };
    await this.store.save(persisted);
    this.current = persisted;
    return persisted;
  }

  /**
   * Process the next effectful command.
   *
   * - **Replay:** if a recorded, settled command sits at the current cursor,
   *   return its recorded result (`completed`) or re-throw its recorded error
   *   (`failed`) **without** invoking the effect (Requirements 4.3, 13.2, 20.3),
   *   after guarding determinism and result integrity (Requirement 13.4).
   * - **Live:** otherwise allocate the next `seq`, run the effect, record the
   *   outcome, and persist the run **before** returning control (Requirements
   *   4.1, 11.2). A `waiting` outcome persists the wait and throws a
   *   {@link WorkflowSuspension} so the function suspends.
   */
  async process<T>(spec: JournalCommandSpec): Promise<T> {
    const index = this.cursor;
    const recorded: CommandRecord | undefined = this.current.commands[index];

    // ── Replay path: a recorded, already-settled command at this position ──
    if (recorded !== undefined && recorded.status !== "waiting") {
      this.cursor = index + 1;

      if (recorded.kind !== spec.kind) {
        throw new ResumeIntegrityError(
          this.current.runId,
          `Workflow run "${this.current.runId}" replayed command #${index} as "${spec.kind}" but the journal recorded a "${recorded.kind}" at seq ${recorded.seq}; the workflow function is non-deterministic and cannot be resumed.`,
          { seq: recorded.seq },
        );
      }

      if (recorded.status === "completed") {
        // Requirement 13.4: a completed command missing its recorded result is a
        // journal-integrity violation; the run must fail without re-invoking it.
        if (!("result" in recorded)) {
          throw new ResumeIntegrityError(
            this.current.runId,
            `Workflow run "${this.current.runId}" cannot be resumed: completed command seq ${recorded.seq} ("${recorded.kind}") is missing its recorded result.`,
            { seq: recorded.seq },
          );
        }
        return recorded.result as T;
      }

      // recorded.status === "failed": reproduce the recorded failure verbatim.
      throw deserializeError(recorded.error);
    }

    // ── Live path: brand-new command, or re-running a previously parked wait ──
    // A recorded `waiting` command is always the last one persisted (the function
    // suspended there), so it is re-evaluated live at its original `seq`.
    const reusing = recorded !== undefined; // implies recorded.status === "waiting"
    const seq = reusing ? recorded.seq : this.current.nextSeq;
    const startedAt = this.clock();
    const outcome = await spec.execute({ seq, now: startedAt });
    const settledAt = this.clock();

    const nextRecord = this.buildRecord(
      spec,
      seq,
      startedAt,
      settledAt,
      outcome,
      reusing ? recorded : undefined,
    );

    const commands = reusing
      ? this.current.commands.map((existing, i) => (i === index ? nextRecord : existing))
      : [...this.current.commands, nextRecord];
    const nextSeq = reusing ? this.current.nextSeq : this.current.nextSeq + 1;
    const state =
      outcome.statePatch !== undefined
        ? { ...this.current.state, ...outcome.statePatch }
        : this.current.state;

    const persisted: WorkflowRun = {
      ...this.current,
      status: outcome.runStatus ?? this.current.status,
      commands,
      nextSeq,
      state,
      history:
        outcome.history !== undefined
          ? [...this.current.history, ...outcome.history]
          : this.current.history,
      updatedAt: settledAt,
    };

    // Write-before-advance: durably persist the full snapshot BEFORE returning
    // control to the function (Requirements 4.1, 11.2, 20.3).
    await this.store.save(persisted);
    this.current = persisted;

    if (outcome.status === "completed") {
      this.cursor = index + 1;
      return outcome.result as T;
    }
    if (outcome.status === "failed") {
      this.cursor = index + 1;
      throw deserializeError(outcome.error);
    }

    // waiting: leave the cursor on this command so a later resume re-runs it.
    this.cursor = index;
    throw new WorkflowSuspension(seq, spec.kind, outcome.waitingFor, outcome.timerExpiresAt);
  }

  /**
   * Assemble the durable {@link CommandRecord} for a live outcome, preserving the
   * original `startedAt`/`metadata`/attempt count when re-recording a previously
   * parked wait at the same `seq`.
   */
  private buildRecord(
    spec: JournalCommandSpec,
    seq: number,
    startedAt: number,
    settledAt: number,
    outcome: CommandOutcome,
    previous: CommandRecord | undefined,
  ): CommandRecord {
    const attempts =
      outcome.attempts ??
      (outcome.status === "waiting" ? (previous?.attempts ?? 0) : 1);

    const record: MutableRecord = {
      seq,
      kind: spec.kind,
      status: outcome.status,
      attempts,
    };

    const metadata = spec.metadata ?? previous?.metadata;
    if (metadata !== undefined) {
      record.metadata = metadata;
    }
    record.startedAt = previous?.startedAt ?? startedAt;

    if (outcome.status === "completed") {
      // Always assign `result` (even when `undefined`) so the key is present and
      // the replay integrity check (Requirement 13.4) can distinguish "recorded
      // undefined" from "missing".
      record.result = outcome.result;
      record.completedAt = settledAt;
    } else if (outcome.status === "failed") {
      record.error = outcome.error;
      record.completedAt = settledAt;
    } else {
      if (outcome.waitingFor !== undefined) {
        record.waitingFor = outcome.waitingFor;
      }
      if (outcome.timerExpiresAt !== undefined) {
        record.timerExpiresAt = outcome.timerExpiresAt;
      }
    }

    if (outcome.record !== undefined) {
      Object.assign(record, outcome.record);
    }

    return record;
  }
}
