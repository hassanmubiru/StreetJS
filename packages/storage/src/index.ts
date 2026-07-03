/**
 * @streetjs/storage
 *
 * Unified storage framework for StreetJS. This is the public entry point of the
 * package. Core types, errors, the driver contract, drivers, and the storage
 * facade are re-exported from here as they are implemented in subsequent tasks.
 *
 * For now this file provides a minimal placeholder export so that `tsc` emits a
 * valid `dist/index.js` and the package builds clean.
 */

/** The semantic version line of the storage framework package surface. */
export const STORAGE_FRAMEWORK_VERSION = "1.0.0" as const;

/**
 * Marker identifying the package. Replaced/augmented with real public exports
 * (types, errors, drivers, facade) in later tasks.
 */
export const STORAGE_PACKAGE_NAME = "@streetjs/storage" as const;

// ── Typed error hierarchy (task 2.2) ────────────────────────────────────────
export {
  StorageError,
  StorageConfigError,
  NotFoundError,
  ValidationError,
  AuthorizationError,
  UnsupportedImageError,
} from "./errors.js";

// ── Storage facade (src/facade.ts, task 5.1) ────────────────────────────────
export { createStorage } from "./facade.js";
export type {
  Storage,
  PutOptions,
  ImageProcessor,
  ImageOperations,
  ImageFormat,
  ImageResize,
  ImageCrop,
  ImageFit,
  DirectoryApi,
} from "./facade.js";

// ── Image processor (src/image.ts, task 19.1) ───────────────────────────────
export { StorageImageProcessor, IMAGE_VARIANT_PREFIX } from "./image.js";

// ── Validation pipeline (src/validation.ts, task 8.1) ───────────────────────
export { ValidationPipeline, BUILT_IN_VALIDATORS } from "./validation.js";
export type { Validator } from "./validation.js";

// ── Access controller (src/access.ts, task 16.1) ────────────────────────────
export { AccessController } from "./access.js";
export type {
  AccessOperation,
  AccessContext,
  AccessControllerOptions,
} from "./access.js";

// ── Multipart upload manager (src/multipart.ts, task 10.1) ──────────────────
export { MultipartManager } from "./multipart.js";

// ── Resumable upload manager (src/resumable.ts, task 11.1) ──────────────────
export { ResumableManager } from "./resumable.js";

// ── Signed URL service (src/signed-url.ts, task 13.1) ───────────────────────
export { SignedUrlService } from "./signed-url.js";
export type { SignedUrlServiceOptions } from "./signed-url.js";

// ── Versioning manager (src/versioning.ts, task 14.1) ───────────────────────
export { VersioningManager } from "./versioning.js";

// ── Lifecycle engine (src/lifecycle.ts, task 15.1) ──────────────────────────
export { LifecycleEngine, ARCHIVE_KEY_PREFIX } from "./lifecycle.js";
export type { LifecycleEngineOptions } from "./lifecycle.js";

// ── Search filtering (src/search.ts, task 18.1) ─────────────────────────────
export { searchObjects } from "./search.js";

// ── Events integration bridge (src/integrations/events.ts, task 21.1) ───────
export { bridgeStorageEvents } from "./integrations/events.js";
export type {
  StorageEventName,
  StorageEventPayload,
  StorageEventPublisher,
} from "./integrations/events.js";

// ── Queue integration bridge (src/integrations/queue.ts, task 21.2) ─────────
export { bridgeStorageQueue } from "./integrations/queue.js";
export type {
  StorageJobName,
  StorageJobPayload,
  StorageQueuePublisher,
} from "./integrations/queue.js";

// ── Typed metadata layer (src/metadata.ts, task 9.1) ────────────────────────
export {
  buildObjectMetadata,
  normalizeMetadata,
  toWriteMetadata,
  DEFAULT_CONTENT_TYPE,
  DEFAULT_ACCESS_LEVEL,
  STORAGE_METADATA_FIELDS,
} from "./metadata.js";
export type { BuildMetadataInput } from "./metadata.js";

// ── Driver contract (src/driver.ts) ─────────────────────────────────────────
export type {
  StorageDriver,
  MaybeObject,
  StoredPart,
  MultipartCapability,
  ResumableCapability,
  VersioningCapability,
  SignedUrlCapability,
  LifecycleCapability,
  NodeReadable,
} from "./driver.js";

// ── Shared typed models (src/types.ts, task 2.1) ────────────────────────────
export type {
  StorageMetadataMap,
  StorageObjectMetadata,
  WriteMetadata,
  GetResult,
  CopyResult,
  MoveResult,
  StorageListItem,
  ListOptions,
  AccessLevel,
  SignedOperation,
  SignedUrlOptions,
  SignedUrlVerification,
  VersionInfo,
  LifecycleRule,
  LifecycleOutcome,
  ValidationConfig,
  ValidationInput,
  ValidationResult,
  SearchFilters,
  AuthLike,
  ImageCodec,
  EventsLike,
  QueueLike,
  RealtimeLike,
  StorageConfig,
  StorageStats,
  DriverProbe,
} from "./types.js";
