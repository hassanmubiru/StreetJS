/**
 * @streetjs/workflow — the WorkflowStore contract and the zero-dependency
 * MemoryWorkflowStore.
 *
 * `WorkflowStore` is the single persistence contract the engine speaks to
 * (Requirement 11.1). It is defined once in `./types.ts` (because
 * `WorkflowConfig` references it) and re-exported here for convenience so that
 * store consumers can import both the contract and its default implementation
 * from a single module. `MemoryWorkflowStore` is the zero-dependency default
 * (Requirements 11.4, 22.2); `RedisWorkflowStore` (from the
 * `@streetjs/workflow/redis` submodule) satisfies the same contract and is
 * substitutable (Requirements 12.2, 12.5).
 *
 * The Memory store is backed by a `Map<string, WorkflowRun>` and deep-clones on
 * both `save` and `load`, so the durable snapshot is the single source of truth
 * for resume and replay — a caller can never mutate persisted state out-of-band
 * (design "MemoryWorkflowStore Design"). `listIncomplete` filters out terminal
 * runs using the {@link TERMINAL} set (Requirement 13.1). Because state lives
 * only in process memory, runs are retained **only for the process lifetime**
 * (Requirement 13.5). It uses no external runtime dependency (Requirements 11.4,
 * 22.2).
 *
 * Persistence is all-or-nothing: `save`/`append` clone before mutating the
 * backing map, so an internal failure (e.g. a structured clone throwing under
 * memory pressure) rejects the operation with a descriptive {@link
 * PersistenceError} and leaves the last successfully persisted state unchanged
 * (Requirement 11.5).
 *
 * _Requirements: 2.7, 11.1, 11.2, 11.3, 11.4, 11.5, 13.5, 22.2_
 */

import { PersistenceError } from "./errors.js";
import type {
  HistoryEvent,
  StoreProbe,
  WorkflowRun,
  WorkflowStore,
  WorkflowSummary,
} from "./types.js";
import { TERMINAL } from "./types.js";

// Re-export the persistence contract shapes for convenience so consumers can
// import the contract and its default implementation from one module. These are
// type-only re-exports; the canonical definitions live in `./types.ts`.
export type { WorkflowStore, StoreProbe } from "./types.js";

/**
 * Deep-clone a {@link WorkflowRun} snapshot.
 *
 * Uses the platform `structuredClone` (available on Node `>=22`, this package's
 * `engines.node` floor) so nested arrays/objects, `Uint8Array` results, and
 * `Date`-free JSON-safe values are copied by value with no external dependency.
 * Cloning on the way in and on the way out guarantees callers can never mutate
 * persisted state through a shared reference.
 */
function cloneRun(run: WorkflowRun): WorkflowRun {
  return structuredClone(run);
}

/**
 * Zero-dependency in-memory {@link WorkflowStore}.
 *
 * Backed by a `Map<string, WorkflowRun>` keyed by `runId`. Every run is
 * deep-cloned on `save` (before it enters the map) and on `load` (before it
 * leaves), so the stored snapshot is the immutable source of truth. Requires no
 * external runtime dependency and retains runs only for the lifetime of the
 * process (Requirements 11.4, 13.5, 22.2).
 */
export class MemoryWorkflowStore implements WorkflowStore {
  /** Stable store name surfaced to observability/health checks. */
  readonly name = "memory";

  /** Backing store: runId → deep-cloned durable run snapshot. */
  private readonly runs = new Map<string, WorkflowRun>();

  /**
   * Persist a full run snapshot; the durable write-before-advance point
   * (Requirement 11.2).
   *
   * The run is deep-cloned *before* it is written into the backing map. If the
   * clone fails (for example under memory pressure), the map is left untouched
   * and a descriptive {@link PersistenceError} is raised, so the last
   * successfully persisted state is preserved (Requirement 11.5).
   */
  async save(run: WorkflowRun): Promise<void> {
    let snapshot: WorkflowRun;
    try {
      snapshot = cloneRun(run);
    } catch (cause) {
      throw new PersistenceError(
        `Failed to persist workflow run "${run.runId}": the in-memory store could not clone the run snapshot; the last persisted state is unchanged.`,
        { operation: "save", runId: run.runId, cause },
      );
    }
    this.runs.set(snapshot.runId, snapshot);
  }

  /**
   * Load a run by id, returning a deep clone so callers cannot mutate the
   * persisted snapshot, or `null` when the id is unknown (Requirement 11.3).
   */
  async load(runId: string): Promise<WorkflowRun | null> {
    const stored = this.runs.get(runId);
    if (stored === undefined) {
      return null;
    }
    try {
      return cloneRun(stored);
    } catch (cause) {
      throw new PersistenceError(
        `Failed to load workflow run "${runId}": the in-memory store could not clone the persisted snapshot.`,
        { operation: "load", runId, cause },
      );
    }
  }

  /**
   * Append one History event in order to the recorded run (Requirement 21.2).
   *
   * The event is appended to a fresh copy of the run's history and the updated
   * snapshot is deep-cloned before replacing the stored one, keeping the
   * operation all-or-nothing. Appending to an unknown run raises a descriptive
   * {@link PersistenceError} rather than silently creating one.
   */
  async append(runId: string, event: HistoryEvent): Promise<void> {
    const stored = this.runs.get(runId);
    if (stored === undefined) {
      throw new PersistenceError(
        `Cannot append history to workflow run "${runId}": no such run is persisted.`,
        { operation: "append", runId },
      );
    }
    let snapshot: WorkflowRun;
    try {
      snapshot = cloneRun({
        ...stored,
        history: [...stored.history, event],
      });
    } catch (cause) {
      throw new PersistenceError(
        `Failed to append history to workflow run "${runId}": the in-memory store could not clone the updated snapshot; the last persisted state is unchanged.`,
        { operation: "append", runId, cause },
      );
    }
    this.runs.set(runId, snapshot);
  }

  /**
   * Return the runId, definition, and status of every recorded run
   * (Requirements 2.7, 24.3).
   */
  async list(): Promise<readonly WorkflowSummary[]> {
    const summaries: WorkflowSummary[] = [];
    for (const run of this.runs.values()) {
      summaries.push({
        runId: run.runId,
        definition: run.definition,
        status: run.status,
      });
    }
    return summaries;
  }

  /**
   * Return deep clones of all runs not in a terminal {@link RunStatus}, for
   * resume-on-startup (Requirement 13.1). Terminal runs (`completed`, `failed`,
   * `compensated`, `cancelled`) are filtered out via the {@link TERMINAL} set.
   */
  async listIncomplete(): Promise<readonly WorkflowRun[]> {
    const incomplete: WorkflowRun[] = [];
    for (const run of this.runs.values()) {
      if (!TERMINAL.includes(run.status)) {
        incomplete.push(cloneRun(run));
      }
    }
    return incomplete;
  }

  /**
   * Best-effort availability probe for the health check (Requirement 21.5). An
   * in-memory store backed by a live `Map` is always available for the process
   * lifetime.
   */
  async probe(): Promise<StoreProbe> {
    return { available: true, detail: `in-memory store holding ${this.runs.size} run(s)` };
  }
}
