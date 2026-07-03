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
  DirectoryApi,
} from "./facade.js";

// ── Validation pipeline (src/validation.ts, task 8.1) ───────────────────────
export { ValidationPipeline, BUILT_IN_VALIDATORS } from "./validation.js";
export type { Validator } from "./validation.js";

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
