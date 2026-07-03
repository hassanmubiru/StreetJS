/**
 * @streetjs/storage/testing — in-process test doubles (task 25.1).
 *
 * This submodule provides zero-network, in-process test doubles that let
 * application code exercise the storage surface without any external service:
 *
 * - {@link MemoryStorage} — a convenience factory that returns a real
 *   {@link Storage} facade backed by the zero-dependency in-memory driver (via
 *   `createStorage({ provider: "memory", ... })`). Because it is a genuine
 *   facade over {@link MemoryStorageDriver}, it exercises the exact same code
 *   paths as production and is fully substitutable for a production facade
 *   (Requirements 22.2, 22.3).
 * - {@link FakeStorage} — an in-process {@link Storage} double wrapping the
 *   memory-backed facade and adding an advanceable {@link AdvanceableClock} so
 *   tests can deterministically control time-sensitive behavior (signed-URL
 *   expiry, lifecycle age) while remaining drop-in substitutable for the facade
 *   (Requirement 22.3).
 * - {@link StorageHarness} — bundles an advanceable clock, a {@link Storage}
 *   built on that clock, and a set of async assertion helpers for concise
 *   storage tests.
 * - {@link FakeUpload} / {@link FakeDownload} — simple in-process upload and
 *   download doubles for chunked/progress-style flows, backed by any
 *   {@link Storage}.
 * - {@link MemoryStorageDriver} is re-exported so tests that need to substitute
 *   at the {@link StorageDriver} level (rather than the facade level) can do so.
 *
 * None of these require network or external services (Requirement 22.2) and all
 * sit on the same {@link StorageDriver}/{@link Storage} contract as production
 * code (Requirements 22.1, 22.3).
 *
 * The package's `./testing` subpath export maps to this module's built output
 * (`dist/testing/index.js`).
 *
 * _Requirements: 22.1, 22.2, 22.3_
 */

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";

import type { Clock } from "streetjs";

import { createStorage } from "../facade.js";
import type { PutOptions, Storage } from "../facade.js";
import { MemoryStorageDriver } from "../drivers/memory.js";
import { NotFoundError } from "../errors.js";
import type {
  StorageConfig,
  StorageMetadataMap,
  StorageObjectMetadata,
} from "../types.js";

// Re-export the zero-dependency driver so tests can substitute at the driver
// level (Requirement 22.3) in addition to the facade-level doubles below.
export { MemoryStorageDriver } from "../drivers/memory.js";

/** Default signing secret so {@link FakeStorage}/{@link StorageHarness} can mint signed URLs out of the box. */
const DEFAULT_SIGNING_SECRET = "streetjs-storage-testing-secret";

/** Config accepted by the in-process doubles: everything except the fixed provider. */
export type TestingStorageConfig = Omit<StorageConfig, "provider" | "driver">;

// ── Advanceable clock ────────────────────────────────────────────────────────

/**
 * A {@link Clock} (`() => number`) whose value tests can advance or set
 * explicitly. Passed as `config.clock` so every timestamp the storage layer
 * derives (object `createdAt`/`updatedAt`, signed-URL expiry, lifecycle age) is
 * deterministic and controllable from a test.
 */
export interface AdvanceableClock extends Clock {
  /** Return the current epoch-ms reading (same as calling the clock). */
  now(): number;
  /** Set the clock to an absolute epoch-ms value. */
  set(epochMs: number): void;
  /** Advance the clock forward by `deltaMs` milliseconds. */
  advance(deltaMs: number): void;
}

/**
 * Create an {@link AdvanceableClock} starting at `start` (defaults to a fixed,
 * deterministic epoch so tests are reproducible unless they opt into wall
 * time).
 */
export function createAdvanceableClock(start = 1_700_000_000_000): AdvanceableClock {
  let current = start;
  const clock = (() => current) as AdvanceableClock;
  clock.now = () => current;
  clock.set = (epochMs: number) => {
    current = epochMs;
  };
  clock.advance = (deltaMs: number) => {
    current += deltaMs;
  };
  return clock;
}

// ── MemoryStorage ──────────────────────────────────────────────────────────

/**
 * Convenience factory returning a real {@link Storage} facade backed by the
 * zero-dependency {@link MemoryStorageDriver} (via `createStorage`). This is the
 * simplest substitute for a production facade in tests: it needs no network and
 * runs entirely in-process (Requirements 22.2, 22.3).
 *
 * A default `signingSecret` is supplied when none is given so signed-URL helpers
 * work out of the box; any provided config field overrides the defaults.
 */
export function MemoryStorage<T extends StorageMetadataMap = StorageMetadataMap>(
  config: TestingStorageConfig = {},
): Storage<T> {
  return createStorage<T>({
    signingSecret: DEFAULT_SIGNING_SECRET,
    ...config,
    provider: "memory",
  });
}

// ── FakeStorage ──────────────────────────────────────────────────────────────

/**
 * An in-process {@link Storage} double that wraps a memory-backed facade and
 * exposes an advanceable {@link AdvanceableClock}. It implements the full
 * {@link Storage} contract by delegating to the wrapped facade, so it is a
 * drop-in substitute for a production facade (Requirement 22.3) while giving
 * tests deterministic control over time.
 *
 * @typeParam T - Optional per-application custom metadata map.
 */
export class FakeStorage<T extends StorageMetadataMap = StorageMetadataMap>
  implements Storage<T>
{
  /** The advanceable clock backing every timestamp/expiry the double derives. */
  readonly clock: AdvanceableClock;

  /** The wrapped, memory-backed facade every method delegates to. */
  private readonly inner: Storage<T>;

  constructor(config: TestingStorageConfig = {}) {
    this.clock = createAdvanceableClock();
    this.inner = createStorage<T>({
      signingSecret: DEFAULT_SIGNING_SECRET,
      ...config,
      clock: this.clock,
      provider: "memory",
    });
  }

  // ── Object operations ──────────────────────────────────────────────────────
  put(
    key: string,
    content: Uint8Array | string,
    options?: PutOptions,
  ): Promise<StorageObjectMetadata> {
    return this.inner.put(key, content, options);
  }

  get(key: string): ReturnType<Storage<T>["get"]> {
    return this.inner.get(key);
  }

  exists(key: string): Promise<boolean> {
    return this.inner.exists(key);
  }

  delete(key: string): Promise<void> {
    return this.inner.delete(key);
  }

  copy(source: string, destination: string): ReturnType<Storage<T>["copy"]> {
    return this.inner.copy(source, destination);
  }

  move(source: string, destination: string): ReturnType<Storage<T>["move"]> {
    return this.inner.move(source, destination);
  }

  rename(key: string, newKey: string): ReturnType<Storage<T>["rename"]> {
    return this.inner.rename(key, newKey);
  }

  list(prefix: string, options?: Parameters<Storage<T>["list"]>[1]): ReturnType<Storage<T>["list"]> {
    return this.inner.list(prefix, options);
  }

  stat(key: string): Promise<StorageObjectMetadata | null> {
    return this.inner.stat(key);
  }

  // ── Streaming ────────────────────────────────────────────────────────────────
  putStream(
    key: string,
    stream: Parameters<Storage<T>["putStream"]>[1],
    options?: PutOptions,
  ): Promise<StorageObjectMetadata> {
    return this.inner.putStream(key, stream, options);
  }

  getStream(key: string): ReturnType<Storage<T>["getStream"]> {
    return this.inner.getStream(key);
  }

  // ── Multipart ────────────────────────────────────────────────────────────────
  createMultipartUpload(key: string, options?: PutOptions): Promise<string> {
    return this.inner.createMultipartUpload(key, options);
  }

  uploadPart(
    uploadId: string,
    partNumber: number,
    content: Uint8Array,
  ): ReturnType<Storage<T>["uploadPart"]> {
    return this.inner.uploadPart(uploadId, partNumber, content);
  }

  completeMultipartUpload(
    uploadId: string,
    parts: Parameters<Storage<T>["completeMultipartUpload"]>[1],
  ): Promise<StorageObjectMetadata> {
    return this.inner.completeMultipartUpload(uploadId, parts);
  }

  abortMultipartUpload(uploadId: string): Promise<void> {
    return this.inner.abortMultipartUpload(uploadId);
  }

  // ── Resumable ────────────────────────────────────────────────────────────────
  startUpload(key: string, options?: PutOptions): Promise<string> {
    return this.inner.startUpload(key, options);
  }

  resumeUpload(
    sessionId: string,
    stream: Parameters<Storage<T>["resumeUpload"]>[1],
  ): Promise<StorageObjectMetadata> {
    return this.inner.resumeUpload(sessionId, stream);
  }

  cancelUpload(sessionId: string): Promise<void> {
    return this.inner.cancelUpload(sessionId);
  }

  // ── Signed URLs ──────────────────────────────────────────────────────────────
  signedUrl(
    key: string,
    op: Parameters<Storage<T>["signedUrl"]>[1],
    options?: Parameters<Storage<T>["signedUrl"]>[2],
  ): Promise<string> {
    return this.inner.signedUrl(key, op, options);
  }

  // ── Versioning ───────────────────────────────────────────────────────────────
  listVersions(key: string): ReturnType<Storage<T>["listVersions"]> {
    return this.inner.listVersions(key);
  }

  restoreVersion(key: string, versionId: string): Promise<StorageObjectMetadata> {
    return this.inner.restoreVersion(key, versionId);
  }

  deleteVersion(key: string, versionId: string): Promise<void> {
    return this.inner.deleteVersion(key, versionId);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────
  applyLifecycle(
    rule: Parameters<Storage<T>["applyLifecycle"]>[0],
  ): ReturnType<Storage<T>["applyLifecycle"]> {
    return this.inner.applyLifecycle(rule);
  }

  // ── Image processing ─────────────────────────────────────────────────────────
  get images(): Storage<T>["images"] {
    return this.inner.images;
  }

  // ── Directory API ────────────────────────────────────────────────────────────
  get directory(): Storage<T>["directory"] {
    return this.inner.directory;
  }

  // ── Search ───────────────────────────────────────────────────────────────────
  search(
    filters: Parameters<Storage<T>["search"]>[0],
  ): ReturnType<Storage<T>["search"]> {
    return this.inner.search(filters);
  }

  // ── Observability ────────────────────────────────────────────────────────────
  stats(): ReturnType<Storage<T>["stats"]> {
    return this.inner.stats();
  }

  probe(): ReturnType<Storage<T>["probe"]> {
    return this.inner.probe();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  // ── Time control convenience ─────────────────────────────────────────────────
  /** Advance the double's clock forward by `deltaMs` milliseconds. */
  advanceTime(deltaMs: number): void {
    this.clock.advance(deltaMs);
  }

  /** Set the double's clock to an absolute epoch-ms value. */
  setTime(epochMs: number): void {
    this.clock.set(epochMs);
  }
}

// ── StorageHarness ─────────────────────────────────────────────────────────

/**
 * A test harness bundling an advanceable {@link AdvanceableClock}, a
 * {@link Storage} built on that clock, and a set of async assertion helpers for
 * concise, readable storage tests. Everything runs in-process with no network
 * (Requirement 22.2).
 *
 * @typeParam T - Optional per-application custom metadata map.
 */
export class StorageHarness<T extends StorageMetadataMap = StorageMetadataMap> {
  /** The advanceable clock the harness's storage derives all timestamps from. */
  readonly clock: AdvanceableClock;

  /** The memory-backed {@link Storage} under test, wired to {@link clock}. */
  readonly storage: Storage<T>;

  constructor(config: TestingStorageConfig = {}) {
    this.clock = createAdvanceableClock();
    this.storage = createStorage<T>({
      signingSecret: DEFAULT_SIGNING_SECRET,
      ...config,
      clock: this.clock,
      provider: "memory",
    });
  }

  /** Advance the harness clock forward by `deltaMs` milliseconds. */
  advance(deltaMs: number): void {
    this.clock.advance(deltaMs);
  }

  /** Set the harness clock to an absolute epoch-ms value. */
  setTime(epochMs: number): void {
    this.clock.set(epochMs);
  }

  /** Assert an object exists at `key`. */
  async assertExists(key: string): Promise<void> {
    assert.equal(await this.storage.exists(key), true, `expected object to exist at "${key}"`);
  }

  /** Assert no object exists at `key`. */
  async assertMissing(key: string): Promise<void> {
    assert.equal(await this.storage.exists(key), false, `expected no object at "${key}"`);
  }

  /**
   * Assert the object at `key` holds exactly `expected` bytes (a string is
   * compared as its UTF-8 encoding).
   */
  async assertContent(key: string, expected: Uint8Array | string): Promise<void> {
    const result = await this.storage.get(key);
    assert.equal(result.found, true, `expected object to exist at "${key}"`);
    const expectedBytes =
      typeof expected === "string" ? new TextEncoder().encode(expected) : expected;
    assert.deepEqual(
      Buffer.from(result.bytes ?? new Uint8Array()),
      Buffer.from(expectedBytes),
      `content mismatch at "${key}"`,
    );
  }

  /** Assert the stored object at `key` reports exactly `size` bytes. */
  async assertSize(key: string, size: number): Promise<void> {
    const metadata = await this.storage.stat(key);
    assert.notEqual(metadata, null, `expected object to exist at "${key}"`);
    assert.equal(metadata?.size, size, `size mismatch at "${key}"`);
  }

  /** Assert the set of keys under `prefix` equals `expected` (order-insensitive). */
  async assertKeys(prefix: string, expected: readonly string[]): Promise<void> {
    const items = await this.storage.list(prefix);
    const actual = items.map((item) => item.key).sort();
    assert.deepEqual(actual, [...expected].sort(), `key set mismatch under "${prefix}"`);
  }

  /** Release any resources held by the harness's storage. */
  async close(): Promise<void> {
    await this.storage.close();
  }
}

// ── FakeUpload ─────────────────────────────────────────────────────────────

/**
 * A simple in-process upload double for chunked / progress-style flows. Bytes
 * written via {@link FakeUpload.write} are buffered in memory; {@link
 * FakeUpload.complete} persists the assembled bytes to the backing
 * {@link Storage} and returns the resulting metadata. Requires no network
 * (Requirement 22.2).
 */
export class FakeUpload {
  private readonly chunks: Buffer[] = [];
  private completed = false;
  private aborted = false;

  constructor(
    private readonly storage: Storage,
    /** The destination key the completed upload is written to. */
    readonly key: string,
    private readonly options?: PutOptions,
  ) {}

  /** Total number of bytes buffered so far. */
  get bytesWritten(): number {
    return this.chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  }

  /** Whether {@link complete} has already run. */
  get isCompleted(): boolean {
    return this.completed;
  }

  /** Whether the upload was aborted. */
  get isAborted(): boolean {
    return this.aborted;
  }

  /**
   * Buffer another chunk of upload content. A `string` chunk is encoded as
   * UTF-8. Throws if the upload has already completed or been aborted.
   */
  write(chunk: Uint8Array | string): void {
    if (this.completed) {
      throw new Error("FakeUpload: cannot write after complete()");
    }
    if (this.aborted) {
      throw new Error("FakeUpload: cannot write after abort()");
    }
    this.chunks.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : Buffer.from(chunk));
  }

  /**
   * Persist all buffered chunks to the backing storage under {@link key} and
   * return the stored object's metadata. Throws if already completed or aborted.
   */
  async complete(): Promise<StorageObjectMetadata> {
    if (this.completed) {
      throw new Error("FakeUpload: already completed");
    }
    if (this.aborted) {
      throw new Error("FakeUpload: cannot complete an aborted upload");
    }
    this.completed = true;
    const bytes = new Uint8Array(Buffer.concat(this.chunks));
    return this.storage.put(this.key, bytes, this.options);
  }

  /** Discard buffered content; nothing is persisted. */
  abort(): void {
    this.aborted = true;
    this.chunks.length = 0;
  }
}

// ── FakeDownload ───────────────────────────────────────────────────────────

/**
 * A simple in-process download double. Reads the object at `key` from the
 * backing {@link Storage} and exposes its content as bytes, text, or an async
 * chunk iterator. Requires no network (Requirement 22.2).
 */
export class FakeDownload {
  constructor(
    private readonly storage: Storage,
    /** The source key this download reads from. */
    readonly key: string,
  ) {}

  /** Whether an object currently exists at {@link key}. */
  found(): Promise<boolean> {
    return this.storage.exists(this.key);
  }

  /**
   * Read and return the full object bytes. Throws {@link NotFoundError} when no
   * object exists at {@link key}.
   */
  async bytes(): Promise<Uint8Array> {
    const result = await this.storage.get(this.key);
    if (!result.found || result.bytes === undefined) {
      throw new NotFoundError(this.key);
    }
    return result.bytes;
  }

  /** Read the full object content decoded as a UTF-8 string. */
  async text(): Promise<string> {
    return Buffer.from(await this.bytes()).toString("utf8");
  }

  /**
   * Yield the object content in fixed-size chunks of at most `chunkSize` bytes,
   * simulating a streamed download. Throws {@link NotFoundError} when absent.
   */
  async *chunks(chunkSize = 64 * 1024): AsyncGenerator<Uint8Array> {
    if (chunkSize <= 0) {
      throw new Error("FakeDownload: chunkSize must be a positive integer");
    }
    const bytes = await this.bytes();
    for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
      yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
    }
  }
}
