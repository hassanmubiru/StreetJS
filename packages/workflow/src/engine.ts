/**
 * @streetjs/workflow — the WorkflowEngine facade and lifecycle.
 *
 * {@link createWorkflow} is the single public entry point of the package
 * (Requirement 1.1). It resolves the configured {@link WorkflowStore} (defaulting
 * to the zero-dependency {@link MemoryWorkflowStore} — Requirement 1.2), the
 * injected {@link Clock} (defaulting to {@link systemClock} — Requirement 20.1),
 * and an injectable `rng` for jitter backoff, then wires the durable machinery:
 * one shared {@link SignalTimerCoordinator}, one shared {@link ActivityExecutor}
 * (whose per-run cancellation `AbortSignal` is minted by the coordinator), and
 * one {@link WorkflowRuntime} that drives the imperative Workflow_Function through
 * the Journal, Executor, Compensator, and Coordinator.
 *
 * The returned {@link WorkflowEngine} exposes the full lifecycle surface
 * (Requirements 1, 2, 3.2, 3.3, 14):
 *
 * - `define` registers a named Workflow_Function; a duplicate name raises a
 *   {@link RegistrationError} and the prior definition is retained (Req 1.3, 1.4).
 * - `run` starts a run of a registered definition with a unique `runId`, sets it
 *   `running`, persists `run.started`, and drives it through the Runtime,
 *   returning a typed {@link WorkflowHandle}; an unregistered name raises a
 *   {@link WorkflowNotFoundError} and **no** run is created (Req 1.5, 2.1, 20.4).
 * - `resume` continues a non-terminal run from its last persisted state via
 *   replay; a `cancelled` run raises a {@link CancelledResumeError} and invokes no
 *   activity (Req 2.2, 14.3).
 * - `pause`/`cancel` transition and persist the Run_Status; `cancel` aborts any
 *   in-flight activity `AbortSignal` through the coordinator (Req 2.3, 2.4, 14).
 * - `restart` starts a fresh run of the same definition with a new `runId`
 *   (Req 2.5).
 * - `status`/`list`/`history`/`definitions`/`signal`/`stats`/`close` complete the
 *   operator surface (Req 2.6, 2.7, 2.8).
 *
 * **Resume after restart (Req 13, 14.4).** Constructing an engine over a store
 * that already holds non-terminal runs must resume them (Req 13.1) — but a
 * definition is registered through {@link WorkflowEngine.define} *after*
 * construction, so auto-resume cannot happen purely in the constructor. It is
 * therefore driven **when a definition is registered**: each time `define(name,
 * fn)` succeeds, the engine (when `config.autoResume` is not disabled) scans
 * `store.listIncomplete()` and re-drives every incomplete run of that definition.
 * Because {@link WorkflowStore.listIncomplete} already excludes every terminal
 * Run_Status — and `cancelled` is terminal ({@link TERMINAL}) — a `cancelled` run
 * is never returned and never resumed; {@link driveExisting} additionally guards
 * terminal/`paused` runs, so cancellation stays sticky (Req 14.4). Resume itself
 * re-invokes the function from the top: the {@link Journal} returns each
 * already-`completed` command's recorded outcome without re-executing it (Req
 * 13.2), execution continues live from the earliest non-terminal command (Req
 * 13.3), and a `completed` command whose recorded result is missing surfaces a
 * {@link ResumeIntegrityError} through the runtime, which finalizes the run as
 * `failed` without re-invoking the activity (Req 13.4). Absolute Timer expiry is
 * preserved across restart by the persisted `CommandRecord`/Coordinator (Req 9.5).
 * Scheduled resumptions are tracked so the read/lifecycle operations and `close`
 * can settle them deterministically.
 *
 * **Bridge wiring and lifecycle broadcast (Req 15–18).** The four structural
 * pillar bridges (`storage`/`queue`/`events`/`realtime`) are threaded from
 * `config.bridges` into the {@link WorkflowRuntime}, which builds each `ctx.*`
 * surface through the `integrations/*` factories (Req 15.1, 16.1, 16.2, 17.1,
 * 18.1); an operation on an unwired bridge raises a {@link WorkflowConfigError}
 * from those factories, while a workflow that never touches a bridge runs
 * unchanged (Req 15.3, 18.4). The engine additionally holds a
 * {@link WorkflowRealtimeBridge} built from `config.bridges?.realtime` and
 * broadcasts run-lifecycle events on transitions: `workflow.started` on run
 * start, `workflow.progress` when a drive parks `waiting`, `workflow.completed`
 * on completion, `workflow.failed` on a failed/compensated terminal, and
 * `workflow.cancelled` on cancel (Req 18.2). Broadcasts are best-effort — the
 * bridge swallows failures so they never propagate into the engine.
 *
 * _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8,
 * 3.2, 3.3, 9.5, 13.1, 13.2, 13.3, 13.4, 14.1, 14.2, 14.4, 20.4_
 */

import { randomUUID } from "node:crypto";

import type { Clock } from "streetjs";
import { systemClock } from "streetjs";

import { SignalTimerCoordinator } from "./coordinator.js";
import {
  CancelledResumeError,
  RegistrationError,
  WorkflowError,
  WorkflowNotFoundError,
} from "./errors.js";
import { ActivityExecutor } from "./executor.js";
import type {
  WorkflowLifecycleEvent,
  WorkflowRealtimeBridge,
} from "./integrations/realtime.js";
import { bridgeWorkflowRealtime } from "./integrations/realtime.js";
import type { WorkflowObservabilityHandle } from "./observability.js";
import { registerWorkflowObservability } from "./observability.js";
import type { RuntimeBridges } from "./runtime.js";
import { WorkflowRuntime } from "./runtime.js";
import { MemoryWorkflowStore } from "./store.js";
import type {
  HistoryEvent,
  RunOptions,
  RunStatus,
  StoreProbe,
  WorkflowConfig,
  WorkflowFunction,
  WorkflowHandle,
  WorkflowRun,
  WorkflowStats,
  WorkflowStore,
  WorkflowSummary,
} from "./types.js";
import { TERMINAL } from "./types.js";

// ── Public facade contract ───────────────────────────────────────────────────────

/**
 * The strongly typed public API returned by {@link createWorkflow}.
 *
 * A single engine instance owns the definition registry, the durable machinery,
 * and every lifecycle operation. Its behavior is identical no matter which
 * {@link WorkflowStore} backs it (design "Design Goals").
 */
export interface WorkflowEngine {
  /** Register a named Workflow_Function; duplicate name → {@link RegistrationError}, prior kept (Req 1.3, 1.4). */
  define<I, O>(name: string, fn: WorkflowFunction<I, O>): void;

  /** Start a run of a registered definition with typed input (Req 1.5, 2.1, 20.4). */
  run<I, O>(name: string, input: I, options?: RunOptions): Promise<WorkflowHandle<O>>;

  /** Continue a non-terminal run from its last persisted state via replay (Req 2.2, 14). */
  resume(runId: string): Promise<WorkflowHandle<unknown>>;

  /** Pause a running run; no further commands run until resume (Req 2.3). */
  pause(runId: string): Promise<void>;

  /** Cancel a non-terminal run; aborts in-flight activities; never auto-resumes (Req 2.4, 14). */
  cancel(runId: string): Promise<void>;

  /** Start a new run of the same definition with a new runId (Req 2.5). */
  restart(runId: string): Promise<WorkflowHandle<unknown>>;

  /** Current Run_Status of a run, or `null` when unknown (Req 2.6). */
  status(runId: string): Promise<RunStatus | null>;

  /** runId + Run_Status of every recorded run (Req 2.7). */
  list(): Promise<readonly WorkflowSummary[]>;

  /** Ordered, append-only History of a run (Req 2.8). */
  history(runId: string): Promise<readonly HistoryEvent[]>;

  /** Deliver a named, typed Signal to a waiting run (Signal glossary; Req 26.6). */
  signal<P>(runId: string, name: string, payload: P): Promise<void>;

  /** Names of all registered definitions. */
  definitions(): readonly string[];

  /** Live metrics snapshot (best-effort, never throws). */
  stats(): WorkflowStats;

  /** Release engine resources. */
  close(): Promise<void>;
}

/** Re-export {@link WorkflowHandle} at the engine surface for convenience. */
export type { WorkflowHandle } from "./types.js";

// ── Internals ─────────────────────────────────────────────────────────────────────

/** A pending `result()` awaiter for a run that has not yet reached a terminal state. */
interface ResultWaiter {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * The concrete {@link WorkflowEngine} implementation. Instantiated only through
 * {@link createWorkflow}; not exported directly so the facade stays the single
 * construction path.
 */
class WorkflowEngineImpl implements WorkflowEngine {
  private readonly store: WorkflowStore;
  private readonly clock: Clock;
  private readonly rng: () => number;
  private readonly coordinator: SignalTimerCoordinator;
  private readonly executor: ActivityExecutor;
  private readonly runtime: WorkflowRuntime;

  /**
   * The Realtime bridge used to broadcast Workflow_Run lifecycle transitions
   * (`workflow.started`/`progress`/`completed`/`failed`/`cancelled`) carrying the
   * runId (Req 18.2). Built from `config.bridges?.realtime`; when no
   * {@link RealtimeLike} bridge is wired every `broadcastLifecycle` call is a
   * silent no-op so bridgeless runs proceed unchanged (Req 18.4). Broadcast
   * failures are swallowed inside the bridge and never propagate into the engine.
   */
  private readonly realtimeBridge: WorkflowRealtimeBridge;

  /** Whether non-terminal runs are auto-resumed as definitions register (Req 13.1, 14.4). */
  private readonly autoResume: boolean;

  /**
   * Observability wiring over the reused core `MetricsRegistry` /
   * `HealthCheckRegistry` primitives (Req 21.3, 21.5, 21.6). Registered
   * idempotently at construction; a no-op sink when neither registry is
   * configured (Req 21.4). The engine feeds it live on every transition and
   * refreshes its gauges from {@link stats}.
   */
  private readonly observability: WorkflowObservabilityHandle;

  /** Running total of consumed activity retries, for the {@link stats} snapshot. */
  private totalRetries = 0;

  /** Running total of executed activity compensations, for the {@link stats} snapshot. */
  private totalCompensations = 0;

  /** Last-observed cumulative retries per run, so counter increments are deltas only. */
  private readonly retriesByRun = new Map<string, number>();

  /** Last-observed cumulative compensations per run, so counter increments are deltas only. */
  private readonly compensationsByRun = new Map<string, number>();

  /** Registered Workflow_Functions by name (the Definition Registry). */
  private readonly registry = new Map<string, WorkflowFunction<unknown, unknown>>();

  /** Last-known Run_Status per run, for the synchronous {@link stats} snapshot. */
  private readonly statuses = new Map<string, RunStatus>();

  /** Pending `result()` awaiters keyed by runId, resolved when a run settles. */
  private readonly waiters = new Map<string, ResultWaiter[]>();

  /**
   * In-flight construction-time auto-resume drives, scheduled as definitions
   * register. Tracked so lifecycle reads and {@link close} can settle them
   * deterministically without leaking unhandled rejections (Req 13.1).
   */
  private readonly pendingResumes = new Set<Promise<void>>();

  /** runIds already scheduled for auto-resume, so no run is re-driven twice. */
  private readonly autoResumed = new Set<string>();

  constructor(config?: WorkflowConfig) {
    this.store = config?.store ?? new MemoryWorkflowStore();
    this.clock = config?.clock ?? systemClock;
    this.rng = config?.rng ?? Math.random;
    // Auto-resume defaults on (Req 13.1); an operator may opt out via config.
    this.autoResume = config?.autoResume ?? true;

    // One shared coordinator; its onResume re-drives a parked run when its timer
    // expires or its awaited signal/event is delivered (Req 9, 17.2).
    this.coordinator = new SignalTimerCoordinator({
      store: this.store,
      clock: this.clock,
      onResume: (runId) => this.driveExisting(runId),
    });

    // One shared executor; per-run cancellation AbortSignals are minted by the
    // coordinator so `cancel` aborts in-flight activities (Req 4.4, 14.1).
    this.executor = new ActivityExecutor({
      clock: this.clock,
      rng: this.rng,
      signalFor: (runId) => this.coordinator.createAbortSignal(runId),
    });

    // One runtime drives every run/resume through the shared machinery. The four
    // structural pillar bridges (storage/queue/events/realtime) are threaded from
    // `config.bridges` onto every run's `ctx` (Req 15.1, 16.1, 17.1, 18.1); the
    // integrations/* factories build each `ctx.*` surface and raise a
    // WorkflowConfigError when an unwired bridge is used, so a bridgeless workflow
    // that never touches a bridge runs unchanged (Req 15.3, 18.4). Queue dispatch
    // jobIds flow back through `ctx.queue.dispatch` unchanged (Req 16.2).
    const bridges: RuntimeBridges | undefined = config?.bridges;
    this.runtime = new WorkflowRuntime({
      store: this.store,
      coordinator: this.coordinator,
      executor: this.executor,
      clock: this.clock,
      ...(bridges !== undefined ? { bridges } : {}),
    });

    // The engine-facing Realtime lifecycle bridge. Built from the same
    // `config.bridges?.realtime` handed to the runtime so `ctx.realtime.broadcast`
    // and lifecycle broadcasts share one structural bridge. When no realtime
    // bridge is configured this is a wired-`false` no-op surface (Req 18.4).
    this.realtimeBridge = bridgeWorkflowRealtime(config?.bridges?.realtime);

    // Observability wiring: register metrics idempotently against the supplied
    // `MetricsRegistry` and a persistence-store health check against the supplied
    // `HealthCheckRegistry`, reusing only the core primitives (Req 21.3, 21.5,
    // 21.6). When neither is configured this is an inert no-op (Req 21.4). The
    // store probe is best-effort: a store without a `probe` reports available.
    this.observability = registerWorkflowObservability({
      ...(config?.metrics !== undefined ? { metrics: config.metrics } : {}),
      ...(config?.health !== undefined ? { health: config.health } : {}),
    });
    this.observability.attach({
      stats: () => this.stats(),
      probe: () => this.probeStore(),
    });
  }

  // ── Registration (Req 1.3, 1.4) ──────────────────────────────────────────────

  define<I, O>(name: string, fn: WorkflowFunction<I, O>): void {
    if (this.registry.has(name)) {
      // Duplicate name: retain the previously registered definition (Req 1.4).
      throw new RegistrationError(name);
    }
    this.registry.set(name, fn as unknown as WorkflowFunction<unknown, unknown>);

    // Construction-time auto-resume is driven here rather than in the constructor
    // because definitions register only after the engine exists: now that this
    // definition is known, resume any non-terminal persisted runs of it that were
    // interrupted by a process restart (Req 13.1). `cancelled` runs are terminal
    // and are never returned by `listIncomplete`, so they are never resumed
    // (Req 14.4).
    if (this.autoResume) {
      this.scheduleAutoResume(name);
    }
  }

  definitions(): readonly string[] {
    return [...this.registry.keys()];
  }

  // ── Run (Req 1.5, 2.1, 3.2, 3.3, 20.4) ───────────────────────────────────────

  async run<I, O>(name: string, input: I, options?: RunOptions): Promise<WorkflowHandle<O>> {
    // Let any pending construction-time auto-resume settle before starting new
    // work, so a restart's in-flight resumptions observe a stable ordering.
    await this.settlePendingResumes();

    const fn = this.registry.get(name);
    if (fn === undefined) {
      // Unregistered name: no run is created (Req 1.5).
      throw new WorkflowNotFoundError(name);
    }

    const runId = options?.runId ?? randomUUID();
    const now = this.clock();
    const initial: WorkflowRun = {
      runId,
      definition: name,
      status: "running",
      input,
      commands: [],
      nextSeq: 0,
      state: {},
      pendingSignals: [],
      history: [{ type: "run.started", at: now, input }],
      createdAt: now,
      updatedAt: now,
    };

    await this.store.save(initial);
    this.trackStatus(runId, "running");
    // Broadcast the run-start lifecycle event once the run is persisted and
    // `running` (Req 18.2). Best-effort: the bridge swallows failures and is a
    // no-op when no realtime bridge is wired (Req 18.4).
    await this.realtimeBridge.broadcastLifecycle("workflow.started", runId);

    const handle = this.makeHandle<O>(runId);
    await this.executeDrive(initial, fn);
    return handle;
  }

  // ── Resume (Req 2.2, 14.3) ────────────────────────────────────────────────────

  async resume(runId: string): Promise<WorkflowHandle<unknown>> {
    // Settle any in-flight construction-time auto-resume of this run first so an
    // explicit resume never races a concurrent auto-resume of the same run.
    await this.settlePendingResumes();

    const run = await this.store.load(runId);
    if (run === null) {
      throw new WorkflowError(`No workflow run "${runId}" is persisted; nothing to resume.`);
    }
    // A cancelled run never resumes and never invokes an activity (Req 2.2, 14.3).
    if (run.status === "cancelled") {
      throw new CancelledResumeError(runId);
    }

    const handle = this.makeHandle<unknown>(runId);
    // Only a non-terminal run is continued from its last persisted state (Req 2.2);
    // the Journal replays already-`completed` commands without re-invoking them
    // (Req 13.2) and continues live from the earliest non-terminal command
    // (Req 13.3). Terminal (non-cancelled) runs are already settled — hand back a
    // handle that resolves/rejects from the persisted terminal state without
    // re-driving.
    if (!TERMINAL.includes(run.status)) {
      await this.driveExisting(runId);
    }
    return handle;
  }

  // ── Pause / cancel (Req 2.3, 2.4, 14.1, 14.2) ─────────────────────────────────

  async pause(runId: string): Promise<void> {
    const run = await this.store.load(runId);
    // Only a `running` run can be paused (Req 2.3); anything else is a no-op.
    if (run === null || run.status !== "running") {
      return;
    }
    await this.transition(run, "paused");
  }

  async cancel(runId: string): Promise<void> {
    const run = await this.store.load(runId);
    // Cancel only applies to a non-terminal run (Req 2.4); terminal/unknown → no-op.
    if (run === null || TERMINAL.includes(run.status)) {
      return;
    }
    // Abort any in-flight activity AbortSignal of this run (Req 14.1).
    this.coordinator.abort(runId);
    const cancelled = await this.transition(run, "cancelled");
    this.notifyTerminal(cancelled);
    // Broadcast the terminal cancellation lifecycle event (Req 18.2). Best-effort
    // and a no-op without a wired realtime bridge (Req 18.4).
    await this.realtimeBridge.broadcastLifecycle("workflow.cancelled", runId);
  }

  // ── Restart (Req 2.5) ─────────────────────────────────────────────────────────

  async restart(runId: string): Promise<WorkflowHandle<unknown>> {
    const run = await this.store.load(runId);
    if (run === null) {
      throw new WorkflowError(`No workflow run "${runId}" is persisted; nothing to restart.`);
    }
    // A new run of the same definition with a fresh runId (Req 2.5).
    return this.run<unknown, unknown>(run.definition, run.input);
  }

  // ── Inspection (Req 2.6, 2.7, 2.8) ────────────────────────────────────────────

  async status(runId: string): Promise<RunStatus | null> {
    // Reflect any auto-resume that has already advanced this run past its
    // persisted-on-restart state before reporting the status (Req 13.1).
    await this.settlePendingResumes();
    const run = await this.store.load(runId);
    return run?.status ?? null;
  }

  async list(): Promise<readonly WorkflowSummary[]> {
    await this.settlePendingResumes();
    return this.store.list();
  }

  async history(runId: string): Promise<readonly HistoryEvent[]> {
    await this.settlePendingResumes();
    const run = await this.store.load(runId);
    return run?.history ?? [];
  }

  // ── Signals (Req 17.2, 26.6) ──────────────────────────────────────────────────

  async signal<P>(runId: string, name: string, payload: P): Promise<void> {
    const result = await this.coordinator.deliverSignal(runId, name, payload);
    if (result.run === null) {
      throw new WorkflowError(
        `No workflow run "${runId}" is persisted; cannot deliver signal "${name}".`,
      );
    }
  }

  // ── Stats (best-effort) ───────────────────────────────────────────────────────

  stats(): WorkflowStats {
    let running = 0;
    let waiting = 0;
    let completed = 0;
    let failed = 0;
    let compensated = 0;
    let cancelled = 0;
    for (const status of this.statuses.values()) {
      switch (status) {
        case "running":
          running += 1;
          break;
        case "waiting":
          waiting += 1;
          break;
        case "completed":
          completed += 1;
          break;
        case "failed":
          failed += 1;
          break;
        case "compensated":
          compensated += 1;
          break;
        case "cancelled":
          cancelled += 1;
          break;
        default:
          // `paused` / `compensating` are transient and not tallied here.
          break;
      }
    }
    return {
      running,
      waiting,
      completed,
      failed,
      compensated,
      cancelled,
      // Cumulative activity-level tallies accrued from persisted command records
      // as runs drive forward, so the snapshot stays consistent with the metrics.
      activityRetries: this.totalRetries,
      compensations: this.totalCompensations,
      // A `waiting` run is parked on a timer/signal, so active timers track the
      // waiting count. No live queue-depth source exists in this build, so queued
      // activities report 0 while the gauge is still registered (Req 21.3).
      activeTimers: waiting,
      queuedActivities: 0,
    };
  }

  async close(): Promise<void> {
    // Let any in-flight construction-time auto-resume drives settle so they do not
    // outlive the engine. No other long-lived resources are held in this build;
    // timers/signals are driven synchronously through the coordinator.
    await this.settlePendingResumes();
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  /** Build a typed handle over a runId (Req 2.6, 3.2). */
  private makeHandle<O>(runId: string): WorkflowHandle<O> {
    return {
      runId,
      status: async (): Promise<RunStatus | null> => (await this.store.load(runId))?.status ?? null,
      result: (): Promise<O> => this.awaitResult<O>(runId),
    };
  }

  /**
   * Resolve with the typed `output` when the run completes, or reject when it
   * ends `failed`/`compensated`/`cancelled`. If the run is already terminal the
   * promise settles immediately; otherwise a waiter is registered and settled
   * when a later drive finalizes the run.
   */
  private awaitResult<O>(runId: string): Promise<O> {
    return new Promise<O>((resolve, reject) => {
      void this.store.load(runId).then((run) => {
        if (run !== null && TERMINAL.includes(run.status)) {
          this.settle(run, resolve as (value: unknown) => void, reject);
          return;
        }
        const list = this.waiters.get(runId) ?? [];
        list.push({ resolve: resolve as (value: unknown) => void, reject });
        this.waiters.set(runId, list);
      }, reject);
    });
  }

  /** Settle a single awaiter from a terminal run snapshot (Req 3.2, 3.3). */
  private settle(
    run: WorkflowRun,
    resolve: (value: unknown) => void,
    reject: (error: unknown) => void,
  ): void {
    if (run.status === "completed") {
      resolve(run.output);
      return;
    }
    reject(
      new WorkflowError(
        `Workflow run "${run.runId}" did not complete successfully (status: ${run.status}).`,
      ),
    );
  }

  /** Resolve/reject every pending awaiter of a run that has reached a terminal state. */
  private notifyTerminal(run: WorkflowRun): void {
    const list = this.waiters.get(run.runId);
    if (list === undefined) {
      return;
    }
    this.waiters.delete(run.runId);
    for (const waiter of list) {
      this.settle(run, waiter.resolve, waiter.reject);
    }
  }

  /** Persist a Run_Status transition with a `run.status` History event. */
  private async transition(run: WorkflowRun, to: RunStatus): Promise<WorkflowRun> {
    const now = this.clock();
    const next: WorkflowRun = {
      ...run,
      status: to,
      history: [...run.history, { type: "run.status", at: now, from: run.status, to }],
      updatedAt: now,
    };
    await this.store.save(next);
    this.trackStatus(run.runId, to);
    return next;
  }

  /** Drive a persisted run to its next terminal disposition and settle awaiters. */
  private async executeDrive(run: WorkflowRun, fn: WorkflowFunction<unknown, unknown>): Promise<void> {
    const result = await this.runtime.drive(run, fn);
    this.trackStatus(result.run.runId, result.status);
    if (TERMINAL.includes(result.status)) {
      this.notifyTerminal(result.run);
    }
    // Broadcast the lifecycle event the drive finalized at (Req 18.2). Every
    // drive path (initial run, resume, coordinator re-drive, auto-resume) flows
    // through here, so terminal dispositions broadcast exactly once per drive.
    await this.broadcastDrive(result.run.runId, result.status);
  }

  /**
   * Map a {@link WorkflowRuntime.drive} disposition onto its Realtime lifecycle
   * event and broadcast it (Req 18.2). `completed` → `workflow.completed`,
   * `failed` → `workflow.failed`, saga `compensated`/`compensating` also map to
   * `workflow.failed` (the run did not complete successfully), and a `waiting`
   * park maps to `workflow.progress`. A plain `running` disposition (a resume that
   * neither parked nor finalized) broadcasts nothing. Cancellation is broadcast
   * separately in {@link cancel} since it does not flow through a drive.
   */
  private async broadcastDrive(runId: string, status: RunStatus): Promise<void> {
    let event: WorkflowLifecycleEvent | undefined;
    switch (status) {
      case "completed":
        event = "workflow.completed";
        break;
      case "failed":
      case "compensated":
      case "compensating":
        event = "workflow.failed";
        break;
      case "waiting":
        event = "workflow.progress";
        break;
      default:
        // `running`/`paused`/`cancelled` are not broadcast from a drive.
        event = undefined;
        break;
    }
    if (event !== undefined) {
      await this.realtimeBridge.broadcastLifecycle(event, runId);
    }
  }

  /**
   * Schedule construction-time auto-resume of every non-terminal persisted run of
   * a freshly registered definition (Req 13.1). Loads the store's incomplete runs
   * — which, by contract, exclude every terminal Run_Status, so a `cancelled` run
   * is never returned and never resumed (Req 14.4) — and re-drives each run of
   * this definition once. The work is tracked in {@link pendingResumes} so
   * lifecycle reads and {@link close} can settle it, and its rejections are
   * swallowed here (a `ResumeIntegrityError` is already finalized as `failed` by
   * the runtime, and one run's failure must not abort resuming the others).
   */
  private scheduleAutoResume(name: string): void {
    const task = this.autoResumeDefinition(name);
    this.pendingResumes.add(task);
    void task.finally(() => {
      this.pendingResumes.delete(task);
    });
  }

  /**
   * Re-drive each incomplete persisted run of the given definition exactly once.
   * `listIncomplete` filters out terminal runs (including `cancelled`), and each
   * runId is recorded in {@link autoResumed} so it is never scheduled twice.
   */
  private async autoResumeDefinition(name: string): Promise<void> {
    const incomplete = await this.store.listIncomplete();
    for (const run of incomplete) {
      if (run.definition !== name || this.autoResumed.has(run.runId)) {
        continue;
      }
      // `cancelled` is terminal, so it is already excluded by `listIncomplete`;
      // the explicit guard documents that cancellation is never auto-resumed
      // (Req 14.4) and keeps this correct even for a permissive store.
      if (run.status === "cancelled") {
        continue;
      }
      this.autoResumed.add(run.runId);
      // `driveExisting` skips terminal/`paused` runs and finalizes a
      // `ResumeIntegrityError` as `failed` through the runtime (Req 13.4); guard
      // against an unexpected rejection so one run cannot abort the rest.
      try {
        await this.driveExisting(run.runId);
      } catch {
        // Swallow: the run's failure is already persisted by the runtime, and a
        // construction-time resume must never throw out of a `define` call.
      }
    }
  }

  /**
   * Await every in-flight construction-time auto-resume drive. Rejections are
   * absorbed (each is already finalized as `failed` by the runtime), so callers
   * simply observe a stable, resumed state afterwards.
   */
  private async settlePendingResumes(): Promise<void> {
    if (this.pendingResumes.size === 0) {
      return;
    }
    await Promise.allSettled([...this.pendingResumes]);
  }

  /**
   * Re-drive an existing run (used by the coordinator's `onResume` for expired
   * timers and delivered signals, and by construction-time auto-resume). Skips
   * unknown, terminal, and `paused` runs so a cancelled or paused run never
   * silently resumes (Req 14.4).
   */
  private async driveExisting(runId: string): Promise<void> {
    const run = await this.store.load(runId);
    if (run === null || TERMINAL.includes(run.status) || run.status === "paused") {
      return;
    }
    const fn = this.registry.get(run.definition);
    if (fn === undefined) {
      return;
    }
    await this.executeDrive(run, fn);
  }

  /** Record the last-known Run_Status for the synchronous stats snapshot. */
  private trackStatus(runId: string, status: RunStatus): void {
    this.statuses.set(runId, status);
  }
}

// ── Factory ─────────────────────────────────────────────────────────────────────

/**
 * Create a {@link WorkflowEngine} backed by the configured {@link WorkflowStore}
 * (or a {@link MemoryWorkflowStore} when none is configured — Requirement 1.2),
 * the injected {@link Clock} (or {@link systemClock} — Requirement 20.1), and an
 * injectable `rng`.
 *
 * @param config Optional engine configuration (store, clock, rng, bridges).
 * @returns A fully wired engine exposing the lifecycle surface (Requirement 1.1).
 */
export function createWorkflow(config?: WorkflowConfig): WorkflowEngine {
  return new WorkflowEngineImpl(config);
}
