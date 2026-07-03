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
