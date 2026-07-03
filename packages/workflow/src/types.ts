/**
 * @streetjs/workflow — shared, strongly typed data models.
 *
 * This module is the foundational, pillar-agnostic type surface of the package.
 * Every other module (`store.ts`, `journal.ts`, `context.ts`, `executor.ts`,
 * `compensator.ts`, `coordinator.ts`, `runtime.ts`, `engine.ts`, the four
 * `integrations/*` bridges, and the plugin/CLI/testing utilities) imports the
 * models defined here, so this file intentionally depends on no sibling module.
 * Only core StreetJS primitives (`Clock`, `MetricsRegistry`,
 * `HealthCheckRegistry`) are imported from `streetjs`.
 *
 * The structural bridge contracts ({@link StorageLike}, {@link QueueLike},
 * {@link EventsLike}, {@link RealtimeLike}) and the single persistence contract
 * ({@link WorkflowStore}) live here because {@link WorkflowConfig} references
 * them; the `integrations/*` modules and `store.ts` import these shapes from
 * this module, keeping the dependency direction acyclic (leaf modules → types,
 * never the reverse).
 *
 * _Requirements: 1.2, 2.1, 3.4, 4.2, 6.1, 9.5, 19.3, 20.4, 21.2_
 */

import type { Clock, HealthCheckRegistry, MetricsRegistry } from "streetjs";

// ── Run status ────────────────────────────────────────────────────────────────

/**
 * Lifecycle state of a Workflow_Run (Glossary: Run_Status). Includes `paused`.
 * Terminal statuses are `completed`, `failed`, `compensated`, and `cancelled`
 * (see {@link TERMINAL}).
 */
export type RunStatus =
  | "running"
  | "waiting"
  | "paused"
  | "completed"
  | "failed"
  | "compensating"
  | "compensated"
  | "cancelled";

/**
 * The terminal Run_Status values. A run in any of these states is never
 * auto-resumed on construction and is excluded from `listIncomplete`
 * (Requirements 13.1, 14.4).
 */
export const TERMINAL: readonly RunStatus[] = [
  "completed",
  "failed",
  "compensated",
  "cancelled",
] as const;

// ── Serialized error ──────────────────────────────────────────────────────────

/** A JSON-safe projection of an Error, recorded in the journal and History. */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

// ── Command journaling ─────────────────────────────────────────────────────────

/** The set of journaled `ctx` commands (purely local helpers are not journaled). */
export type CommandKind =
  | "activity"
  | "parallel.all"
  | "parallel.race"
  | "parallel.map"
  | "sleep"
  | "waitUntil"
  | "cron"
  | "interval"
  | "queue.dispatch"
  | "queue.execute"
  | "events.publish"
  | "events.waitFor"
  | "events.subscribe"
  | "storage.put"
  | "storage.get"
  | "storage.delete"
  | "storage.move"
  | "storage.copy"
  | "realtime.broadcast"
  | "state.set";

/** One journaled command outcome, keyed by its sequence number (Req 4.3, 20.3). */
export interface CommandRecord {
  /** Monotonically incrementing issue order assigned by the Journal. */
  readonly seq: number;
  readonly kind: CommandKind;
  readonly status: "completed" | "failed" | "waiting";
  /** Consumed attempts for activity commands (Req 6). */
  readonly attempts: number;
  /** Recorded result, reused on replay without re-executing the effect (Req 4.1, 4.3). */
  readonly result?: unknown;
  /** Last failure, if any. */
  readonly error?: SerializedError;
  /** Activity metadata recorded with the command (Req 4.2). */
  readonly metadata?: Record<string, unknown>;
  /** Saga bookkeeping: whether this command's compensation has run (Req 10). */
  readonly compensated?: boolean;
  /** Clock time of the next scheduled retry attempt (Req 6.2). */
  readonly nextAttemptAt?: number;
  /** Absolute Timer expiry, preserved across process restart (Req 9.5). */
  readonly timerExpiresAt?: number;
  /** Signal/event name this command awaits while `waiting` (Req 17.2). */
  readonly waitingFor?: string;
  readonly startedAt?: number;
  readonly completedAt?: number;
}

// ── History (append-only audit) ────────────────────────────────────────────────

/** The append-only audit record (Req 21.2). A discriminated union over `type`. */
export type HistoryEvent =
  | { readonly type: "run.started"; readonly at: number; readonly input: unknown }
  | {
      readonly type: "run.status";
      readonly at: number;
      readonly from: RunStatus;
      readonly to: RunStatus;
    }
  | {
      readonly type: "activity.started";
      readonly at: number;
      readonly seq: number;
      readonly attempt: number;
      readonly metadata?: Record<string, unknown>;
    }
  | { readonly type: "activity.completed"; readonly at: number; readonly seq: number; readonly result: unknown }
  | {
      readonly type: "activity.failed";
      readonly at: number;
      readonly seq: number;
      readonly attempt: number;
      readonly error: SerializedError;
    }
  | {
      readonly type: "retry.scheduled";
      readonly at: number;
      readonly seq: number;
      readonly attempt: number;
      readonly delayMs: number;
      readonly nextAttemptAt: number;
    }
  | { readonly type: "compensation.started"; readonly at: number; readonly seq: number }
  | { readonly type: "compensation.completed"; readonly at: number; readonly seq: number }
  | {
      readonly type: "compensation.failed";
      readonly at: number;
      readonly seq: number;
      readonly error: SerializedError;
    }
  | { readonly type: "signal.received"; readonly at: number; readonly name: string; readonly payload: unknown }
  | { readonly type: "timer.set"; readonly at: number; readonly seq: number; readonly expiresAt: number }
  | { readonly type: "timer.fired"; readonly at: number; readonly seq: number }
  | { readonly type: "publish.failed"; readonly at: number; readonly event: string; readonly error: SerializedError };

// ── Signals ────────────────────────────────────────────────────────────────────

/** A Signal/event recorded for a run (delivered-early or being consumed). */
export interface RecordedSignal {
  readonly name: string;
  readonly payload: unknown;
  readonly receivedAt: number;
  readonly consumed: boolean;
}

// ── The durable run ─────────────────────────────────────────────────────────────

/** A single durable execution of a Workflow_Definition (Req 2, 11). */
export interface WorkflowRun {
  /** Unique across the configured store (Req 20.4). */
  readonly runId: string;
  /** Registered Workflow_Function name. */
  readonly definition: string;
  readonly status: RunStatus;
  /** Typed workflow input, opaque at rest. */
  readonly input: unknown;
  /** Set when status === "completed" (Req 3.2). */
  readonly output?: unknown;
  /** The journal: recorded outcome per command, keyed by seq (source of truth for replay). */
  readonly commands: readonly CommandRecord[];
  /** Monotonic next sequence number to assign (Req 20 determinism). */
  readonly nextSeq: number;
  /** Durable per-run state written through `ctx.state` (Req 19.4). */
  readonly state: Readonly<Record<string, unknown>>;
  /** Delivered-early signals/events buffered until their `waitFor` is reached. */
  readonly pendingSignals: readonly RecordedSignal[];
  readonly history: readonly HistoryEvent[];
  /** Epoch ms from the injected Clock. */
  readonly createdAt: number;
  readonly updatedAt: number;
}

// ── Retry policy and backoff ────────────────────────────────────────────────────

/** Per-activity retry configuration (Req 6.1). */
export interface RetryPolicy {
  /** Total attempts, initial + retries; default 1 (Req 6.7, 6.8). */
  readonly maxAttempts: number;
  readonly backoff: Backoff;
}

/**
 * Backoff strategies; `fixed`/`exponential` mirror `@streetjs/queue`, `linear`
 * and `jitter` are added for the workflow requirements (Req 6.3–6.6).
 */
export type Backoff =
  | { readonly strategy: "fixed"; readonly delayMs: number }
  | { readonly strategy: "linear"; readonly baseMs: number; readonly maxDelayMs: number }
  | {
      readonly strategy: "exponential";
      readonly baseMs: number;
      readonly multiplier: number;
      readonly maxDelayMs: number;
    }
  | { readonly strategy: "jitter"; readonly maxDelayMs: number };

// ── Activities, options, middleware, compensation ────────────────────────────────

/** The user-supplied effectful work of an activity. Receives an AbortSignal (Req 4.4). */
export type Activity<Out> = (signal: AbortSignal) => Promise<Out> | Out;

/** Reverses the effects of a completed activity during saga rollback (Req 10.1). */
export type Compensation<Out> = (output: Out, signal: AbortSignal) => Promise<void> | void;

/** Wraps an activity attempt to observe or alter invocation (Req 4.5). */
export type ActivityMiddleware = (
  next: (signal: AbortSignal) => Promise<unknown>,
  info: { readonly attempt: number; readonly metadata?: Record<string, unknown> },
) => Promise<unknown>;

/** Options for a single `ctx.activity` call (Req 4.2). */
export interface ActivityOptions<Out> {
  /** Milliseconds, Clock-measured (Req 5). */
  readonly timeout?: number;
  /** Retry policy; absent means the activity runs at most once (Req 6, 6.8). */
  readonly retry?: RetryPolicy;
  /** Metadata recorded with the activity (Req 4.2). */
  readonly metadata?: Record<string, unknown>;
  /** `execute`/`rollback` pairing for saga compensation (Req 10.1). */
  readonly compensate?: Compensation<Out>;
  /** Middleware wrapping each attempt (Req 4.5). */
  readonly middleware?: readonly ActivityMiddleware[];
  /** Execute through the `QueueLike` bridge when wired (Req 16.2). */
  readonly viaQueue?: boolean;
}

// ── Branching and parallel ───────────────────────────────────────────────────────

/** A local, deterministic branch body (un-journaled). */
export type Branch = () => Promise<void> | void;

/** A tuple of activities whose result tuple is `T` (positional, Req 7). */
export type ParallelInput<T extends readonly unknown[]> = { [K in keyof T]: Activity<T[K]> };

// ── The ctx surface ──────────────────────────────────────────────────────────────

/** A journaled queue surface (Req 16). */
export interface QueueContext {
  /** Dispatch a background job, returning its jobId (Req 16.1). */
  dispatch(job: string, payload: unknown): Promise<string>;
}

/** A journaled events surface (Req 17). */
export interface EventsContext {
  /** Fire-and-forget publish; a failure is recorded and the run continues (Req 17.5). */
  publish(event: string, payload: unknown): Promise<void>;
  /** Park the run as `waiting` until a matching event arrives (Req 17.2). */
  waitFor<P>(event: string, options?: { parse?: (p: unknown) => P }): Promise<P>;
  /** Deliver each matching event to the handler; returns an unsubscribe fn (Req 17.3). */
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
}

/** A journaled storage surface (Req 15). */
export interface StorageContext {
  put(key: string, content: Uint8Array | string, options?: Record<string, unknown>): Promise<void>;
  get(key: string): Promise<{ found: boolean; bytes?: Uint8Array; metadata?: unknown }>;
  delete(key: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

/** A journaled realtime surface (Req 18). */
export interface RealtimeContext {
  broadcast(channel: string, payload: unknown): Promise<void>;
}

/** Ambient metadata about the current run and activity attempt (Req 19.3). */
export interface WorkflowMetadata {
  readonly runId: string;
  readonly definition: string;
  /** Current activity attempt when inside an activity. */
  readonly attempt: number;
}

/** Durable per-run state; writes persist with the run, reads survive replay (Req 19.4). */
export interface WorkflowState {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T): Promise<void>;
}

/** A run-scoped structured logger; entries are tied to the runId (Req 19.1). */
export interface WorkflowLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/**
 * The typed context passed to every Workflow_Function. Every effectful member
 * is a journaled command; local members (`if`/`switch`/`match`, `logger`,
 * `clock`, `metadata`) are deterministic and un-journaled (Req 3.4, 19).
 */
export interface WorkflowContext {
  /** Run one activity; result recorded + reused on replay (Req 4). */
  activity<Out>(fn: Activity<Out>, options?: ActivityOptions<Out>): Promise<Out>;

  /** Parallel composition with deterministic positional ordering (Req 7). */
  readonly parallel: {
    all<T extends readonly unknown[]>(activities: ParallelInput<T>): Promise<T>;
    race<T>(activities: readonly Activity<T>[]): Promise<T>;
    map<A, B>(items: readonly A[], mapper: (item: A, index: number) => Activity<B>): Promise<readonly B[]>;
  };

  /** Conditional/branching helpers — local, deterministic (Req 8). */
  if(condition: boolean): { then(branch: Branch): { else(branch: Branch): Promise<void> } & Promise<void> };
  switch<T>(selector: T, cases: ReadonlyMap<T, Branch>, defaultBranch?: Branch): Promise<void>;
  match<T>(
    value: T,
    patterns: readonly [pattern: (v: T) => boolean, branch: Branch][],
    defaultBranch?: Branch,
  ): Promise<void>;

  /** Timers — journaled waits (Req 9). */
  sleep(durationMs: number): Promise<void>;
  waitUntil(atEpochMs: number): Promise<void>;
  cron(expression: string, body: Branch): Promise<void>;
  interval(durationMs: number, body: Branch): Promise<void>;

  /** Pillar bridges — present/typed regardless; error if used without a wired bridge (Req 15–18). */
  readonly queue: QueueContext;
  readonly events: EventsContext;
  readonly storage: StorageContext;
  readonly realtime: RealtimeContext;

  /** Ambient services — local/deterministic except state writes which persist (Req 19). */
  readonly logger: WorkflowLogger;
  readonly clock: Clock;
  readonly metadata: WorkflowMetadata;
  readonly state: WorkflowState;
}

// ── Saga helpers ─────────────────────────────────────────────────────────────────

/** Saga authoring helpers over the same compensator machinery (Req 10.6). */
export interface Saga {
  step<Out>(fn: Activity<Out>, options?: ActivityOptions<Out>): Promise<Out>;
  compensate<Out>(fn: Activity<Out>, rollback: Compensation<Out>, options?: ActivityOptions<Out>): Promise<Out>;
  /** Run recorded compensations in reverse order now. */
  rollback(): Promise<void>;
}

// ── The Workflow_Function and handle ─────────────────────────────────────────────

/** The user-supplied imperative orchestration function (Workflow_Function). */
export type WorkflowFunction<I, O> = (ctx: WorkflowContext, input: I) => Promise<O> | O;

/** A typed handle to a started run; `result()` resolves when the run settles. */
export interface WorkflowHandle<O> {
  readonly runId: string;
  status(): Promise<RunStatus | null>;
  /** Resolves with the typed output on completion; rejects on failed/compensated/cancelled. */
  result(): Promise<O>;
}

// ── Structural pillar bridge contracts ───────────────────────────────────────────
//
// These are minimal structural shapes referenced by WorkflowConfig. The concrete
// `integrations/*` modules import these contracts from this module and depend
// only on the shape (never on a concrete pillar package), preserving the
// no-hard-dependency / no-circular-dependency guarantee (Req 15.2, 16.3, 17.4,
// 18.3, 30.3). A live pillar instance satisfies the matching shape structurally.

/** Pillar 4 — object storage (Req 15). */
export interface StorageLike {
  put(key: string, content: Uint8Array | string, options?: Record<string, unknown>): Promise<unknown>;
  get(key: string): Promise<{ found: boolean; bytes?: Uint8Array; metadata?: unknown }>;
  delete(key: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
}

/** Pillar 2 — background jobs + optional activity execution (Req 16). */
export interface QueueLike {
  /** Dispatch a job, returning its jobId (Req 16.1). */
  dispatch(job: string, payload: unknown): Promise<string>;
  /** Run an activity via the queue (Req 16.2). */
  execute?<Out>(activity: (signal: AbortSignal) => Promise<Out>): Promise<Out>;
}

/** Pillar 3 — application events (Req 17). */
export interface EventsLike {
  publish(event: string, payload: unknown): Promise<void> | void;
  waitFor(event: string): Promise<unknown>;
  subscribe(event: string, handler: (payload: unknown) => void): () => void;
}

/** Pillar 1 — realtime broadcast (Req 18). */
export interface RealtimeLike {
  broadcast(channel: string, event: string, payload: unknown): Promise<void> | void;
}

// ── Persistence contract ─────────────────────────────────────────────────────────
//
// The single persistence contract (Req 11.1). The concrete implementations
// (`MemoryWorkflowStore` in `store.ts`, `RedisWorkflowStore` in the `./redis`
// submodule) import and implement this contract. It lives here because
// WorkflowConfig references it, keeping the dependency direction acyclic.

/** Best-effort availability probe result surfaced by the store health check. */
export interface StoreProbe {
  readonly available: boolean;
  readonly detail?: string;
}

/** The single persistence contract every store satisfies (Req 11.1). */
export interface WorkflowStore {
  /** e.g. "memory" | "redis". */
  readonly name: string;
  /** Persist a full run snapshot; the durable write-before-advance point (Req 11.2). */
  save(run: WorkflowRun): Promise<void>;
  /** Load a run by id, or null when unknown (Req 11.3). */
  load(runId: string): Promise<WorkflowRun | null>;
  /** Append one History event in order (Req 21.2). */
  append(runId: string, event: HistoryEvent): Promise<void>;
  /** runId + status of every recorded run (Req 2.7). */
  list(): Promise<readonly WorkflowSummary[]>;
  /** All runs not in a terminal Run_Status, for resume-on-startup (Req 13.1). */
  listIncomplete(): Promise<readonly WorkflowRun[]>;
  /** Best-effort availability probe for the health check (Req 21.5). */
  probe?(): Promise<StoreProbe>;
}

// ── Summaries, config, options, stats ────────────────────────────────────────────

/** Run summary for `list()`/CLI (Req 2.7, 24.3). */
export interface WorkflowSummary {
  readonly runId: string;
  readonly definition: string;
  readonly status: RunStatus;
}

/** Engine configuration (Req 1.2, 20.1). */
export interface WorkflowConfig {
  /** Default: `new MemoryWorkflowStore()`. */
  readonly store?: WorkflowStore;
  /** Default: `systemClock` (Req 20.1). */
  readonly clock?: Clock;
  /** Reused core primitive for metrics (Req 21.3). */
  readonly metrics?: MetricsRegistry;
  /** Reused core primitive for health checks (Req 21.5). */
  readonly health?: HealthCheckRegistry;
  /** Injectable RNG for jitter backoff (deterministic tests). */
  readonly rng?: () => number;
  /** Optional structural pillar bridges; all optional, all structural. */
  readonly bridges?: {
    readonly storage?: StorageLike;
    readonly queue?: QueueLike;
    readonly events?: EventsLike;
    readonly realtime?: RealtimeLike;
  };
  /** Auto-resume non-terminal runs on construction; default true (Req 13.1, 14.4). */
  readonly autoResume?: boolean;
}

/** Options for a single `run(name, input, options)` call. */
export interface RunOptions {
  /** Supply a deterministic id; else a unique one is generated (Req 20.4). */
  readonly runId?: string;
}

/** Live metrics snapshot (best-effort, never throws). */
export interface WorkflowStats {
  readonly running: number;
  readonly waiting: number;
  readonly completed: number;
  readonly failed: number;
  readonly compensated: number;
  readonly cancelled: number;
  readonly activityRetries: number;
  readonly compensations: number;
  readonly activeTimers: number;
  readonly queuedActivities: number;
}
