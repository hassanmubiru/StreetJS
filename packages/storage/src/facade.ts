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
import { AccessController } from "./access.js";
import type { AccessOperation } from "./access.js";
import { StorageDirectoryApi } from "./directory.js";
import { StorageImageProcessor } from "./image.js";
import { MemoryStorageDriver } from "./drivers/memory.js";
import { LocalStorageDriver } from "./drivers/local.js";
import { StorageConfigError, ValidationError } from "./errors.js";
import { LifecycleEngine } from "./lifecycle.js";
import { DEFAULT_ACCESS_LEVEL, normalizeMetadata, toWriteMetadata } from "./metadata.js";
import { MultipartManager } from "./multipart.js";
import { ResumableManager } from "./resumable.js";
import { searchObjects } from "./search.js";
import { SignedUrlService } from "./signed-url.js";
import { ValidationPipeline } from "./validation.js";
import { VersioningManager } from "./versioning.js";
import { bridgeStorageEvents } from "./integrations/events.js";
import type { StorageEventPublisher } from "./integrations/events.js";
import { bridgeStorageQueue } from "./integrations/queue.js";
import type { StorageQueuePublisher } from "./integrations/queue.js";
import { bridgeStorageRealtime } from "./integrations/realtime.js";
import type { StorageRealtimePublisher } from "./integrations/realtime.js";
import type {
  AccessLevel,
  ValidationInput,
  CopyResult,
  GetResult,
  LifecycleOutcome,
  LifecycleRule,
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
 * The output image formats the {@link ImageProcessor} can emit (Requirement
 * 14.2).
 */
export type ImageFormat = "webp" | "avif" | "png" | "jpeg";

/** A resize transformation: at least one of width/height (pixels). */
export interface ImageResize {
  readonly width?: number;
  readonly height?: number;
}

/** A crop transformation: a rectangular region (pixels) of the source. */
export interface ImageCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A fit transformation: fit the image within a bounding box (pixels). */
export interface ImageFit {
  readonly width: number;
  readonly height: number;
  /** Optional fit strategy hint for codecs that support it. */
  readonly mode?: "cover" | "contain" | "fill" | "inside" | "outside";
}

/**
 * The transformation / format-conversion parameters accepted by
 * {@link ImageProcessor.transform}. Every field is optional so a caller
 * combines only the operations they need; all supported transformations
 * (resize, crop, rotate, fit, thumbnail, compress — Requirement 14.1) and the
 * output `format` selection (Requirement 14.2) are expressed here.
 */
export interface ImageOperations {
  /** Resize to the given width/height. */
  readonly resize?: ImageResize;
  /** Crop to the given rectangle. */
  readonly crop?: ImageCrop;
  /** Rotate by the given number of degrees. */
  readonly rotate?: number;
  /** Fit within the given bounding box. */
  readonly fit?: ImageFit;
  /** Produce a square thumbnail of the given edge size (pixels). */
  readonly thumbnail?: { readonly size: number };
  /** Compress at the given quality (0–100). */
  readonly compress?: { readonly quality: number };
  /** Convert the output to this format (defaults to the source format). */
  readonly format?: ImageFormat;
  /** Output quality (0–100) applied by the codec when it supports it. */
  readonly quality?: number;
}

/**
 * The image processing surface exposed as `storage.images` (Requirement 14).
 *
 * The concrete implementation lives in `src/image.ts`
 * ({@link StorageImageProcessor}); this interface is the stable public type,
 * owned here so it re-exports cleanly from `index.ts`. It supports the
 * resize/crop/rotate/fit/thumbnail/compress transformations and webp/avif/png/
 * jpeg output formats, performed through the optional structural
 * `config.imageCodec`.
 */
export interface ImageProcessor {
  /**
   * Produce a transformed / reformatted variant of the image stored at `key`,
   * returning the variant's {@link StorageObjectMetadata}. A non-image source
   * yields a descriptive error without modifying the source object
   * (Requirement 14.4).
   */
  transform(key: string, operations: ImageOperations): Promise<StorageObjectMetadata>;
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

  // Lifecycle (Requirement 13)
  applyLifecycle(rule: LifecycleRule): Promise<LifecycleOutcome[]>;

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

  /**
   * The provider-agnostic multipart upload manager. It delegates to the driver's
   * native `multipart` capability when present and otherwise simulates multipart
   * over the driver primitives, so `createMultipartUpload`/`uploadPart`/
   * `completeMultipartUpload`/`abortMultipartUpload` behave identically across
   * providers (Requirement 6).
   */
  protected readonly multipart: MultipartManager;

  /**
   * The provider-agnostic resumable upload manager. It delegates to the driver's
   * native `resumable` capability when present and otherwise simulates
   * offset-tracked sessions over the driver primitives, so `startUpload`/
   * `resumeUpload`/`cancelUpload` behave identically across providers
   * (Requirement 7).
   */
  protected readonly resumable: ResumableManager;

  /**
   * The provider-agnostic signed URL service. It delegates to the driver's
   * native `signedUrl` capability when present and otherwise mints/verifies
   * HMAC-signed URLs over `(key, op, expiry)` using `config.signingSecret`,
   * checking expiry against the injected clock, so `signedUrl` behaves
   * identically across providers (Requirement 8).
   */
  protected readonly signedUrls: SignedUrlService;

  /**
   * The provider-agnostic versioning manager. It delegates to the driver's
   * native `versioning` capability when present and otherwise simulates version
   * snapshots over the driver primitives (reserved `.versions/<key>/<versionId>`
   * copies), so `listVersions`/`restoreVersion`/`deleteVersion` and the
   * overwrite-time snapshot behave identically across providers (Requirement
   * 12). The snapshot step is only taken when `config.versioning === true`.
   */
  protected readonly versioning: VersioningManager;

  /**
   * The provider-agnostic lifecycle engine. It delegates to the driver's native
   * `lifecycle` capability when present and otherwise simulates rule evaluation
   * over the driver primitives (`list`/`stat`/`get`/`put`/`delete`), measuring
   * object age against the injected clock and applying each rule's action to a
   * qualifying object exactly once, so `applyLifecycle` behaves identically
   * across providers (Requirement 13).
   */
  protected readonly lifecycle: LifecycleEngine;

  /**
   * The provider-agnostic access controller. It resolves per-object
   * {@link AccessLevel} decisions through the optional structural `config.auth`
   * bridge, denying disallowed operations with an {@link AuthorizationError}
   * before any persistence or read occurs (Requirement 11). When no auth bridge
   * is configured it is a permissive no-op, so drivers that never configure
   * access control behave exactly as before.
   */
  protected readonly access: AccessController;

  /**
   * The typed Events bridge, present only when `config.bridges?.events` is
   * supplied. When defined, object mutations (`put` → uploaded/updated,
   * `delete` → deleted, `move`/`rename` → moved, `restoreVersion` → restored)
   * and applied lifecycle actions (`applyLifecycle`) publish the corresponding
   * typed `storage.*` event through it (Requirements 13.4, 18.1, 18.2). Every
   * publish is isolated so a failing events layer never breaks the storage
   * operation. When no events bridge is configured this is `undefined` and event
   * publication is a complete no-op.
   */
  protected readonly events?: StorageEventPublisher;

  /**
   * The typed Queue bridge, present only when `config.bridges?.queue` is
   * supplied. When defined, heavy out-of-band work (thumbnail generation, virus
   * scanning, OCR, PDF processing, transcoding, image optimization, archive
   * creation) can be handed off through it (Requirement 17.1). Every dispatch is
   * isolated so a failing queue never breaks the storage operation
   * (Requirement 17.4). When no queue bridge is configured this is `undefined`
   * and job dispatch is a complete no-op — operations proceed unaffected
   * (Requirement 17.3).
   */
  protected readonly queue?: StorageQueuePublisher;

  /**
   * The typed Realtime bridge, present only when `config.bridges?.realtime` is
   * supplied. When defined, upload state transitions (`putStream`/`resumeUpload`
   * → started/completed, and failed on error) broadcast the corresponding typed
   * `upload.*` event through it (Requirement 19.1). Every broadcast is isolated
   * so a failing realtime layer never breaks the upload (Requirement 19.3). When
   * no realtime bridge is configured this is `undefined` and broadcasting is a
   * complete no-op — uploads proceed unaffected (Requirement 19.3).
   */
  protected readonly realtime?: StorageRealtimePublisher;

  constructor(driver: StorageDriver, config: StorageConfig) {
    this.driver = driver;
    this.config = config;
    this.events =
      config.bridges?.events !== undefined
        ? bridgeStorageEvents(config.bridges.events)
        : undefined;
    this.queue =
      config.bridges?.queue !== undefined
        ? bridgeStorageQueue(config.bridges.queue)
        : undefined;
    this.realtime =
      config.bridges?.realtime !== undefined
        ? bridgeStorageRealtime(config.bridges.realtime)
        : undefined;
    this.validation =
      config.validation !== undefined ? new ValidationPipeline(config.validation) : undefined;
    this.multipart = new MultipartManager(driver);
    this.resumable = new ResumableManager(driver);
    this.signedUrls = new SignedUrlService({
      signingSecret: config.signingSecret,
      clock: config.clock,
      driver,
    });
    this.versioning = new VersioningManager(driver);
    this.lifecycle = new LifecycleEngine({ driver, clock: config.clock });
    this.access = new AccessController({ auth: config.auth });
  }

  /**
   * Run the access-control check (when an auth bridge is configured) for
   * `operation` on `key` at the given `accessLevel`, throwing an
   * {@link AuthorizationError} on denial so the guarded operation performs no
   * persistence or read (Requirement 11.3). When no auth bridge is configured
   * this is a no-op and every operation is permitted.
   */
  protected async authorizeAccess(
    key: string,
    operation: AccessOperation,
    accessLevel: AccessLevel,
    owner?: string,
    tenant?: string,
  ): Promise<void> {
    await this.access.authorize({ key, operation, accessLevel, owner, tenant });
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
    // Access control is the first gate: a denied write throws an
    // AuthorizationError before any validation or persistence, so nothing is
    // written (Requirement 11.3). No-op when no auth bridge is configured.
    await this.authorizeAccess(
      key,
      "write",
      options?.accessLevel ?? DEFAULT_ACCESS_LEVEL,
      options?.owner,
      options?.tenant,
    );
    // Validate the fully-known size/contentType/checksum BEFORE any persistence
    // so a rejection aborts the write with no partial object stored (Req 9.3/9.4).
    await this.runValidation({
      key,
      size: bytes.byteLength,
      contentType: options?.contentType,
      checksum: sha256Hex(bytes),
      metadata: options,
    });
    // When versioning is enabled, snapshot the current content (if any) BEFORE
    // the overwrite so the prior Version is retained (Requirement 12.1). The
    // snapshot never throws into this path: a versioning failure returns null
    // and the overwrite proceeds without a Version (Requirement 12.5).
    if (this.config.versioning === true) {
      await this.versioning.snapshot(key);
    }
    // Determine whether this write creates a new object or overwrites an
    // existing one so the correct event (`storage.uploaded` vs
    // `storage.updated`) is published (Requirement 18.1). The existence probe is
    // only performed when an events bridge is configured, so the default path is
    // unchanged and adds no driver call.
    const existedBefore = this.events !== undefined ? await this.driver.exists(key) : false;
    // Surface the complete, typed metadata field set (Requirement 10.1) through
    // the single source of truth so the shape is consistent across drivers.
    const metadata = normalizeMetadata(await this.driver.put(key, bytes, options ?? {}));
    // Publish uploaded/updated after a successful persist. The bridge never
    // throws into this path (Requirement 18.1, 18.2).
    if (this.events !== undefined) {
      if (existedBefore) {
        this.events.updated(metadata);
      } else {
        this.events.uploaded(metadata);
      }
    }
    return metadata;
  }

  /**
   * Read the object at `key`, converting the driver's discriminated
   * {@link MaybeObject} into the facade {@link GetResult} shape (Requirement
   * 4.2). A present object yields `{ found: true, bytes, metadata }` with the
   * stored bytes returned unchanged; an absent one yields `{ found: false }`
   * without throwing.
   */
  async get(key: string): Promise<GetResult> {
    // When access control is enforced, resolve the object's access level from
    // its metadata and authorize the read BEFORE returning any bytes; a denied
    // read throws an AuthorizationError and no content is read (Requirement
    // 11.3). A `public` object is readable without authentication unless the
    // configured bridge blocks it (Requirement 11.4). This lookup is skipped
    // entirely when no auth bridge is configured, leaving the default path
    // unchanged.
    if (this.access.enforced) {
      const metadata = await this.driver.stat(key);
      if (metadata !== null) {
        await this.authorizeAccess(
          key,
          "read",
          metadata.accessLevel,
          metadata.owner,
          metadata.tenant,
        );
      }
    }
    const result = await this.driver.get(key);
    if (result.found) {
      return { found: true, bytes: result.bytes, metadata: normalizeMetadata(result.metadata) };
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
    // Authorize the delete against the object's access level (Requirement
    // 11.3). Skipped when no auth bridge is configured; a missing object has no
    // access level to enforce and the driver delete remains a no-op.
    if (this.access.enforced) {
      const metadata = await this.driver.stat(key);
      if (metadata !== null) {
        await this.authorizeAccess(
          key,
          "delete",
          metadata.accessLevel,
          metadata.owner,
          metadata.tenant,
        );
      }
    }
    await this.driver.delete(key);
    // Publish `storage.deleted` after the removal (Requirement 18.1). The bridge
    // never throws into this path.
    if (this.events !== undefined) {
      this.events.deleted(key);
    }
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
    const metadata = normalizeMetadata(
      await this.driver.put(destination, result.bytes, toWriteMetadata(result.metadata)),
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
    const metadata = normalizeMetadata(
      await this.driver.put(destination, result.bytes, toWriteMetadata(result.metadata)),
    );
    await this.driver.delete(source);
    // Publish `storage.moved` for the relocated object (Requirement 18.1); this
    // also covers `rename`, which delegates here. The bridge never throws into
    // this path.
    if (this.events !== undefined) {
      this.events.moved(metadata);
    }
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
    const metadata = await this.driver.stat(key);
    return metadata === null ? null : normalizeMetadata(metadata);
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
    // Access control gates the streamed write before any bytes reach the driver
    // (Requirement 11.3). No-op when no auth bridge is configured.
    await this.authorizeAccess(
      key,
      "write",
      options?.accessLevel ?? DEFAULT_ACCESS_LEVEL,
      options?.owner,
      options?.tenant,
    );
    // Broadcast the upload state transitions through the realtime bridge when
    // configured (Requirement 19.1). Every broadcast is isolated so it never
    // breaks the upload path (Requirement 19.3).
    this.realtime?.started(key);
    try {
      // With no validation configured, stream straight through the driver so
      // large files never fully buffer (Requirement 5.3).
      if (this.validation === undefined) {
        const metadata = normalizeMetadata(await this.driver.putStream(key, stream, options ?? {}));
        this.realtime?.completed(key);
        return metadata;
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
      const metadata = normalizeMetadata(await this.driver.put(key, bytes, options ?? {}));
      this.realtime?.completed(key);
      return metadata;
    } catch (error) {
      this.realtime?.failed(key, error instanceof Error ? error.message : String(error));
      throw error;
    }
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
    // Authorize the streamed read against the object's access level before
    // producing any stream (Requirement 11.3). Skipped entirely when no auth
    // bridge is configured so the default path is unchanged.
    if (this.access.enforced) {
      const metadata = await this.driver.stat(key);
      if (metadata !== null) {
        await this.authorizeAccess(
          key,
          "read",
          metadata.accessLevel,
          metadata.owner,
          metadata.tenant,
        );
      }
    }
    return this.driver.getStream(key);
  }

  // ── Multipart (task 10.1) ────────────────────────────────────────────────────

  /**
   * Begin a multipart upload for `key` and return its upload identifier
   * (Requirement 6.1). Write-time metadata in `options` is captured so the
   * assembled object is written with the intended content type / ownership /
   * access level / custom fields at completion.
   */
  createMultipartUpload(key: string, options?: PutOptions): Promise<string> {
    return this.multipart.create(key, options ?? {});
  }

  /**
   * Persist a single part for `uploadId` and return its {@link StoredPart}
   * descriptor (Requirement 6.2).
   */
  uploadPart(uploadId: string, partNumber: number, content: Uint8Array): Promise<StoredPart> {
    return this.multipart.uploadPart(uploadId, partNumber, content);
  }

  /**
   * Assemble the supplied ordered `parts` into the final object and return its
   * metadata; the content equals the concatenation of the parts in order,
   * equivalent to a single `put` of that concatenation (Requirement 6.3).
   */
  completeMultipartUpload(
    uploadId: string,
    parts: readonly StoredPart[],
  ): Promise<StorageObjectMetadata> {
    return this.multipart.complete(uploadId, parts);
  }

  /**
   * Discard all uploaded parts for `uploadId` and create no completed object
   * (Requirement 6.4).
   */
  abortMultipartUpload(uploadId: string): Promise<void> {
    return this.multipart.abort(uploadId);
  }

  // ── Resumable (task 11.1) ────────────────────────────────────────────────────

  /**
   * Create a resumable upload session for `key` and return its session id
   * (Requirement 7.1). Write-time metadata in `options` is captured so the
   * object created on completion carries the intended content type / ownership /
   * access level / custom fields.
   */
  startUpload(key: string, options?: PutOptions): Promise<string> {
    return this.resumable.start(key, options ?? {});
  }

  /**
   * Continue the session `sessionId` from its last persisted offset using the
   * full content carried by `stream`, creating the final object on completion
   * and returning its metadata (Requirements 7.2, 7.3). The completed object is
   * byte-identical to an equivalent uninterrupted upload.
   */
  resumeUpload(sessionId: string, stream: NodeReadable): Promise<StorageObjectMetadata> {
    return this.resumable.resume(sessionId, stream);
  }

  /**
   * Discard the session `sessionId` without creating an object (Requirement
   * 7.4), unless it is already completing, in which case the upload is allowed
   * to finish and the object is created (Requirement 7.5).
   */
  cancelUpload(sessionId: string): Promise<void> {
    return this.resumable.cancel(sessionId);
  }

  // ── Signed URLs (task 13.1) ──────────────────────────────────────────────────

  /**
   * Mint a URL authorizing exactly the operation `op` on `key` (Requirement
   * 8.1), carrying the accepted options for expiration, request headers, content
   * type, maximum size, and custom metadata (Requirement 8.2). Delegates to the
   * driver's native signed-URL capability when present and otherwise mints an
   * HMAC-signed URL over `(key, op, expiry)` using `config.signingSecret`
   * (throwing a {@link StorageConfigError} when that secret is absent).
   */
  signedUrl(key: string, op: SignedOperation, options?: SignedUrlOptions): Promise<string> {
    return this.signedUrls.sign(key, op, options);
  }

  // ── Versioning (task 14.1) ───────────────────────────────────────────────────

  /**
   * Return the {@link VersionInfo} descriptors of the retained Versions for
   * `key` (Requirement 12.2), delegating to the versioning manager (native
   * capability when present, otherwise the reserved-key simulation).
   */
  listVersions(key: string): Promise<VersionInfo[]> {
    return this.versioning.listVersions(key);
  }

  /**
   * Make the content of the Version identified by `versionId` the current
   * content of `key` and return the resulting metadata (Requirement 12.3).
   */
  async restoreVersion(key: string, versionId: string): Promise<StorageObjectMetadata> {
    const metadata = await this.versioning.restoreVersion(key, versionId);
    // Publish `storage.restored` after the restore succeeds (Requirement 18.1).
    // The bridge never throws into this path.
    if (this.events !== undefined) {
      this.events.restored(metadata);
    }
    return metadata;
  }

  /**
   * Remove exactly the Version identified by `versionId` for `key` while
   * retaining the remaining Versions (Requirement 12.4).
   */
  deleteVersion(key: string, versionId: string): Promise<void> {
    return this.versioning.deleteVersion(key, versionId);
  }

  // ── Lifecycle (task 15.1) ────────────────────────────────────────────────────

  /**
   * Evaluate the lifecycle `rule` and apply its action to every qualifying
   * object, returning one {@link LifecycleOutcome} per actioned object
   * (Requirements 13.1, 13.2). Object age is measured against the configured
   * clock, and each qualifying object is actioned exactly once — a repeated
   * evaluation produces no further action on an already-actioned object.
   * Delegates to the driver's native `lifecycle` capability when present and
   * otherwise simulates the rule over the driver primitives (Requirement 13.3).
   * When an events bridge is configured, each applied action publishes its
   * corresponding typed lifecycle event through the bridge (Requirement 13.4);
   * publication is isolated so a failing events layer never affects the returned
   * outcomes.
   */
  async applyLifecycle(rule: LifecycleRule): Promise<LifecycleOutcome[]> {
    const outcomes = await this.lifecycle.apply(rule);
    if (this.events !== undefined) {
      for (const outcome of outcomes) {
        this.events.lifecycle(outcome);
      }
    }
    return outcomes;
  }

  // ── Image processing (task 19.1) ─────────────────────────────────────────────

  /**
   * The lazily-constructed image processor exposed as `storage.images`. Built on
   * first access and reused thereafter so its transformation cache is shared
   * across calls on the same facade (Requirement 14.3).
   */
  private imageProcessor?: ImageProcessor;

  /**
   * The image processing surface (`transform`) implemented over the driver and
   * the optional structural `config.imageCodec`. It supports the
   * resize/crop/rotate/fit/thumbnail/compress transformations and webp/avif/png/
   * jpeg output formats (Requirements 14.1, 14.2), caches identical
   * transformations (Requirement 14.3), and rejects a non-image source with an
   * {@link UnsupportedImageError} without modifying the source object
   * (Requirement 14.4). Lazily constructed and cached.
   */
  get images(): ImageProcessor {
    if (this.imageProcessor === undefined) {
      this.imageProcessor = new StorageImageProcessor(this.driver, this.config.imageCodec);
    }
    return this.imageProcessor;
  }

  // ── Directory API (task 17.1) ────────────────────────────────────────────────

  /**
   * The lazily-constructed Directory API over the driver's flat key space
   * (Requirement 15). Built on first access to `storage.directory` and reused
   * thereafter so directory operations share one instance per facade.
   */
  private directoryApi?: DirectoryApi;

  /**
   * The directory-style API (`mkdir`/`listDirectory`/`removeDirectory`/`walk`)
   * implemented entirely over the driver's flat key space using `/`-delimited
   * prefixes, so it behaves identically across every provider including
   * prefix-only cloud stores (Requirement 15). Lazily constructed and cached.
   */
  get directory(): DirectoryApi {
    if (this.directoryApi === undefined) {
      this.directoryApi = new StorageDirectoryApi(this.driver);
    }
    return this.directoryApi;
  }

  // ── Search (task 18.1) ───────────────────────────────────────────────────────

  /**
   * Return the stored objects that satisfy **every** supplied filter
   * (Requirement 16.2), evaluated over the driver's `list` + `stat` primitives.
   * Filtering is conjunctive across prefix, content type, owner, tenant, size
   * range, updated-time range, and custom metadata (Requirement 16.1); when no
   * object matches, an empty result set is returned (Requirement 16.3).
   */
  search(filters: SearchFilters): Promise<StorageListItem[]> {
    return searchObjects(this.driver, filters);
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
