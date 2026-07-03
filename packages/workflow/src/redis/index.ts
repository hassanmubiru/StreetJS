/**
 * @streetjs/workflow/redis — the optional, Redis-backed {@link WorkflowStore}.
 *
 * This submodule is the package's **provider-isolation** boundary: it is the
 * only place a Redis client is ever touched, and it is reachable **only** via
 * the `@streetjs/workflow/redis` subpath (`dist/redis/index.js`). The base entry
 * (`src/index.ts`) never imports this module and therefore never requires the
 * Redis client, so a consumer that uses only the zero-dependency
 * {@link MemoryWorkflowStore} pays no Redis cost (Requirement 12.3). The Redis
 * client is declared as an **optional peer dependency** of the package and is
 * relevant to this submodule only (Requirement 12.4).
 *
 * Following the same convention the sibling storage pillar uses for its cloud
 * drivers (see `@streetjs/storage`'s `S3ClientLike`), the Redis client is
 * depended upon **only structurally** through the minimal {@link RedisLike}
 * shape. A live `redis` v4 client satisfies {@link RedisLike} with no adapter,
 * but nothing here imports the `redis` package, so `streetjs` remains the only
 * hard runtime dependency and there is no hard, optional, or peer import of the
 * client from source (Requirement 12.4).
 *
 * ## Storage layout
 *
 * Each {@link WorkflowRun} is serialized to a single JSON string stored at
 * `{keyPrefix}run:{runId}` (default prefix `"workflow:"`, so `workflow:run:…`).
 * Two Redis sets track membership so `list` and `listIncomplete` need no scan:
 *
 * - `{keyPrefix}index` — every recorded run id (drives `list`).
 * - `{keyPrefix}incomplete` — the ids of runs **not** in a terminal
 *   {@link RunStatus} (drives `listIncomplete`, Requirement 13.1). A run id is
 *   added to this set on `save` when non-terminal and removed once it reaches a
 *   terminal state, exactly mirroring the {@link TERMINAL} filter the memory
 *   store applies in-process.
 *
 * ## Observational equivalence (Requirement 12.5)
 *
 * `RedisWorkflowStore` implements the identical {@link WorkflowStore} contract
 * as {@link MemoryWorkflowStore} and is fully substitutable through the engine:
 * for equivalent inputs the two stores produce the same observable
 * `Run_Status`, recorded Activity results, and History.
 *
 * The one representational difference is transport: the memory store keeps runs
 * as structured clones, while this store round-trips through JSON. Plain JSON
 * cannot represent a `Uint8Array` (an activity may record binary output), so
 * serialization uses a tagged encoding — a `Uint8Array` is written as
 * `{ "__u8b64__": "<base64>" }` and restored to a `Uint8Array` on load. This
 * keeps `Run_Status`, recorded results (including binary results), and History
 * byte-for-byte equivalent across the two stores. Values that JSON itself
 * cannot express (functions, symbols, `undefined` object properties) are not
 * part of the durable run snapshot; optional fields that are `undefined` are
 * simply absent after a round-trip, which is observationally identical.
 *
 * _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
 */

import { PersistenceError } from "../errors.js";
import type {
  HistoryEvent,
  StoreProbe,
  WorkflowRun,
  WorkflowStore,
  WorkflowSummary,
} from "../types.js";
import { TERMINAL } from "../types.js";

// ── Structural Redis client ─────────────────────────────────────────────────

/**
 * The minimal structural shape this store depends on. A `redis` v4 client
 * satisfies it directly (its `get`/`set`/`del`/`sAdd`/`sRem`/`sMembers` methods
 * have compatible signatures), so no adapter and no hard import of the client
 * are required. Depending only on this shape keeps the Redis client out of the
 * source dependency graph entirely (Requirement 12.4).
 */
export interface RedisLike {
  /** Read a string value, or `null` when the key is absent. */
  get(key: string): Promise<string | null>;
  /** Write a string value at a key. */
  set(key: string, value: string): Promise<unknown>;
  /** Delete a key. */
  del(key: string): Promise<unknown>;
  /** Add a member to the set at `key`. */
  sAdd(key: string, member: string): Promise<unknown>;
  /** Remove a member from the set at `key`. */
  sRem(key: string, member: string): Promise<unknown>;
  /** Return every member of the set at `key`. */
  sMembers(key: string): Promise<string[]>;
}

/** Construction options for {@link RedisWorkflowStore}. */
export interface RedisWorkflowStoreOptions {
  /** The structural Redis client; a live `redis` v4 client satisfies it. */
  readonly client: RedisLike;
  /** Key namespace prefix for every key this store writes; default `"workflow:"`. */
  readonly keyPrefix?: string;
}

// ── Tagged JSON (Uint8Array round-trip) ─────────────────────────────────────

/** Tag key marking a base64-encoded {@link Uint8Array} inside serialized JSON. */
const U8_TAG = "__u8b64__";

/**
 * `JSON.stringify` replacer: encode any {@link Uint8Array} (including `Buffer`,
 * which extends it) as a tagged base64 object so binary activity results
 * survive the JSON round-trip.
 */
function replacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return { [U8_TAG]: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64") };
  }
  return value;
}

/** `JSON.parse` reviver: restore tagged base64 objects back into {@link Uint8Array}. */
function reviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    U8_TAG in (value as Record<string, unknown>) &&
    typeof (value as Record<string, unknown>)[U8_TAG] === "string"
  ) {
    const b64 = (value as Record<string, string>)[U8_TAG];
    return Uint8Array.from(Buffer.from(b64, "base64"));
  }
  return value;
}

/** Serialize a run to JSON with the tagged binary encoding. */
function serializeRun(run: WorkflowRun): string {
  return JSON.stringify(run, replacer);
}

/** Parse a run from JSON, restoring tagged binary values. */
function deserializeRun(json: string): WorkflowRun {
  return JSON.parse(json, reviver) as WorkflowRun;
}

// ── The store ────────────────────────────────────────────────────────────────

/**
 * A Redis-backed {@link WorkflowStore} that is substitutable for
 * {@link MemoryWorkflowStore} (Requirements 12.2, 12.5). Reachable only via
 * `@streetjs/workflow/redis`; depends on the Redis client only through the
 * structural {@link RedisLike} shape (Requirements 12.3, 12.4).
 */
export class RedisWorkflowStore implements WorkflowStore {
  /** Stable store name surfaced to observability/health checks. */
  readonly name = "redis";

  private readonly client: RedisLike;
  private readonly keyPrefix: string;

  constructor(options: RedisWorkflowStoreOptions) {
    this.client = options.client;
    this.keyPrefix = options.keyPrefix ?? "workflow:";
  }

  /** Key holding the JSON snapshot of a single run. */
  private runKey(runId: string): string {
    return `${this.keyPrefix}run:${runId}`;
  }

  /** Key of the set holding every recorded run id. */
  private get indexKey(): string {
    return `${this.keyPrefix}index`;
  }

  /** Key of the set holding the ids of non-terminal runs. */
  private get incompleteKey(): string {
    return `${this.keyPrefix}incomplete`;
  }

  /**
   * Persist a full run snapshot; the durable write-before-advance point
   * (Requirement 11.2). The run id is recorded in the index set and added to or
   * removed from the incomplete set based on whether its status is terminal, so
   * `listIncomplete` stays consistent. On any failure the operation rejects with
   * a descriptive {@link PersistenceError} (Requirement 11.5).
   */
  async save(run: WorkflowRun): Promise<void> {
    let json: string;
    try {
      json = serializeRun(run);
    } catch (cause) {
      throw new PersistenceError(
        `Failed to persist workflow run "${run.runId}": the Redis store could not serialize the run snapshot; the last persisted state is unchanged.`,
        { operation: "save", runId: run.runId, cause },
      );
    }
    try {
      await this.client.set(this.runKey(run.runId), json);
      await this.client.sAdd(this.indexKey, run.runId);
      if (TERMINAL.includes(run.status)) {
        await this.client.sRem(this.incompleteKey, run.runId);
      } else {
        await this.client.sAdd(this.incompleteKey, run.runId);
      }
    } catch (cause) {
      throw new PersistenceError(
        `Failed to persist workflow run "${run.runId}": the Redis store rejected the write.`,
        { operation: "save", runId: run.runId, cause },
      );
    }
  }

  /**
   * Load a run by id, or `null` when the id is unknown (Requirement 11.3). Each
   * load parses a fresh object from JSON, so callers can never mutate persisted
   * state through a shared reference.
   */
  async load(runId: string): Promise<WorkflowRun | null> {
    let json: string | null;
    try {
      json = await this.client.get(this.runKey(runId));
    } catch (cause) {
      throw new PersistenceError(
        `Failed to load workflow run "${runId}": the Redis store rejected the read.`,
        { operation: "load", runId, cause },
      );
    }
    if (json === null) {
      return null;
    }
    try {
      return deserializeRun(json);
    } catch (cause) {
      throw new PersistenceError(
        `Failed to load workflow run "${runId}": the persisted snapshot could not be parsed.`,
        { operation: "load", runId, cause },
      );
    }
  }

  /**
   * Append one History event in order to the recorded run (Requirement 21.2).
   * Appending to an unknown run raises a descriptive {@link PersistenceError}
   * rather than silently creating one, mirroring the memory store.
   */
  async append(runId: string, event: HistoryEvent): Promise<void> {
    const existing = await this.load(runId);
    if (existing === null) {
      throw new PersistenceError(
        `Cannot append history to workflow run "${runId}": no such run is persisted.`,
        { operation: "append", runId },
      );
    }
    const updated: WorkflowRun = { ...existing, history: [...existing.history, event] };
    let json: string;
    try {
      json = serializeRun(updated);
    } catch (cause) {
      throw new PersistenceError(
        `Failed to append history to workflow run "${runId}": the Redis store could not serialize the updated snapshot; the last persisted state is unchanged.`,
        { operation: "append", runId, cause },
      );
    }
    try {
      await this.client.set(this.runKey(runId), json);
    } catch (cause) {
      throw new PersistenceError(
        `Failed to append history to workflow run "${runId}": the Redis store rejected the write.`,
        { operation: "append", runId, cause },
      );
    }
  }

  /**
   * Return the runId, definition, and status of every recorded run
   * (Requirements 2.7, 24.3), read from the index set.
   */
  async list(): Promise<readonly WorkflowSummary[]> {
    const ids = await this.client.sMembers(this.indexKey);
    const summaries: WorkflowSummary[] = [];
    for (const id of ids) {
      const run = await this.load(id);
      if (run !== null) {
        summaries.push({ runId: run.runId, definition: run.definition, status: run.status });
      }
    }
    return summaries;
  }

  /**
   * Return all runs not in a terminal {@link RunStatus}, for resume-on-startup
   * (Requirement 13.1). Driven by the incomplete set; the {@link TERMINAL} check
   * is applied again defensively so a stale set entry can never surface a
   * terminal run.
   */
  async listIncomplete(): Promise<readonly WorkflowRun[]> {
    const ids = await this.client.sMembers(this.incompleteKey);
    const incomplete: WorkflowRun[] = [];
    for (const id of ids) {
      const run = await this.load(id);
      if (run !== null && !TERMINAL.includes(run.status)) {
        incomplete.push(run);
      }
    }
    return incomplete;
  }

  /**
   * Best-effort availability probe for the health check (Requirement 21.5).
   * Exercises the client with a cheap set read; any rejection is reported as
   * unavailable rather than thrown.
   */
  async probe(): Promise<StoreProbe> {
    try {
      const ids = await this.client.sMembers(this.indexKey);
      return { available: true, detail: `redis store holding ${ids.length} run(s)` };
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      return { available: false, detail };
    }
  }
}
