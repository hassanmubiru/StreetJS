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
 * Streaming (`putStream` / `getStream`, task 3.2) is implemented over the
 * in-memory buffer using Node stream primitives: `putStream` consumes the
 * supplied `Readable` through a `pipeline` into a collecting `Writable`,
 * assembling the bytes and persisting them with the same computed metadata as
 * `put`; `getStream` returns a `Readable` that emits the stored bytes as a
 * single chunk and throws {@link NotFoundError} for a missing key.
 *
 * _Requirements: 2.1, 3.2, 4.1, 4.2, 4.3, 4.4, 4.9, 4.10, 5.1, 5.2, 5.5, 10.1_
 */

import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { systemClock, type Clock } from "streetjs";

import type {
  MaybeObject,
  NodeReadable,
  StorageDriver,
} from "../driver.js";
import { NotFoundError } from "../errors.js";
import { buildObjectMetadata } from "../metadata.js";
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

    // Assemble the typed field set through the single source of truth so the
    // shape and defaults stay identical across every driver (Requirement 10.1).
    const objectMetadata = buildObjectMetadata({
      key,
      size: stored.byteLength,
      checksum,
      createdAt: existing?.metadata.createdAt ?? now,
      updatedAt: now,
      write: metadata,
    });

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

  // ── Streaming ───────────────────────────────────────────────────────────────

  /**
   * Consume a Node {@link Readable} and persist the assembled bytes under `key`
   * with the same computed metadata as {@link put} (Requirement 5.1).
   *
   * The stream is drained through a `pipeline` into a collecting `Writable`,
   * which gives correct backpressure and propagates read/abort errors (a failed
   * source stream rejects the returned promise and stores nothing). Each chunk
   * is normalized to a `Buffer`; the concatenation is handed to {@link put} so
   * checksum/etag/size/timestamps are computed identically to a buffered write.
   */
  async putStream(
    key: string,
    stream: NodeReadable,
    metadata: WriteMetadata,
  ): Promise<StorageObjectMetadata> {
    const chunks: Buffer[] = [];
    const collector = new Writable({
      write(chunk: unknown, _encoding, callback): void {
        chunks.push(
          Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as Uint8Array),
        );
        callback();
      },
    });

    await pipeline(stream, collector);

    return this.put(key, new Uint8Array(Buffer.concat(chunks)), metadata);
  }

  /**
   * Return a Node {@link Readable} of the stored bytes at `key` (Requirement
   * 5.2). Throws {@link NotFoundError} for a missing key (Requirement 5.5).
   *
   * The stored bytes are copied and wrapped in a single-element array so
   * `Readable.from` emits them as one intact chunk (passing a `Buffer` directly
   * would iterate it byte-by-byte). The copy ensures a consumer draining the
   * stream can never observe or mutate the backing store.
   */
  async getStream(key: string): Promise<NodeReadable> {
    const entry = this.store.get(key);
    if (entry === undefined) {
      throw new NotFoundError(key);
    }
    return Readable.from([Buffer.from(entry.bytes)]);
  }
}

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
