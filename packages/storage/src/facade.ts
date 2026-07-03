/**
 * @streetjs/storage — the storage facade and configuration-driven construction.
 *
 * Application code talks only to the {@link Storage} facade returned by
 * {@link createStorage}. The facade presents one public surface that is
 * identical no matter which {@link StorageDriver} backs it, delegating the
 * actual byte persistence to the driver while running (in later tasks) the
 * cross-cutting layers (validation, access control, versioning, lifecycle,
 * streaming/multipart/resumable sessions, signed URLs, images, directory,
 * search, observability, integration bridges).
 *
 * This module (task 5.1) implements **construction and provider selection**:
 *
 * - A built-in driver registry resolves the zero-dependency providers `memory`
 *   ({@link MemoryStorageDriver}) and `local` ({@link LocalStorageDriver},
 *   which requires `config.root`).
 * - Cloud providers are supplied as an already-constructed `config.driver`
 *   instance (imported from the relevant submodule), which takes precedence and
 *   works for any provider name.
 * - An unknown provider name with no supplied driver yields a descriptive
 *   {@link StorageConfigError} and **no** {@link Storage} instance is produced
 *   (Requirement 1.5). Because the error is simply thrown (never caught and
 *   swallowed into a fabricated instance), if constructing the error object
 *   itself fails for some unexpected internal reason, that internal failure
 *   surfaces as a thrown error and, again, no instance is produced
 *   (Requirement 1.6).
 *
 * The object-operation method bodies (`put`/`get`/`exists`/`delete`/`copy`/
 * `move`/`rename`/`list`/`stat`), streaming, multipart, resumable, signed URLs,
 * versioning, images, directory, search, and observability are implemented in
 * later tasks (5.2 onward). They are stubbed here so the file compiles, while
 * the facade is structured as a class holding the resolved `driver` + `config`
 * so those tasks can fill in the behavior cleanly.
 *
 * _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6_
 */

import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

import type { NodeReadable, StorageDriver, StoredPart } from "./driver.js";
import { MemoryStorageDriver } from "./drivers/memory.js";
import { LocalStorageDriver } from "./drivers/local.js";
import { StorageConfigError, ValidationError } from "./errors.js";
import { normalizeMetadata, toWriteMetadata } from "./metadata.js";
import { ValidationPipeline } from "./validation.js";
import type {
  ValidationInput,
  CopyResult,
  GetResult,
  ListOptions,
  MoveResult,
  SearchFilters,
  SignedOperation,
  SignedUrlOptions,
  StorageConfig,
  StorageListItem,
  StorageMetadataMap,
  StorageObjectMetadata,
  StorageStats,
  DriverProbe,
  VersionInfo,
  WriteMetadata,
} from "./types.js";

// ── Facade option / helper types ──────────────────────────────────────────────

/**
 * Options accepted by write operations (`put`/`putStream`/`createMultipartUpload`/
 * `startUpload`). These are the write-time metadata fields carried onto the
 * stored object (Requirement 4.1). Additional write-time concerns (validation
 * overrides, versioning toggles) are layered on by later tasks.
 */
export interface PutOptions extends WriteMetadata {}

/**
 * Placeholder for the image processing surface exposed as `storage.images`.
 *
 * The full {@link ImageProcessor} is implemented in `src/image.ts` (task 19),
 * at which point this facade imports it from that module. It is declared here
 * only so the {@link Storage} interface type-checks in the interim.
 */
export interface ImageProcessor {
  transform(key: string, operations: Record<string, unknown>): Promise<StorageObjectMetadata>;
}

/**
 * Placeholder for the directory surface exposed as `storage.directory`.
 *
 * The full {@link DirectoryApi} is implemented in `src/directory.ts` (task 17),
 * at which point this facade imports it from that module. It is declared here
 * only so the {@link Storage} interface type-checks in the interim.
 */
export interface DirectoryApi {
  mkdir(path: string): Promise<void>;
  listDirectory(path: string): Promise<StorageListItem[]>;
  removeDirectory(path: string): Promise<{ readonly removed: boolean }>;
  walk(path: string): Promise<string[]>;
}

// ── The public facade interface ────────────────────────────────────────────────

/**
 * The single public storage surface. Every method signature is identical across
 * all providers so switching the configured driver never changes application
 * code (Requirement 1.4). Backed by exactly one {@link StorageDriver}.
 *
 * @typeParam T - Optional per-application custom metadata map.
 */
export interface Storage<T extends StorageMetadataMap = StorageMetadataMap> {
  // Object operations (Requirement 4)
  put(key: string, content: Uint8Array | string, options?: PutOptions): Promise<StorageObjectMetadata>;
  get(key: string): Promise<GetResult>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  copy(source: string, destination: string): Promise<CopyResult>;
  move(source: string, destination: string): Promise<MoveResult>;
  rename(key: string, newKey: string): Promise<MoveResult>;
  list(prefix: string, options?: ListOptions): Promise<StorageListItem[]>;
  stat(key: string): Promise<StorageObjectMetadata | null>;

  // Streaming (Requirement 5)
  putStream(key: string, stream: NodeReadable, options?: PutOptions): Promise<StorageObjectMetadata>;
  getStream(key: string): Promise<NodeReadable>;

  // Multipart (Requirement 6)
  createMultipartUpload(key: string, options?: PutOptions): Promise<string>;
  uploadPart(uploadId: string, partNumber: number, content: Uint8Array): Promise<StoredPart>;
  completeMultipartUpload(uploadId: string, parts: readonly StoredPart[]): Promise<StorageObjectMetadata>;
  abortMultipartUpload(uploadId: string): Promise<void>;

  // Resumable (Requirement 7)
  startUpload(key: string, options?: PutOptions): Promise<string>;
  resumeUpload(sessionId: string, stream: NodeReadable): Promise<StorageObjectMetadata>;
  cancelUpload(sessionId: string): Promise<void>;

  // Signed URLs (Requirement 8)
  signedUrl(key: string, op: SignedOperation, options?: SignedUrlOptions): Promise<string>;

  // Versioning (Requirement 12)
  listVersions(key: string): Promise<VersionInfo[]>;
  restoreVersion(key: string, versionId: string): Promise<StorageObjectMetadata>;
  deleteVersion(key: string, versionId: string): Promise<void>;

  // Image processing (Requirement 14)
  readonly images: ImageProcessor;

  // Directory API (Requirement 15)
  readonly directory: DirectoryApi;

  // Search (Requirement 16)
  search(filters: SearchFilters): Promise<StorageListItem[]>;

  // Observability (Requirement 23)
  stats(): StorageStats;
  probe(): Promise<DriverProbe>;

  close(): Promise<void>;
}

// ── Built-in driver registry ────────────────────────────────────────────────

/** A factory that constructs a built-in zero-dependency driver from config. */
type BuiltInDriverFactory = (config: StorageConfig) => StorageDriver;

/**
 * The built-in, zero-dependency provider registry (Requirement 1.2). Cloud
 * providers are never listed here — they are supplied as a pre-constructed
 * `config.driver` instead (see {@link resolveDriver}).
 */
const BUILT_IN_DRIVERS: Readonly<Record<string, BuiltInDriverFactory>> = {
  memory: (config) => new MemoryStorageDriver({ clock: config.clock }),
  local: (config) => {
    if (config.root === undefined || config.root === "") {
      throw new StorageConfigError(
        'The "local" storage provider requires a "root" directory in its configuration.',
        { provider: "local" },
      );
    }
    return new LocalStorageDriver({ root: config.root, clock: config.clock });
  },
};

/**
 * Resolve the {@link StorageDriver} for the given configuration.
 *
 * Precedence:
 * 1. A pre-constructed `config.driver` (used for cloud providers imported from
 *    submodules) is used as-is, regardless of the `provider` name.
 * 2. Otherwise the `provider` name is looked up in the built-in registry and the
 *    corresponding zero-dependency driver is constructed.
 * 3. If the `provider` name is unknown and no `driver` was supplied, a
 *    descriptive {@link StorageConfigError} is thrown and no driver (and hence
 *    no {@link Storage} instance) is produced (Requirement 1.5).
 *
 * The error is thrown, never caught-and-swallowed, so an unexpected failure
 * while constructing the error object itself simply propagates as a thrown
 * internal error — neither an instance nor a fabricated error is returned
 * (Requirement 1.6).
 */
function resolveDriver(config: StorageConfig): StorageDriver {
  if (config.driver !== undefined) {
    return config.driver;
  }

  const factory = BUILT_IN_DRIVERS[config.provider];
  if (factory !== undefined) {
    return factory(config);
  }

  throw new StorageConfigError(
    `Unknown storage provider "${config.provider}". Provide a built-in provider ` +
      `("memory" or "local"), or supply a pre-constructed "driver" for cloud providers.`,
    { provider: config.provider },
  );
}

// ── Facade implementation ──────────────────────────────────────────────────

/**
 * Concrete {@link Storage} implementation holding the resolved {@link StorageDriver}
 * and the originating {@link StorageConfig}. Task 5.1 wires construction and
 * provider selection; the object-operation, streaming, multipart, resumable,
 * signed-URL, versioning, image, directory, search, and observability method
 * bodies are filled in by later tasks. Until then the not-yet-implemented
 * methods throw a clear, descriptive error.
 */
class StorageFacade<T extends StorageMetadataMap = StorageMetadataMap> implements Storage<T> {
  /** The resolved driver every operation delegates byte persistence to. */
  protected readonly driver: StorageDriver;

  /** The configuration this facade was constructed with. */
  protected readonly config: StorageConfig;

  /**
   * The pre-persistence validation pipeline, present only when
   * `config.validation` is supplied. When defined it is run as the first step
   * of every write so a rejection aborts the write before any bytes reach the
   * driver, leaving no partial object stored (Requirements 9.3, 9.4).
   */
  protected readonly validation?: ValidationPipeline;

  constructor(driver: StorageDriver, config: StorageConfig) {
    this.driver = driver;
    this.config = config;
    this.validation =
      config.validation !== undefined ? new ValidationPipeline(config.validation) : undefined;
  }

  /**
   * Run the validation pipeline (when configured) against `input` and throw a
   * {@link ValidationError} on rejection. This is invoked before any call to
   * `driver.put`, so a rejected upload never persists content (Requirement
   * 9.3) and leaves no partial object behind (Requirement 9.4). When no
   * validation is configured this is a no-op.
   */
  protected async runValidation(input: ValidationInput): Promise<void> {
    if (this.validation === undefined) {
      return;
    }
    const result = await this.validation.validate(input);
    if (!result.ok) {
      throw new ValidationError(result.error ?? "upload rejected by validation", {
        key: input.key,
      });
    }
  }

  // ── Object operations (task 5.2) ────────────────────────────────────────────

  /**
   * Persist `content` under `key` and return the resulting metadata
   * (Requirement 4.1). A `string` payload is encoded as UTF-8 bytes before it
   * reaches the driver so all providers store and hash the identical byte
   * sequence; a `Uint8Array` is passed through untouched. Write-time metadata in
   * `options` (content type, owner, tenant, access level, custom fields) is
   * forwarded to the driver, which computes `etag`/`checksum`/`size`/timestamps.
   */
  async put(
    key: string,
    content: Uint8Array | string,
    options?: PutOptions,
  ): Promise<StorageObjectMetadata> {
    const bytes = typeof content === "string" ? encodeUtf8(content) : content;
    // Validate the fully-known size/contentType/checksum BEFORE any persistence
    // so a rejection aborts the write with no partial object stored (Req 9.3/9.4).
    await this.runValidation({
      key,
      size: bytes.byteLength,
      contentType: options?.contentType,
      checksum: sha256Hex(bytes),
      metadata: options,
    });
    // Surface the complete, typed metadata field set (Requirement 10.1) through
    // the single source of truth so the shape is consistent across drivers.
    return normalizeMetadata(await this.driver.put(key, bytes, options ?? {}));
  }

  /**
   * Read the object at `key`, converting the driver's discriminated
   * {@link MaybeObject} into the facade {@link GetResult} shape (Requirement
   * 4.2). A present object yields `{ found: true, bytes, metadata }` with the
   * stored bytes returned unchanged; an absent one yields `{ found: false }`
   * without throwing.
   */
  async get(key: string): Promise<GetResult> {
    const result = await this.driver.get(key);
    if (result.found) {
      return { found: true, bytes: result.bytes, metadata: result.metadata };
    }
    return { found: false };
  }

  /** Report whether an object is stored under `key` (Requirement 4.3). */
  async exists(key: string): Promise<boolean> {
    return this.driver.exists(key);
  }

  /**
   * Remove the object at `key` so a subsequent `exists` returns false
   * (Requirement 4.4). Deleting a missing key is a no-op at the driver level.
   */
  async delete(key: string): Promise<void> {
    await this.driver.delete(key);
  }

  /**
   * Copy the object at `source` to `destination` (Requirement 4.5). The copy is
   * **non-mutating**: the source is read and its content plus metadata are
   * written to the destination, and the source object is never touched. When
   * `source` does not exist, no write occurs and a not-found result
   * (`{ copied: false }`) is returned without throwing (Requirement 4.6).
   */
  async copy(source: string, destination: string): Promise<CopyResult> {
    const result = await this.driver.get(source);
    if (!result.found) {
      return { copied: false };
    }
    const metadata = await this.driver.put(
      destination,
      result.bytes,
      toWriteMetadata(result.metadata),
    );
    return { copied: true, metadata };
  }

  /**
   * Move the object at `source` to `destination` (Requirements 4.7). The source
   * content is written to the destination and then the source object is
   * removed. When `source` does not exist, no operation is performed and a
   * not-found result (`{ moved: false }`) is returned without throwing.
   */
  async move(source: string, destination: string): Promise<MoveResult> {
    const result = await this.driver.get(source);
    if (!result.found) {
      return { moved: false };
    }
    const metadata = await this.driver.put(
      destination,
      result.bytes,
      toWriteMetadata(result.metadata),
    );
    await this.driver.delete(source);
    return { moved: true, metadata };
  }

  /**
   * Rename the object at `key` to `newKey` (Requirement 4.8). This has the same
   * semantics as {@link move}: the content becomes available under `newKey` and
   * the old key is removed; a missing source yields `{ moved: false }` without
   * throwing.
   */
  async rename(key: string, newKey: string): Promise<MoveResult> {
    return this.move(key, newKey);
  }

  /**
   * Return the keys (with size/timestamp) of objects whose keys begin with
   * `prefix`, delegating directly to the driver (Requirement 4.9).
   */
  async list(prefix: string, options?: ListOptions): Promise<StorageListItem[]> {
    return this.driver.list(prefix, options);
  }

  /**
   * Return the metadata for `key` without its content, or `null` if absent
   * (Requirement 4.10).
   */
  async stat(key: string): Promise<StorageObjectMetadata | null> {
    return this.driver.stat(key);
  }

  // ── Streaming (task 7.1) ─────────────────────────────────────────────────────

  /**
   * Persist the content read from a Node {@link NodeReadable} under `key` and
   * return the resulting metadata (Requirement 5.1). The stream is forwarded
   * directly to the driver's streaming primitive along with the write-time
   * metadata in `options` (content type, owner, tenant, access level, custom
   * fields); the driver pipes the content through to storage and never buffers
   * the complete object in memory (Requirement 5.3), which is what lets large
   * files transfer without loading fully into memory.
   */
  async putStream(
    key: string,
    stream: NodeReadable,
    options?: PutOptions,
  ): Promise<StorageObjectMetadata> {
    // With no validation configured, stream straight through the driver so large
    // files never fully buffer (Requirement 5.3).
    if (this.validation === undefined) {
      return this.driver.putStream(key, stream, options ?? {});
    }
    // With validation configured, size and checksum can only be known once the
    // full stream is collected. We buffer the stream, validate the complete
    // input, and only then persist via `driver.put`. Because the driver is not
    // touched until validation passes, a rejection leaves no partial object
    // stored (Requirement 9.4); persistence still happens as a single atomic
    // write on success (Requirement 9.3).
    const bytes = await collectStream(stream);
    await this.runValidation({
      key,
      size: bytes.byteLength,
      contentType: options?.contentType,
      checksum: sha256Hex(bytes),
      metadata: options,
    });
    return this.driver.put(key, bytes, options ?? {});
  }

  /**
   * Return a Node {@link NodeReadable} of the content stored at `key`
   * (Requirement 5.2). The stream is produced by the driver's streaming
   * primitive so bytes are pulled incrementally rather than buffered in full
   * (Requirement 5.3), and piping it to a Node Writable delivers the stored
   * bytes unchanged (Requirement 5.4). When `key` does not exist the driver
   * throws {@link NotFoundError}, which propagates unchanged to the caller
   * (Requirement 5.5).
   */
  async getStream(key: string): Promise<NodeReadable> {
    return this.driver.getStream(key);
  }

  // ── Multipart (task 10.1) ────────────────────────────────────────────────────
  createMultipartUpload(_key: string, _options?: PutOptions): Promise<string> {
    return notImplemented("createMultipartUpload");
  }
  uploadPart(_uploadId: string, _partNumber: number, _content: Uint8Array): Promise<StoredPart> {
    return notImplemented("uploadPart");
  }
  completeMultipartUpload(_uploadId: string, _parts: readonly StoredPart[]): Promise<StorageObjectMetadata> {
    return notImplemented("completeMultipartUpload");
  }
  abortMultipartUpload(_uploadId: string): Promise<void> {
    return notImplemented("abortMultipartUpload");
  }

  // ── Resumable (task 11.1) ────────────────────────────────────────────────────
  startUpload(_key: string, _options?: PutOptions): Promise<string> {
    return notImplemented("startUpload");
  }
  resumeUpload(_sessionId: string, _stream: NodeReadable): Promise<StorageObjectMetadata> {
    return notImplemented("resumeUpload");
  }
  cancelUpload(_sessionId: string): Promise<void> {
    return notImplemented("cancelUpload");
  }

  // ── Signed URLs (task 13.1) ──────────────────────────────────────────────────
  signedUrl(_key: string, _op: SignedOperation, _options?: SignedUrlOptions): Promise<string> {
    return notImplemented("signedUrl");
  }

  // ── Versioning (task 14.1) ───────────────────────────────────────────────────
  listVersions(_key: string): Promise<VersionInfo[]> {
    return notImplemented("listVersions");
  }
  restoreVersion(_key: string, _versionId: string): Promise<StorageObjectMetadata> {
    return notImplemented("restoreVersion");
  }
  deleteVersion(_key: string, _versionId: string): Promise<void> {
    return notImplemented("deleteVersion");
  }

  // ── Image processing (task 19.1) ─────────────────────────────────────────────
  get images(): ImageProcessor {
    throw notYetImplementedError("images");
  }

  // ── Directory API (task 17.1) ────────────────────────────────────────────────
  get directory(): DirectoryApi {
    throw notYetImplementedError("directory");
  }

  // ── Search (task 18.1) ───────────────────────────────────────────────────────
  search(_filters: SearchFilters): Promise<StorageListItem[]> {
    return notImplemented("search");
  }

  // ── Observability (task 22.1) ────────────────────────────────────────────────
  stats(): StorageStats {
    throw notYetImplementedError("stats");
  }
  probe(): Promise<DriverProbe> {
    return notImplemented("probe");
  }

  /**
   * Release any resources held by the facade. Task 5.1 holds no resources, so
   * this is a no-op; later tasks (observability/bridges) extend it to detach
   * their handles.
   */
  async close(): Promise<void> {
    // No resources held yet.
  }
}

/** Encode a string payload as UTF-8 bytes for storage. */
function encodeUtf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/**
 * Compute the lowercase sha-256 hex digest of `bytes`, matching the checksum
 * scheme the drivers compute at write time so the value passed to the
 * validation pipeline is identical to the object's stored checksum.
 */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Drain a Node {@link NodeReadable} fully into a single {@link Uint8Array}. Used
 * by `putStream` only when a validation pipeline is configured, so size and
 * checksum can be computed and validated before any content is persisted. Each
 * chunk is normalized to a `Buffer` before concatenation.
 */
async function collectStream(stream: NodeReadable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Build the standard "not yet implemented" error for a facade method. */
function notYetImplementedError(method: string): Error {
  return new Error(
    `Storage.${method} is not implemented yet; it is wired in a later task of the ` +
      `unified-storage-framework spec.`,
  );
}

/** Reject with the standard "not yet implemented" error for an async method. */
function notImplemented(method: string): Promise<never> {
  return Promise.reject(notYetImplementedError(method));
}

// ── Public entry point ─────────────────────────────────────────────────────

/**
 * Construct a {@link Storage} instance backed by the driver selected in `config`
 * (Requirements 1.1, 1.2). The returned facade exposes an identical public
 * method set for every provider (Requirement 1.4).
 *
 * Provider selection:
 * - `config.driver`, when supplied, is used directly (cloud providers imported
 *   from `@streetjs/storage/*` submodules).
 * - Otherwise `config.provider` selects a built-in zero-dependency driver
 *   (`memory` or `local`; `local` requires `config.root`).
 *
 * @throws StorageConfigError when the provider name is unknown and no `driver`
 *   is supplied — no {@link Storage} instance is produced (Requirement 1.5). If
 *   constructing that error object itself fails unexpectedly, the internal
 *   failure surfaces as a thrown error and, likewise, no instance is produced
 *   (Requirement 1.6).
 *
 * @typeParam T - Optional per-application custom metadata map.
 */
export function createStorage<T extends StorageMetadataMap = StorageMetadataMap>(
  config: StorageConfig,
): Storage<T> {
  const driver = resolveDriver(config);
  return new StorageFacade<T>(driver, config);
}
