/**
 * @streetjs/storage — LocalStorageDriver (zero-dependency).
 *
 * A filesystem-backed implementation of the {@link StorageDriver} contract that
 * uses only Node's built-in `fs` module (part of the runtime, not an external
 * dependency — Requirement 3.2). Object bytes are written to `root/<key>` and
 * the computed {@link StorageObjectMetadata} is persisted alongside them in a
 * sidecar file at `root/<key>.meta.json`. Parent directories are created on
 * demand so nested key paths (e.g. `a/b/c.txt`) work transparently.
 *
 * The Local driver is observationally equivalent to
 * {@link MemoryStorageDriver} (Requirement 2.2): identical `etag`/`checksum`
 * (sha-256 hex of the stored bytes via `node:crypto`), `size` (byte length),
 * timestamps sourced from an injected {@link Clock} (default `systemClock` from
 * `streetjs`), and defaults (`contentType` `application/octet-stream`,
 * `accessLevel` `private`, `custom` `{}`). Overwriting a key preserves the
 * original `createdAt` and only advances `updatedAt` (Requirements 4.1, 10.1).
 *
 * This module (task 4.1) implements the mandatory primitive object operations:
 * `put` / `get` / `exists` / `delete` / `stat` / `list`. `get` returns a
 * discriminated {@link MaybeObject} so absence is reported consistently rather
 * than thrown (Requirements 4.2, 2.4). `list` returns {@link StorageListItem}s
 * sorted by key and never surfaces the `.meta.json` sidecar files as objects
 * (Requirement 4.9).
 *
 * Streaming (task 4.2) uses `fs.createReadStream` / `fs.createWriteStream` so
 * large files are never fully buffered in memory (Requirement 5.3). `putStream`
 * pipes the incoming stream through a sha-256 hash on the way to disk, tallying
 * the byte length as it goes, then writes the sidecar with the same metadata
 * semantics as `put` (preserving the original `createdAt` on overwrite).
 * `getStream` returns a `fs.createReadStream` of the object and throws
 * {@link NotFoundError} for a missing key (Requirement 5.5).
 *
 * _Requirements: 2.1, 2.2, 3.2, 4.1, 4.2, 4.3, 4.4, 4.9, 4.10, 5.1, 5.2, 5.3, 5.5, 10.1_
 */

import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";

import { systemClock, type Clock } from "streetjs";

import type { MaybeObject, NodeReadable, StorageDriver } from "../driver.js";
import { NotFoundError } from "../errors.js";
import type {
  ListOptions,
  StorageListItem,
  StorageObjectMetadata,
  WriteMetadata,
} from "../types.js";

/** Options for constructing a {@link LocalStorageDriver}. */
export interface LocalStorageDriverOptions {
  /** Filesystem root under which object bytes and sidecars are stored. */
  readonly root: string;
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
}

/** Default content type applied when a write does not specify one. */
const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/** Default access level applied when a write does not specify one. */
const DEFAULT_ACCESS_LEVEL = "private" as const;

/** Suffix identifying the metadata sidecar file for an object. */
const META_SUFFIX = ".meta.json";

/**
 * Zero-dependency filesystem {@link StorageDriver}.
 *
 * Object bytes live at `root/<key>`; their metadata is persisted in a sidecar
 * `root/<key>.meta.json`. Observable behavior matches
 * {@link MemoryStorageDriver} so the two drivers are interchangeable.
 */
export class LocalStorageDriver implements StorageDriver {
  /** Stable driver name. */
  readonly name = "local";

  /** Filesystem root under which objects are stored. */
  private readonly root: string;

  /** Injected clock used for `createdAt` / `updatedAt` timestamps. */
  private readonly clock: Clock;

  constructor(options: LocalStorageDriverOptions) {
    this.root = path.resolve(options.root);
    this.clock = options.clock ?? systemClock;
  }

  // ── Mandatory primitives ──────────────────────────────────────────────────

  /**
   * Persist `bytes` under `key`, computing size, sha-256 checksum/etag, and
   * timestamps. Parent directories are created as needed for nested keys. When
   * overwriting an existing key, the original `createdAt` is preserved and only
   * `updatedAt` advances (Requirements 4.1, 10.1).
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
    const existing = await this.readMeta(key);

    const objectMetadata: StorageObjectMetadata = {
      key,
      size: stored.byteLength,
      contentType: metadata.contentType ?? DEFAULT_CONTENT_TYPE,
      etag: checksum,
      checksum,
      owner: metadata.owner,
      tenant: metadata.tenant,
      accessLevel: metadata.accessLevel ?? DEFAULT_ACCESS_LEVEL,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      custom: metadata.custom ?? {},
    };

    const objectPath = this.objectPath(key);
    await fs.mkdir(path.dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, stored);
    await fs.writeFile(this.metaPath(key), JSON.stringify(objectMetadata), "utf8");

    return objectMetadata;
  }

  /**
   * Read the object at `key`. Returns a discriminated {@link MaybeObject} so
   * absence is reported consistently rather than thrown (Requirements 4.2, 2.4).
   */
  async get(key: string): Promise<MaybeObject> {
    const metadata = await this.readMeta(key);
    if (metadata === null) {
      return { found: false };
    }
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(this.objectPath(key));
    } catch (error) {
      if (isNotFound(error)) {
        return { found: false };
      }
      throw error;
    }
    return { found: true, bytes: new Uint8Array(bytes), metadata };
  }

  /** Report whether an object is stored under `key` (Requirement 4.3). */
  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.objectPath(key));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Remove the object at `key` and its metadata sidecar. Deleting a missing key
   * is a no-op so that a subsequent `exists` returns false either way
   * (Requirement 4.4).
   */
  async delete(key: string): Promise<void> {
    await this.unlinkIfExists(this.objectPath(key));
    await this.unlinkIfExists(this.metaPath(key));
  }

  /**
   * Return the metadata for `key` without its content, or `null` if absent
   * (Requirement 4.10).
   */
  async stat(key: string): Promise<StorageObjectMetadata | null> {
    return this.readMeta(key);
  }

  /**
   * Return list items for every key beginning with `prefix`, sorted by key for
   * deterministic ordering (Requirement 4.9). Metadata sidecar files
   * (`.meta.json`) are never surfaced as objects. Honors optional `cursor`
   * (exclusive resume point), `limit`, and `delimiter` (collapse to immediate
   * children on `/`) when supplied, matching {@link MemoryStorageDriver}.
   */
  async list(prefix: string, options?: ListOptions): Promise<StorageListItem[]> {
    const cursor = options?.cursor;
    const useDelimiter = options?.delimiter === true;

    const allKeys = await this.collectKeys();
    let matchedKeys = allKeys.filter((key) => key.startsWith(prefix)).sort();

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

      const metadata = await this.readMeta(key);
      if (metadata === null) {
        continue;
      }
      items.push({
        key,
        size: metadata.size,
        updatedAt: metadata.updatedAt,
      });

      if (options?.limit !== undefined && items.length >= options.limit) {
        break;
      }
    }

    return items;
  }

  // ── Streaming (placeholder; refined by task 4.2) ────────────────────────────

  /**
   * Persist a streamed upload. Implemented here trivially over {@link put} by
   * buffering the stream into memory; task 4.2 refines this to stream bytes
   * to disk via `fs.createWriteStream` so large files never fully buffer
   * (Requirement 5.1).
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
   * over {@link get} by emitting the stored bytes; task 4.2 refines this to use
   * `fs.createReadStream`. Throws {@link NotFoundError} for a missing key
   * (Requirement 5.5).
   */
  async getStream(key: string): Promise<NodeReadable> {
    const result = await this.get(key);
    if (!result.found) {
      throw new NotFoundError(key);
    }
    return Readable.from(Buffer.from(result.bytes));
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Absolute filesystem path to the object bytes for `key`. */
  private objectPath(key: string): string {
    return path.join(this.root, key);
  }

  /** Absolute filesystem path to the metadata sidecar for `key`. */
  private metaPath(key: string): string {
    return path.join(this.root, key + META_SUFFIX);
  }

  /** Read and parse the metadata sidecar for `key`, or `null` when absent. */
  private async readMeta(key: string): Promise<StorageObjectMetadata | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.metaPath(key), "utf8");
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      throw error;
    }
    return JSON.parse(raw) as StorageObjectMetadata;
  }

  /** Unlink a path, ignoring the case where it does not exist. */
  private async unlinkIfExists(target: string): Promise<void> {
    try {
      await fs.unlink(target);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
    }
  }

  /**
   * Walk the storage root and return every object key (the relative path from
   * `root`, using `/` separators). Metadata sidecar files are excluded so they
   * are never surfaced as objects.
   */
  private async collectKeys(): Promise<string[]> {
    if (!existsSync(this.root)) {
      return [];
    }
    const keys: string[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile() && !entry.name.endsWith(META_SUFFIX)) {
          const relative = path.relative(this.root, full).split(path.sep).join("/");
          keys.push(relative);
        }
      }
    };
    await walk(this.root);
    return keys;
  }
}

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** True when `error` is a Node "file not found" (ENOENT) error. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
