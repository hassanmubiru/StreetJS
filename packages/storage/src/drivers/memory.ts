/**
 * @streetjs/storage — MemoryStorageDriver (zero-dependency).
 *
 * An in-memory implementation of the {@link StorageDriver} contract backed by a
 * `Map<string, StoredEntry>` where every entry holds the object's `Uint8Array`
 * bytes plus its computed {@link StorageObjectMetadata}. It requires no external
 * runtime dependency (Requirement 3.2), making it ideal for tests and the
 * example app while exercising the exact same facade code paths the cloud
 * drivers use.
 *
 * This module (task 3.1) implements the mandatory primitive object operations:
 * `put` / `get` / `exists` / `delete` / `stat` / `list`. Object identity fields
 * (`etag`, `checksum`, `size`) and timestamps (`createdAt` / `updatedAt`) are
 * computed at write time — the checksum/etag are the sha-256 hex digest of the
 * stored bytes (via `node:crypto`), the size is the byte length, and timestamps
 * come from an injected {@link Clock} (default `systemClock` from `streetjs`) so
 * time is deterministic in tests.
 *
 * NOTE: Streaming (`putStream` / `getStream`) is refined by task 3.2. To keep
 * the class satisfying the full `StorageDriver` interface so `tsc` compiles, this
 * file provides working implementations layered trivially over `put` / `get`
 * (buffer the stream into memory, emit the stored bytes as a `Readable`). Task
 * 3.2 replaces/hardens these with the streaming-specific behavior and tests.
 *
 * _Requirements: 2.1, 3.2, 4.1, 4.2, 4.3, 4.4, 4.9, 4.10, 10.1_
 */

import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { systemClock, type Clock } from "streetjs";

import type {
  MaybeObject,
  NodeReadable,
  StorageDriver,
} from "../driver.js";
import { NotFoundError } from "../errors.js";
import type {
  ListOptions,
  StorageListItem,
  StorageObjectMetadata,
  WriteMetadata,
} from "../types.js";

/** A single stored object: its bytes plus computed metadata. */
interface StoredEntry {
  readonly bytes: Uint8Array;
  readonly metadata: StorageObjectMetadata;
}

/** Options for constructing a {@link MemoryStorageDriver}. */
export interface MemoryStorageDriverOptions {
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
}

/** Default content type applied when a write does not specify one. */
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** Default access level applied when a write does not specify one. */
const DEFAULT_ACCESS_LEVEL = "private" as const;

/**
 * Zero-dependency in-memory {@link StorageDriver}.
 *
 * Backed by a `Map<string, StoredEntry>`. All bytes are copied on the way in and
 * on the way out so external mutation of a caller's buffer never corrupts stored
 * content and vice versa.
 */
export class MemoryStorageDriver implements StorageDriver {
  /** Stable driver name. */
  readonly name = "memory";

  /** Backing store: key → stored bytes + metadata. */
  private readonly store = new Map<string, StoredEntry>();

  /** Injected clock used for `createdAt` / `updatedAt` timestamps. */
  private readonly clock: Clock;

  constructor(options: MemoryStorageDriverOptions = {}) {
    this.clock = options.clock ?? systemClock;
  }

  // ── Mandatory primitives ──────────────────────────────────────────────────

  /**
   * Persist `bytes` under `key`, computing size, sha-256 checksum/etag, and
   * timestamps. When overwriting an existing key, the original `createdAt` is
   * preserved and only `updatedAt` advances (Requirements 4.1, 10.1).
   */
  async put(
    key: string,
    bytes: Uint8Array,
    metadata: WriteMetadata,
  ): Promise<StorageObjectMetadata> {
    // Copy defensively so later mutation of the caller's buffer cannot alter
    // what we stored.
    const stored = bytes.slice();
    const checksum = sha256Hex(stored);
    const now = this.clock();
    const existing = this.store.get(key);

    const objectMetadata: StorageObjectMetadata = {
      key,
      size: stored.byteLength,
      contentType: metadata.contentType ?? DEFAULT_CONTENT_TYPE,
      etag: checksum,
      checksum,
      owner: metadata.owner,
      tenant: metadata.tenant,
      accessLevel: metadata.accessLevel ?? DEFAULT_ACCESS_LEVEL,
      createdAt: existing?.metadata.createdAt ?? now,
      updatedAt: now,
      custom: metadata.custom ?? {},
    };

    this.store.set(key, { bytes: stored, metadata: objectMetadata });
    return objectMetadata;
  }

  /**
   * Read the object at `key`. Returns a discriminated {@link MaybeObject} so
   * absence is reported consistently rather than thrown (Requirements 4.2, 2.4).
   * The returned bytes are a copy of the stored content.
   */
  async get(key: string): Promise<MaybeObject> {
    const entry = this.store.get(key);
    if (entry === undefined) {
      return { found: false };
    }
    return { found: true, bytes: entry.bytes.slice(), metadata: entry.metadata };
  }

  /** Report whether an object is stored under `key` (Requirement 4.3). */
  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /**
   * Remove the object at `key`. Deleting a missing key is a no-op so that a
   * subsequent `exists` returns false either way (Requirement 4.4).
   */
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Return the metadata for `key` without its content, or `null` if absent
   * (Requirement 4.10).
   */
  async stat(key: string): Promise<StorageObjectMetadata | null> {
    return this.store.get(key)?.metadata ?? null;
  }

  /**
   * Return list items for every key beginning with `prefix`, sorted by key for
   * deterministic ordering (Requirement 4.9). Honors optional `cursor`
   * (exclusive resume point), `limit`, and `delimiter` (collapse to immediate
   * children on `/`) when supplied.
   */
  async list(prefix: string, options?: ListOptions): Promise<StorageListItem[]> {
    const cursor = options?.cursor;
    const useDelimiter = options?.delimiter === true;

    let matchedKeys = [...this.store.keys()]
      .filter((key) => key.startsWith(prefix))
      .sort();

    if (cursor !== undefined) {
      matchedKeys = matchedKeys.filter((key) => key > cursor);
    }

    const items: StorageListItem[] = [];
    const seenChildren = new Set<string>();

    for (const key of matchedKeys) {
      if (useDelimiter) {
        // Collapse to the immediate child segment under the prefix.
        const rest = key.slice(prefix.length);
        const slashIndex = rest.indexOf("/");
        if (slashIndex !== -1) {
          const child = prefix + rest.slice(0, slashIndex + 1);
          if (seenChildren.has(child)) {
            continue;
          }
          seenChildren.add(child);
        }
      }

      const entry = this.store.get(key);
      if (entry === undefined) {
        continue;
      }
      items.push({
        key,
        size: entry.metadata.size,
        updatedAt: entry.metadata.updatedAt,
      });

      if (options?.limit !== undefined && items.length >= options.limit) {
        break;
      }
    }

    return items;
  }

  // ── Streaming (placeholder; refined by task 3.2) ────────────────────────────

  /**
   * Persist a streamed upload. Implemented here trivially over {@link put} by
   * buffering the stream into memory; task 3.2 refines this with proper
   * streaming semantics (Requirement 5.1).
   */
  async putStream(
    key: string,
    stream: NodeReadable,
    metadata: WriteMetadata,
  ): Promise<StorageObjectMetadata> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return this.put(key, new Uint8Array(Buffer.concat(chunks)), metadata);
  }

  /**
   * Return a readable stream of the object at `key`. Implemented here trivially
   * over {@link get} by emitting the stored bytes; task 3.2 refines this with
   * proper streaming semantics. Throws {@link NotFoundError} for a missing key
   * (Requirement 5.2, 5.5).
   */
  async getStream(key: string): Promise<NodeReadable> {
    const result = await this.get(key);
    if (!result.found) {
      throw new NotFoundError(key);
    }
    return Readable.from(Buffer.from(result.bytes));
  }
}

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
