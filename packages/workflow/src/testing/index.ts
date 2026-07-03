/**
 * @streetjs/workflow/testing — in-process test doubles (Requirement 25).
 *
 * This submodule provides the zero-network, zero-Redis testing utilities the
 * workflow engine ships for authoring fast, deterministic workflow tests
 * (Requirements 25.1, 25.2). None of these helpers require an external service,
 * a network socket, or a Redis client — they run entirely in-process over the
 * zero-dependency {@link MemoryWorkflowStore} and an advanceable {@link FakeClock}
 * (Requirement 25.2).
 *
 * The four exported doubles mirror the sibling pillars' testing idioms (the
 * `@streetjs/realtime` advanceable-clock harness and the storage in-memory
 * driver double):
 *
 * - **{@link MemoryWorkflow}** — a real {@link WorkflowEngine} over a
 *   {@link MemoryWorkflowStore}, so durability, resume, retry, timers, and
 *   compensation are exercised end-to-end in-process (Requirement 25.4).
 * - **{@link FakeWorkflow}** — a recording double that captures defined
 *   functions, started runs, and delivered signals for assertion **without**
 *   scheduling any execution side effects.
 * - **{@link FakeClock}** — a function-callable, advanceable {@link Clock}
 *   (`() => number`) exposing `advance(ms)`/`set(ms)`, so Timer expiry and
 *   Backoff delays are testable without wall-clock waiting (Requirement 25.3).
 * - **{@link WorkflowHarness}** — bundles an engine wired to a {@link FakeClock}
 *   with assertion helpers (`assertStatus`, `assertHistory`,
 *   `assertCompensatedInReverseOrder`) (Requirement 25.3).
 *
 * This module deliberately depends only on the base package internals
 * (`../engine.js`, `../store.js`, `../types.js`, `../errors.js`) and the core
 * `Clock` primitive from `streetjs`; it is reached only through the dedicated
 * `@streetjs/workflow/testing` subpath export, and the base entry (`../index.ts`)
 * never imports it.
 *
 * _Requirements: 25.1, 25.2, 25.3, 25.4_
 */

import type { Clock } from "streetjs";

import { createWorkflow } from "../engine.js";
import type { WorkflowEngine } from "../engine.js";
import { RegistrationError, WorkflowError } from "../errors.js";
import { MemoryWorkflowStore } from "../store.js";
import type {
  HistoryEvent,
  RunOptions,
  RunStatus,
  WorkflowConfig,
  WorkflowFunction,
  WorkflowHandle,
  WorkflowStats,
  WorkflowSummary,
} from "../types.js";
import { TERMINAL } from "../types.js";

// ── FakeClock (Requirement 25.3) ───────────────────────────────────────────────

/**
 * A function-callable, advanceable {@link Clock}.
 *
 * A `FakeClock` value is itself callable — `clock()` returns the current virtual
 * time in epoch milliseconds, satisfying the core `Clock` type (`() => number`)
 * so it can be passed directly as `createWorkflow({ clock })`. It additionally
 * exposes {@link FakeClock.advance} to move virtual time forward (firing Timer
 * expiries and Backoff windows deterministically) and {@link FakeClock.set} to
 * jump to an absolute instant (Requirement 25.3).
 */
export interface FakeClock {
  /** The current virtual time in epoch milliseconds (the `Clock` call signature). */
  (): number;
  /** Advance virtual time by `ms` (must be `>= 0`). */
  advance(ms: number): void;
  /** Jump virtual time to the absolute epoch-ms instant `ms`. */
  set(ms: number): void;
  /** The current virtual time in epoch milliseconds (alias of the call form). */
  now(): number;
}

/**
 * Create a {@link FakeClock} starting at `startMs` (default `0`).
 *
 * The returned value is a callable clock (`clock()` → current virtual time) with
 * `advance`/`set`/`now` attached, so it drops straight into
 * `createWorkflow({ clock })` and can be advanced in a test to fire timers and
 * backoff windows without any wall-clock waiting (Requirement 25.3).
 */
export function FakeClock(startMs = 0): FakeClock {
  let current = startMs;

  const clock = (() => current) as FakeClock;

  clock.advance = (ms: number): void => {
    if (ms < 0) {
      throw new WorkflowError(`FakeClock.advance: ms must be >= 0 (received ${ms}).`);
    }
    current += ms;
  };

  clock.set = (ms: number): void => {
    current = ms;
  };

  clock.now = (): number => current;

  return clock;
}

// ── MemoryWorkflow (Requirement 25.4) ──────────────────────────────────────────

/** Options for {@link MemoryWorkflow}; every field is optional. */
export interface MemoryWorkflowOptions {
  /** The backing store; defaults to a fresh zero-dependency {@link MemoryWorkflowStore}. */
  readonly store?: MemoryWorkflowStore;
  /** The injected Clock; pass a {@link FakeClock} to control timers deterministically. */
  readonly clock?: Clock;
  /** Optional structural pillar bridges threaded onto every run's `ctx`. */
  readonly bridges?: WorkflowConfig["bridges"];
  /** Auto-resume non-terminal runs as definitions register; defaults to the engine default (`true`). */
  readonly autoResume?: boolean;
  /** Injectable RNG for jitter backoff, for fully deterministic tests. */
  readonly rng?: () => number;
}

/**
 * A real {@link WorkflowEngine} backed by the zero-dependency
 * {@link MemoryWorkflowStore} (Requirement 25.4).
 *
 * Because it is the genuine engine over a real store, it exercises durability,
 * resume, retry, timers, and compensation in-process — no external service,
 * network, or Redis is involved (Requirements 25.2, 25.4). Pass a
 * {@link FakeClock} as `clock` to make Timer expiry and Backoff delays advance
 * on demand.
 */
export function MemoryWorkflow(options: MemoryWorkflowOptions = {}): WorkflowEngine {
  const config: WorkflowConfig = {
    store: options.store ?? new MemoryWorkflowStore(),
    ...(options.clock !== undefined ? { clock: options.clock } : {}),
    ...(options.bridges !== undefined ? { bridges: options.bridges } : {}),
    ...(options.autoResume !== undefined ? { autoResume: options.autoResume } : {}),
    ...(options.rng !== undefined ? { rng: options.rng } : {}),
  };
  return createWorkflow(config);
}

// ── FakeWorkflow (recording double) ────────────────────────────────────────────

/** A defined workflow captured by {@link FakeWorkflow.define}. */
export interface RecordedDefinition {
  readonly name: string;
  readonly fn: WorkflowFunction<unknown, unknown>;
}

/** A started run captured by {@link FakeWorkflow.run}. */
export interface RecordedRun {
  readonly runId: string;
  readonly name: string;
  readonly input: unknown;
  readonly options?: RunOptions;
}

/** A delivered signal captured by {@link FakeWorkflow.signal}. */
export interface RecordedSignalDelivery {
  readonly runId: string;
  readonly name: string;
  readonly payload: unknown;
}

/**
 * A recording double implementing the {@link WorkflowEngine} surface that
 * **captures** interactions instead of executing them.
 *
 * `FakeWorkflow` schedules no activities, timers, or resumptions; it simply
 * records every {@link define}, {@link run}, and {@link signal} for later
 * assertion, making it a drop-in seam for unit tests that only need to verify
 * *what the code under test asked the engine to do* — with no execution side
 * effects and no external dependency (Requirements 25.1, 25.2).
 *
 * The captured interactions are exposed through the readonly {@link definitions0},
 * {@link startedRuns}, and {@link deliveredSignals} collections and the query
 * helpers {@link runsOf}/{@link signalsFor}.
 */
export class FakeWorkflow implements WorkflowEngine {
  /** Registered definitions by name (duplicate registration raises {@link RegistrationError}). */
  private readonly registry = new Map<string, WorkflowFunction<unknown, unknown>>();

  /** Recorded started runs, in call order. */
  private readonly runs: RecordedRun[] = [];

  /** Recorded delivered signals, in call order. */
  private readonly signals: RecordedSignalDelivery[] = [];

  /** Last-known status per recorded run, for {@link status}/{@link stats}. */
  private readonly statuses = new Map<string, RunStatus>();

  /** Monotonic counter minting deterministic run ids when none is supplied. */
  private nextRunId = 0;

  // ── Recording accessors ───────────────────────────────────────────────────

  /** The recorded definitions captured by {@link define}, in registration order. */
  get definedWorkflows(): readonly RecordedDefinition[] {
    return [...this.registry.entries()].map(([name, fn]) => ({ name, fn }));
  }

  /** The recorded started runs, in call order. */
  get startedRuns(): readonly RecordedRun[] {
    return [...this.runs];
  }

  /** The recorded delivered signals, in call order. */
  get deliveredSignals(): readonly RecordedSignalDelivery[] {
    return [...this.signals];
  }

  /** Recorded started runs of a given definition name. */
  runsOf(name: string): readonly RecordedRun[] {
    return this.runs.filter((run) => run.name === name);
  }

  /** Recorded signals delivered to a given run. */
  signalsFor(runId: string): readonly RecordedSignalDelivery[] {
    return this.signals.filter((signal) => signal.runId === runId);
  }

  // ── WorkflowEngine surface (recording, no side effects) ────────────────────

  define<I, O>(name: string, fn: WorkflowFunction<I, O>): void {
    if (this.registry.has(name)) {
      // Mirror the real engine: a duplicate name is rejected and the prior
      // definition is retained (Req 1.4).
      throw new RegistrationError(name);
    }
    this.registry.set(name, fn as unknown as WorkflowFunction<unknown, unknown>);
  }

  async run<I, O>(name: string, input: I, options?: RunOptions): Promise<WorkflowHandle<O>> {
    const runId = options?.runId ?? `fake-run-${this.nextRunId++}`;
    this.runs.push({ runId, name, input, ...(options !== undefined ? { options } : {}) });
    this.statuses.set(runId, "running");
    return this.makeHandle<O>(runId);
  }

  async resume(runId: string): Promise<WorkflowHandle<unknown>> {
    return this.makeHandle<unknown>(runId);
  }

  async pause(runId: string): Promise<void> {
    if (this.statuses.has(runId)) {
      this.statuses.set(runId, "paused");
    }
  }

  async cancel(runId: string): Promise<void> {
    if (this.statuses.has(runId)) {
      this.statuses.set(runId, "cancelled");
    }
  }

  async restart(runId: string): Promise<WorkflowHandle<unknown>> {
    const previous = this.runs.find((run) => run.runId === runId);
    const name = previous?.name ?? runId;
    return this.run<unknown, unknown>(name, previous?.input ?? null);
  }

  async status(runId: string): Promise<RunStatus | null> {
    return this.statuses.get(runId) ?? null;
  }

  async list(): Promise<readonly WorkflowSummary[]> {
    return this.runs.map((run) => ({
      runId: run.runId,
      definition: run.name,
      status: this.statuses.get(run.runId) ?? "running",
    }));
  }

  async history(): Promise<readonly HistoryEvent[]> {
    // A recording double schedules nothing, so it accrues no durable History.
    return [];
  }

  async signal<P>(runId: string, name: string, payload: P): Promise<void> {
    this.signals.push({ runId, name, payload });
  }

  definitions(): readonly string[] {
    return [...this.registry.keys()];
  }

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
      activityRetries: 0,
      compensations: 0,
      activeTimers: waiting,
      queuedActivities: 0,
    };
  }

  async close(): Promise<void> {
    // No resources to release; a recording double holds only in-memory arrays.
  }

  /**
   * Build a handle over a recorded runId. `status()` reflects the recorded
   * status; `result()` rejects, because a recording double never executes a run
   * to a real terminal value — a test should assert over the recorded
   * interactions instead of awaiting a result.
   */
  private makeHandle<O>(runId: string): WorkflowHandle<O> {
    return {
      runId,
      status: async (): Promise<RunStatus | null> => this.statuses.get(runId) ?? null,
      result: (): Promise<O> =>
        Promise.reject(
          new WorkflowError(
            `FakeWorkflow does not execute runs, so run "${runId}" has no result; assert over the recorded interactions instead.`,
          ),
        ),
    };
  }
}

// ── WorkflowHarness (Requirement 25.3) ─────────────────────────────────────────

/** Options for a {@link WorkflowHarness}; every field is optional. */
export interface WorkflowHarnessOptions {
  /** A pre-built {@link FakeClock}; defaults to a fresh clock starting at `startMs`. */
  readonly clock?: FakeClock;
  /** The virtual start time for the default {@link FakeClock} (ignored when `clock` is supplied). */
  readonly startMs?: number;
  /** A pre-built backing store; defaults to a fresh {@link MemoryWorkflowStore}. */
  readonly store?: MemoryWorkflowStore;
  /** Optional structural pillar bridges threaded onto every run's `ctx`. */
  readonly bridges?: WorkflowConfig["bridges"];
  /** Injectable RNG for jitter backoff, for fully deterministic tests. */
  readonly rng?: () => number;
}

/**
 * Bundles a real {@link WorkflowEngine} wired to a {@link FakeClock} and backing
 * {@link MemoryWorkflowStore} with assertion helpers (Requirement 25.3).
 *
 * A single harness owns the engine, the advanceable clock, and the store, so a
 * test can drive workflows, {@link advance} virtual time to fire Timers/backoff
 * windows deterministically, and assert over the resulting Run_Status and
 * History — all in-process with no external service, network, or Redis
 * (Requirement 25.2).
 *
 * ```typescript
 * const harness = new WorkflowHarness();
 * harness.engine.define("order-processing", orderProcessing);
 * const handle = await harness.engine.run("order-processing", input);
 * await harness.advance(60_000);           // fire timers / backoff windows
 * await harness.assertStatus(handle.runId, "completed");
 * ```
 */
export class WorkflowHarness {
  /** The advanceable virtual clock backing every timer and timestamp. */
  readonly clock: FakeClock;

  /** The zero-dependency backing store; inspectable in a test. */
  readonly store: MemoryWorkflowStore;

  /** The real engine under test, wired to {@link clock} and {@link store}. */
  readonly engine: WorkflowEngine;

  constructor(options: WorkflowHarnessOptions = {}) {
    this.clock = options.clock ?? FakeClock(options.startMs ?? 0);
    this.store = options.store ?? new MemoryWorkflowStore();
    const config: WorkflowConfig = {
      store: this.store,
      clock: this.clock,
      ...(options.bridges !== undefined ? { bridges: options.bridges } : {}),
      ...(options.rng !== undefined ? { rng: options.rng } : {}),
    };
    this.engine = createWorkflow(config);
  }

  /**
   * Advance the virtual clock by `ms` and then settle any Timer expiries by
   * re-driving every non-terminal, parked run (Requirement 25.3). Returns once
   * the re-drives have settled so a subsequent status/History assertion observes
   * the post-advance state.
   */
  async advance(ms: number): Promise<void> {
    this.clock.advance(ms);
    await this.settleTimers();
  }

  /**
   * Assert that the run `runId` is in the expected {@link RunStatus}, first
   * settling any due Timers so the assertion observes the post-advance state.
   */
  async assertStatus(runId: string, expected: RunStatus): Promise<void> {
    await this.settleTimers();
    const actual = await this.engine.status(runId);
    if (actual !== expected) {
      throw new WorkflowError(
        `assertStatus failed for run "${runId}": expected status "${expected}" but was "${actual ?? "unknown"}".`,
      );
    }
  }

  /**
   * Assert that the ordered {@link HistoryEvent} `type`s recorded for `runId`
   * exactly equal `expected`, first settling any due Timers.
   */
  async assertHistory(runId: string, expected: readonly HistoryEvent["type"][]): Promise<void> {
    await this.settleTimers();
    const history = await this.engine.history(runId);
    const actual = history.map((event) => event.type);
    const matches =
      actual.length === expected.length && actual.every((type, i) => type === expected[i]);
    if (!matches) {
      throw new WorkflowError(
        `assertHistory failed for run "${runId}": expected [${expected.join(", ")}] but was [${actual.join(", ")}].`,
      );
    }
  }

  /**
   * Assert that every completed Compensation_Action recorded in `runId`'s History
   * ran in **reverse** completion order — i.e. the `seq` values of the
   * `compensation.completed` events strictly decrease (Requirement 10.3). A run
   * with fewer than two compensations trivially satisfies the ordering.
   */
  async assertCompensatedInReverseOrder(runId: string): Promise<void> {
    await this.settleTimers();
    const history = await this.engine.history(runId);
    const seqs = history
      .filter((event): event is Extract<HistoryEvent, { type: "compensation.completed" }> =>
        event.type === "compensation.completed",
      )
      .map((event) => event.seq);
    for (let i = 1; i < seqs.length; i += 1) {
      const previous = seqs[i - 1] as number;
      const current = seqs[i] as number;
      if (current >= previous) {
        throw new WorkflowError(
          `assertCompensatedInReverseOrder failed for run "${runId}": compensation seq order [${seqs.join(", ")}] is not strictly reverse (descending).`,
        );
      }
    }
  }

  /**
   * Re-drive every non-terminal parked run so a Timer that is now due (measured
   * on the advanced {@link clock}) fires. Terminal runs are excluded by
   * `store.listIncomplete()`, so a cancelled run never resumes here
   * (Requirement 14.4). Best-effort: a run that cannot be re-driven is skipped so
   * one run's failure never aborts settling the others.
   */
  private async settleTimers(): Promise<void> {
    const incomplete = await this.store.listIncomplete();
    for (const run of incomplete) {
      if (run.status === "waiting" && !TERMINAL.includes(run.status)) {
        try {
          await this.engine.resume(run.runId);
        } catch {
          // Skip a run that cannot be re-driven; settling the rest must continue.
        }
      }
    }
  }
}
