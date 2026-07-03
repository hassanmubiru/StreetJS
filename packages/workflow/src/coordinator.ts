/**
 * @streetjs/workflow — the Signal + Timer Coordinator.
 *
 * This module implements the **waiting-run** machinery (Requirements 9, 14.1,
 * 17.2). A `Workflow_Function` parks when it awaits a timer
 * (`ctx.sleep`/`waitUntil`/`cron`/`interval`) or a signal/event
 * (`ctx.events.waitFor` / a delivered signal): the effectful command settles as
 * `waiting`, the wait is persisted (including the **absolute** `timerExpiresAt`),
 * and the function suspends by throwing a {@link WorkflowSuspension} (design
 * "Waiting"). The {@link SignalTimerCoordinator} is the authority that decides
 * when a parked run may continue and resumes it **exactly once** — when its timer
 * expires measured on the injected {@link Clock}, or when a matching signal/event
 * is delivered (Requirement 26.6).
 *
 * The coordinator provides the primitives the `ctx` surface (task 8) and the
 * Runtime (task 13) route waits through:
 *
 * - **Timer decisions** ({@link SignalTimerCoordinator.evaluateSleep},
 *   {@link SignalTimerCoordinator.evaluateWaitUntil},
 *   {@link SignalTimerCoordinator.evaluateTimer}): a zero/negative/past duration
 *   or a non-future absolute time is *already expired*, so the run continues
 *   **without** entering `waiting` (Requirement 9.6); otherwise the absolute
 *   expiry is returned so the wait can be persisted.
 * - **A journaled timer outcome** ({@link SignalTimerCoordinator.timerOutcome}):
 *   the {@link CommandOutcome} a timer command reports to the Journal — either an
 *   immediate `completed` (expired) or a `waiting` outcome carrying the absolute
 *   `timerExpiresAt`, which the Journal persists on the {@link CommandRecord} so
 *   the expiry survives a process restart (Requirement 9.5).
 * - **Parking** ({@link SignalTimerCoordinator.park}): durably records a run as
 *   `waiting` on a timer or signal/event wait.
 * - **Signal delivery** ({@link SignalTimerCoordinator.deliverSignal}): buffers a
 *   delivered signal into the run's `pendingSignals` (recording a
 *   `signal.received` History event) and, when the run is currently waiting for
 *   that name, resumes it exactly once. A signal delivered before its `waitFor`
 *   is simply left buffered so a later `waitFor` consumes it without entering
 *   `waiting` (Requirement 17.2).
 * - **Consumption** ({@link SignalTimerCoordinator.tryConsumePending}): consumes a
 *   buffered signal for a `waitFor`, marking it `consumed` so it is taken exactly
 *   once.
 * - **Timer expiry** ({@link SignalTimerCoordinator.resumeDueTimers}): resumes
 *   every parked run whose absolute timer expiry is at or before the current
 *   Clock time, exactly once each — reading the absolute expiry from the durable
 *   record so it is preserved across a restart (Requirements 9.5, 26.7).
 * - **Cancellation** ({@link SignalTimerCoordinator.abort}): aborts the
 *   `AbortSignal` of any in-flight activity of a run (Requirement 14.1); a
 *   cancelled (terminal) run is thereafter skipped by delivery and timer
 *   resumption, so it never silently resumes.
 *
 * Resume-exactly-once is enforced by an in-process guard keyed by the run id and
 * the parked command's `seq`: a given wait resumes at most once no matter how
 * many timer checks or duplicate signal deliveries occur (Requirement 26.6). The
 * durable wait itself lives on the persisted {@link CommandRecord}, so the guard
 * only needs to dedupe within the running process.
 *
 * This module imports only the shared models from `./types.js`, the
 * {@link WorkflowSuspension} control-flow signal and {@link CommandOutcome} shape
 * from `./journal.js`, and the `Clock`/`systemClock` primitives from `streetjs`;
 * it depends on no other sibling execution module, keeping the dependency
 * direction acyclic.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 14.1, 17.2_
 */

import type { Clock } from "streetjs";
import { systemClock } from "streetjs";

import type { CommandOutcome } from "./journal.js";
import { WorkflowSuspension } from "./journal.js";
import type {
  CommandKind,
  CommandRecord,
  RecordedSignal,
  WorkflowRun,
  WorkflowStore,
} from "./types.js";
import { TERMINAL } from "./types.js";

// ── Public result/parameter shapes ───────────────────────────────────────────────

/**
 * The decision for a timer wait. `expired` is `true` when the timer is already
 * due (a zero/negative/past sleep or a non-future `waitUntil`), meaning the run
 * continues immediately **without** entering `waiting` (Requirement 9.6);
 * otherwise the run parks until `expiresAt` is reached on the Clock.
 */
export interface TimerDecision {
  /** `true` when the timer is already due and the run should continue at once. */
  readonly expired: boolean;
  /** The absolute expiry (Clock epoch ms) recorded when the run parks (Req 9.5). */
  readonly expiresAt: number;
}

/** A wait to park a run on: a timer with an absolute expiry, or a named signal/event. */
export type WaitSpec =
  | {
      readonly type: "timer";
      /** The journaled kind that issued the wait (e.g. `sleep`, `waitUntil`). */
      readonly kind: CommandKind;
      /** The journaled sequence number of the parking command. */
      readonly seq: number;
      /** Absolute Timer expiry (Clock epoch ms), preserved across restart (Req 9.5). */
      readonly expiresAt: number;
    }
  | {
      readonly type: "signal";
      /** The journaled kind that issued the wait (e.g. `events.waitFor`). */
      readonly kind: CommandKind;
      /** The journaled sequence number of the parking command. */
      readonly seq: number;
      /** The signal/event name being awaited (Requirement 17.2). */
      readonly name: string;
    };

/** What happened when a signal/event was delivered to a run. */
export type SignalDeliveryOutcome =
  /** The run was waiting for this name; it was resumed (exactly once). */
  | "resumed"
  /** No matching active wait; the signal was buffered for a later `waitFor`. */
  | "buffered"
  /** The run is unknown or terminal (e.g. cancelled/completed); nothing happened. */
  | "ignored";

/** The result of {@link SignalTimerCoordinator.deliverSignal}. */
export interface SignalDeliveryResult {
  readonly outcome: SignalDeliveryOutcome;
  /** The persisted run after buffering the signal, or `null` for an unknown run. */
  readonly run: WorkflowRun | null;
  /** A human-readable reason when the delivery was `ignored`. */
  readonly reason?: string;
}

/** The result of {@link SignalTimerCoordinator.tryConsumePending}. */
export interface PendingConsumption {
  /** `true` when a buffered matching signal was found and consumed. */
  readonly consumed: boolean;
  /** The consumed signal's payload, present only when `consumed` is `true`. */
  readonly payload?: unknown;
  /** The run snapshot: updated (signal marked consumed) when `consumed`, else unchanged. */
  readonly run: WorkflowRun;
}

/** A timer that has fired: the run it belongs to, its command `seq`, and its expiry. */
export interface TimerFiring {
  readonly runId: string;
  readonly seq: number;
  readonly expiresAt: number;
}

/** Construction inputs for a {@link SignalTimerCoordinator}. */
export interface SignalTimerCoordinatorOptions {
  /** The persistence contract; every durable wait/delivery is saved through it. */
  readonly store: WorkflowStore;
  /** Injected Clock for every timer decision and timestamp; defaults to {@link systemClock}. */
  readonly clock?: Clock;
  /**
   * Invoked with a run id when a parked run becomes eligible to continue (its
   * timer expired or its awaited signal arrived). The Runtime (task 13) wires
   * this to re-drive the replay; when omitted the coordinator still performs all
   * durable bookkeeping and reports what would have resumed.
   */
  readonly onResume?: (runId: string) => void | Promise<void>;
}

// ── The coordinator ──────────────────────────────────────────────────────────────

/**
 * Coordinates parking and resumption of `waiting` Workflow_Runs (Requirements 9,
 * 14.1, 17.2).
 *
 * A single coordinator is shared by the engine across all runs. It owns three
 * concerns: (1) deciding whether a timer is already due and building the
 * journaled outcome for a timer command; (2) delivering and buffering signals and
 * consuming them for `waitFor`; and (3) resuming parked runs **exactly once**
 * when a timer expires on the Clock or a matching signal is delivered. It also
 * tracks in-flight activity {@link AbortController}s so a cancellation can abort
 * them (Requirement 14.1).
 */
export class SignalTimerCoordinator {
  private readonly store: WorkflowStore;
  private readonly clock: Clock;
  private readonly onResume?: (runId: string) => void | Promise<void>;

  /**
   * Resume-exactly-once guard: the set of `${runId}:${seq}` wait tokens that have
   * already been resumed. A given parked wait resumes at most once regardless of
   * how many timer checks or duplicate signal deliveries occur (Requirement 26.6).
   */
  private readonly resumed = new Set<string>();

  /** In-flight activity abort controllers, keyed by run id (Requirement 14.1). */
  private readonly controllers = new Map<string, Set<AbortController>>();

  constructor(options: SignalTimerCoordinatorOptions) {
    this.store = options.store;
    this.clock = options.clock ?? systemClock;
    if (options.onResume !== undefined) {
      this.onResume = options.onResume;
    }
  }

  /** The current Clock time (epoch ms). All timer math flows through this. */
  now(): number {
    return this.clock();
  }

  // ── Timer decisions (Requirements 9.1, 9.2, 9.5, 9.6) ──────────────────────────

  /**
   * Decide a `ctx.sleep(durationMs)` wait. A duration that is **not later** than
   * now (zero, negative, or past) is already `expired`, so the run continues
   * without entering `waiting` (Requirement 9.6); otherwise the absolute expiry
   * is `now + durationMs` (Requirement 9.1).
   */
  evaluateSleep(durationMs: number): TimerDecision {
    const now = this.clock();
    return { expired: durationMs <= 0, expiresAt: now + durationMs };
  }

  /**
   * Decide a `ctx.waitUntil(atEpochMs)` wait. An absolute time that is **not
   * later** than now is already `expired`, so the run continues without entering
   * `waiting` (Requirement 9.6); otherwise the run parks until `atEpochMs`
   * (Requirement 9.2).
   */
  evaluateWaitUntil(atEpochMs: number): TimerDecision {
    const now = this.clock();
    return { expired: atEpochMs <= now, expiresAt: atEpochMs };
  }

  /**
   * Decide an arbitrary timer given its **absolute** expiry (Clock epoch ms). The
   * timer is `expired` when its expiry is at or before now. Because the expiry is
   * absolute, this yields the correct decision even after a process restart
   * (Requirement 9.5).
   */
  evaluateTimer(expiresAt: number): TimerDecision {
    return { expired: expiresAt <= this.clock(), expiresAt };
  }

  /** `true` when a timer with the given absolute expiry is due at the current Clock time. */
  isTimerExpired(expiresAt: number): boolean {
    return expiresAt <= this.clock();
  }

  /**
   * Build the journaled {@link CommandOutcome} for a timer command, to be routed
   * through the Journal by the `ctx` surface / Runtime.
   *
   * - **Already expired** (`expiresAt <= now`): a `completed` outcome so the run
   *   continues immediately, with a `timer.fired` History event (Requirement 9.6).
   * - **Not yet due**: a `waiting` outcome carrying the absolute `timerExpiresAt`
   *   and a `waiting` Run_Status transition, with a `timer.set` History event. The
   *   Journal records `timerExpiresAt` on the {@link CommandRecord}, preserving
   *   the absolute expiry across a restart (Requirements 9.1, 9.5).
   */
  timerOutcome(params: { readonly seq: number; readonly now: number; readonly expiresAt: number }): CommandOutcome {
    const { seq, now, expiresAt } = params;
    if (expiresAt <= now) {
      return {
        status: "completed",
        result: undefined,
        history: [{ type: "timer.fired", at: now, seq }],
      };
    }
    return {
      status: "waiting",
      timerExpiresAt: expiresAt,
      runStatus: "waiting",
      history: [{ type: "timer.set", at: now, seq, expiresAt }],
    };
  }

  /**
   * Construct the {@link WorkflowSuspension} control-flow signal for a wait so the
   * Runtime can unwind and park the function consistently with the Journal's own
   * `waiting`-outcome path (design "Waiting").
   */
  toSuspension(wait: WaitSpec): WorkflowSuspension {
    return wait.type === "timer"
      ? new WorkflowSuspension(wait.seq, wait.kind, undefined, wait.expiresAt)
      : new WorkflowSuspension(wait.seq, wait.kind, wait.name, undefined);
  }

  // ── Parking (Requirements 9.1, 9.2, 17.2) ──────────────────────────────────────

  /**
   * Durably park a run as `waiting` on the given {@link WaitSpec}.
   *
   * The parking command (identified by `seq`) is recorded/updated as `waiting`
   * carrying the absolute `timerExpiresAt` (timer) or `waitingFor` name (signal),
   * the Run_Status is set to `waiting`, a `timer.set` History event is appended
   * for timer waits, and the snapshot is persisted through the store. The
   * returned snapshot is the durable source of truth the caller should thread
   * forward.
   */
  async park(run: WorkflowRun, wait: WaitSpec): Promise<WorkflowRun> {
    const now = this.clock();
    const hasCommand = run.commands.some((command) => command.seq === wait.seq);

    const patch = (command: CommandRecord): CommandRecord =>
      wait.type === "timer"
        ? { ...command, status: "waiting", timerExpiresAt: wait.expiresAt }
        : { ...command, status: "waiting", waitingFor: wait.name };

    const newRecord: CommandRecord =
      wait.type === "timer"
        ? { seq: wait.seq, kind: wait.kind, status: "waiting", attempts: 0, timerExpiresAt: wait.expiresAt }
        : { seq: wait.seq, kind: wait.kind, status: "waiting", attempts: 0, waitingFor: wait.name };

    const commands = hasCommand
      ? run.commands.map((command) => (command.seq === wait.seq ? patch(command) : command))
      : [...run.commands, newRecord];

    const history =
      wait.type === "timer"
        ? [...run.history, { type: "timer.set" as const, at: now, seq: wait.seq, expiresAt: wait.expiresAt }]
        : run.history;

    const parked: WorkflowRun = {
      ...run,
      status: "waiting",
      commands,
      nextSeq: hasCommand ? run.nextSeq : Math.max(run.nextSeq, wait.seq + 1),
      history,
      updatedAt: now,
    };

    await this.store.save(parked);
    return parked;
  }

  // ── Signal delivery & consumption (Requirements 17.2, 9.3, 9.4) ─────────────────

  /**
   * Deliver a signal/event to a run.
   *
   * The signal is always recorded into the run's `pendingSignals` (unconsumed)
   * with a `signal.received` History event and persisted. Then:
   *
   * - If the run is currently `waiting` for a signal of this `name`, the run is
   *   resumed **exactly once** (`outcome: "resumed"`); on resume its `waitFor`
   *   replays and consumes the buffered signal via {@link tryConsumePending}.
   * - Otherwise the signal remains buffered (`outcome: "buffered"`) so a later
   *   `waitFor` consumes it without the run ever entering `waiting`
   *   (Requirement 17.2).
   * - An unknown or terminal (e.g. `cancelled`) run is left untouched
   *   (`outcome: "ignored"`), so a cancelled run never silently resumes.
   */
  async deliverSignal(runId: string, name: string, payload: unknown): Promise<SignalDeliveryResult> {
    const loaded = await this.store.load(runId);
    if (loaded === null) {
      return { outcome: "ignored", run: null, reason: `no workflow run "${runId}" is persisted` };
    }
    if (TERMINAL.includes(loaded.status)) {
      return { outcome: "ignored", run: loaded, reason: `run "${runId}" is ${loaded.status}` };
    }

    const now = this.clock();
    const recorded: RecordedSignal = { name, payload, receivedAt: now, consumed: false };
    const updated: WorkflowRun = {
      ...loaded,
      pendingSignals: [...loaded.pendingSignals, recorded],
      history: [...loaded.history, { type: "signal.received", at: now, name, payload }],
      updatedAt: now,
    };
    await this.store.save(updated);

    const wait = this.activeWait(updated);
    if (updated.status === "waiting" && wait !== undefined && wait.waitingFor === name) {
      const resumed = await this.resume(runId, wait.seq);
      return resumed
        ? { outcome: "resumed", run: updated }
        : { outcome: "ignored", run: updated, reason: `wait for "${name}" was already resumed` };
    }
    return { outcome: "buffered", run: updated };
  }

  /**
   * Consume a buffered signal for a `ctx.events.waitFor(name)` command.
   *
   * When an unconsumed signal of `name` is already buffered, it is marked
   * `consumed`, the snapshot is persisted, and its payload is returned so the
   * command completes immediately **without** entering `waiting` (Requirement
   * 17.2). When none is buffered, the run is returned unchanged and the caller
   * parks the run to await delivery.
   */
  async tryConsumePending(run: WorkflowRun, name: string): Promise<PendingConsumption> {
    const index = run.pendingSignals.findIndex((signal) => signal.name === name && !signal.consumed);
    if (index < 0) {
      return { consumed: false, run };
    }
    const signal = run.pendingSignals[index] as RecordedSignal;
    const updated: WorkflowRun = {
      ...run,
      pendingSignals: run.pendingSignals.map((existing, i) =>
        i === index ? { ...existing, consumed: true } : existing,
      ),
      updatedAt: this.clock(),
    };
    await this.store.save(updated);
    return { consumed: true, payload: signal.payload, run: updated };
  }

  // ── Timer expiry & resumption (Requirements 9.5, 26.6, 26.7) ────────────────────

  /**
   * The active wait of a run, if any: the most recent command still in the
   * `waiting` state. The imperative function suspends at exactly one wait at a
   * time, so this identifies the wait the run is currently parked on.
   */
  activeWait(run: WorkflowRun): CommandRecord | undefined {
    for (let i = run.commands.length - 1; i >= 0; i -= 1) {
      const command = run.commands[i];
      if (command !== undefined && command.status === "waiting") {
        return command;
      }
    }
    return undefined;
  }

  /**
   * The absolute expiry of the run's active timer wait, or `undefined` when the
   * run is not parked on a timer. The value is read from the durable
   * {@link CommandRecord}, so it is the **original** absolute expiry preserved
   * across a process restart (Requirement 9.5).
   */
  preservedExpiry(run: WorkflowRun): number | undefined {
    return this.activeWait(run)?.timerExpiresAt;
  }

  /**
   * The {@link TimerFiring} for a run whose active timer is due at the current
   * Clock time, or `null` when the run is not parked on a timer or the timer has
   * not yet expired.
   */
  dueTimer(run: WorkflowRun): TimerFiring | null {
    const wait = this.activeWait(run);
    if (wait === undefined || wait.timerExpiresAt === undefined) {
      return null;
    }
    if (wait.timerExpiresAt <= this.clock()) {
      return { runId: run.runId, seq: wait.seq, expiresAt: wait.timerExpiresAt };
    }
    return null;
  }

  /**
   * Resume every parked run whose absolute timer expiry is at or before the
   * current Clock time, **exactly once each** (Requirement 26.6).
   *
   * When `runs` is omitted the coordinator scans `store.listIncomplete()`, so it
   * naturally skips terminal (including `cancelled`) runs. Because each firing is
   * decided from the durable absolute expiry, relative firing order is preserved
   * across a restart (Requirement 26.7). Returns the firings that actually
   * triggered a resume, in scan order.
   */
  async resumeDueTimers(runs?: readonly WorkflowRun[]): Promise<readonly TimerFiring[]> {
    const candidates = runs ?? (await this.store.listIncomplete());
    const fired: TimerFiring[] = [];
    for (const run of candidates) {
      if (run.status !== "waiting" || TERMINAL.includes(run.status)) {
        continue;
      }
      const due = this.dueTimer(run);
      if (due === null) {
        continue;
      }
      if (await this.resume(due.runId, due.seq)) {
        fired.push(due);
      }
    }
    return fired;
  }

  /**
   * Resume the wait identified by `runId` and its parked command `seq`,
   * **exactly once**. Returns `true` when this call performed the resume and
   * `false` when the same wait had already been resumed (a duplicate timer check
   * or signal delivery), enforcing the resume-exactly-once guarantee
   * (Requirement 26.6). On the first call the injected `onResume` callback, if
   * any, is invoked to re-drive the run.
   */
  async resume(runId: string, seq: number): Promise<boolean> {
    const token = SignalTimerCoordinator.token(runId, seq);
    if (this.resumed.has(token)) {
      return false;
    }
    this.resumed.add(token);
    if (this.onResume !== undefined) {
      await this.onResume(runId);
    }
    return true;
  }

  /** `true` when the wait identified by `runId`/`seq` has already been resumed. */
  hasResumed(runId: string, seq: number): boolean {
    return this.resumed.has(SignalTimerCoordinator.token(runId, seq));
  }

  private static token(runId: string, seq: number): string {
    return `${runId}:${seq}`;
  }

  // ── Cancellation / abort wiring (Requirement 14.1) ──────────────────────────────

  /**
   * Create a fresh {@link AbortSignal} for an in-flight activity of `runId` and
   * register its controller so a later {@link abort} can cancel the activity
   * (Requirement 14.1). The Activity Executor (task 9) uses this to obtain the
   * signal it threads into an activity invocation.
   */
  createAbortSignal(runId: string): AbortSignal {
    const controller = new AbortController();
    this.registerAbort(runId, controller);
    return controller.signal;
  }

  /** Register an externally-owned {@link AbortController} for an in-flight activity. */
  registerAbort(runId: string, controller: AbortController): void {
    let set = this.controllers.get(runId);
    if (set === undefined) {
      set = new Set<AbortController>();
      this.controllers.set(runId, set);
    }
    set.add(controller);
  }

  /** Stop tracking a controller once its activity settles, so it can be collected. */
  releaseAbort(runId: string, controller: AbortController): void {
    const set = this.controllers.get(runId);
    if (set === undefined) {
      return;
    }
    set.delete(controller);
    if (set.size === 0) {
      this.controllers.delete(runId);
    }
  }

  /**
   * Abort the {@link AbortSignal} of every in-flight activity of `runId` on
   * cancellation (Requirement 14.1), then stop tracking them. Safe to call for a
   * run with no in-flight activity.
   */
  abort(runId: string): void {
    const set = this.controllers.get(runId);
    if (set === undefined) {
      return;
    }
    for (const controller of set) {
      controller.abort();
    }
    this.controllers.delete(runId);
  }
}

/**
 * Convenience factory mirroring {@link SignalTimerCoordinator}'s constructor for
 * callers that prefer a functional construction style.
 */
export function createSignalTimerCoordinator(
  options: SignalTimerCoordinatorOptions,
): SignalTimerCoordinator {
  return new SignalTimerCoordinator(options);
}
