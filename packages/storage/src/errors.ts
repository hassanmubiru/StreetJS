/**
 * @streetjs/storage — typed error hierarchy
 *
 * Every error thrown by the storage framework derives from {@link StorageError},
 * so consumers can catch the whole family with a single `instanceof StorageError`
 * check while still discriminating on concrete subclasses for specific handling.
 *
 * Each subclass carries descriptive, strongly typed fields appropriate to its
 * purpose (the offending key, the validation message, the access context, the
 * unsupported image source, etc.) and sets `this.name`. Because TypeScript emits
 * to ES2022 with `Error` subclassing, we call `Object.setPrototypeOf` in every
 * constructor to keep the prototype chain intact for `instanceof` under ESM/TS.
 *
 * _Requirements: 1.5, 5.5, 9.4, 11.3, 14.4_
 */

/**
 * Base class for every error raised by `@streetjs/storage`.
 *
 * Catch this to handle any storage failure; narrow to a subclass for specific
 * cases. Carries an optional `cause` (the underlying error, when this error
 * wraps another) following the standard `Error` `cause` convention.
 */
export class StorageError extends Error {
  /** The underlying error this error wraps, when applicable. */
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "StorageError";
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
    Object.setPrototypeOf(this, StorageError.prototype);
  }
}

/**
 * Raised when `createStorage` (or another configuration step) receives an
 * invalid or unusable configuration — for example an unknown provider name.
 *
 * Carries the optional `provider` that triggered the failure so callers can
 * surface a precise, descriptive configuration error (Requirement 1.5).
 */
export class StorageConfigError extends StorageError {
  /** The provider name (or other config value) that was rejected, if known. */
  readonly provider?: string;

  constructor(message: string, options?: { provider?: string; cause?: unknown }) {
    super(message, options);
    this.name = "StorageConfigError";
    this.provider = options?.provider;
    Object.setPrototypeOf(this, StorageConfigError.prototype);
  }
}

/**
 * Raised when an operation targets an object key that does not exist — for
 * example `getStream` on a missing key (Requirement 5.5).
 *
 * Carries the offending `key` so callers know exactly which object was absent.
 */
export class NotFoundError extends StorageError {
  /** The object key that was not found. */
  readonly key: string;

  constructor(key: string, message?: string, options?: { cause?: unknown }) {
    super(message ?? `Object not found for key "${key}"`, options);
    this.name = "NotFoundError";
    this.key = key;
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Raised when the validation pipeline rejects an upload before any content is
 * persisted, leaving no partial object stored (Requirement 9.4).
 *
 * Carries the human-readable `validationError` text describing why the upload
 * was rejected, plus the optional `key` the upload targeted.
 */
export class ValidationError extends StorageError {
  /** The descriptive text explaining why validation failed. */
  readonly validationError: string;
  /** The object key the rejected upload targeted, when known. */
  readonly key?: string;

  constructor(
    validationError: string,
    options?: { key?: string; message?: string; cause?: unknown },
  ) {
    super(options?.message ?? `Upload validation failed: ${validationError}`, options);
    this.name = "ValidationError";
    this.validationError = validationError;
    this.key = options?.key;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * Raised when a caller lacks the access required by an object's access level,
 * denying the operation (Requirement 11.3).
 *
 * Carries the access context — the `key`, the attempted `operation`, and the
 * object's `accessLevel` — so the denial can be logged and explained precisely.
 */
export class AuthorizationError extends StorageError {
  /** The object key the denied operation targeted, when known. */
  readonly key?: string;
  /** The operation that was denied (e.g. "read", "write", "delete"). */
  readonly operation?: string;
  /** The access level that governed the denied object, when known. */
  readonly accessLevel?: string;

  constructor(
    message: string,
    options?: {
      key?: string;
      operation?: string;
      accessLevel?: string;
      cause?: unknown;
    },
  ) {
    super(message, options);
    this.name = "AuthorizationError";
    this.key = options?.key;
    this.operation = options?.operation;
    this.accessLevel = options?.accessLevel;
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}

/**
 * Raised when the image processor is asked to transform a source that is not a
 * supported image format; the source object is left unmodified (Requirement 14.4).
 *
 * Carries the offending source `format` and/or `key` so the error precisely
 * identifies what could not be processed.
 */
export class UnsupportedImageError extends StorageError {
  /** The detected/declared source format that is not supported, when known. */
  readonly format?: string;
  /** The source object key that could not be processed, when known. */
  readonly key?: string;

  constructor(
    message: string,
    options?: { format?: string; key?: string; cause?: unknown },
  ) {
    super(message, options);
    this.name = "UnsupportedImageError";
    this.format = options?.format;
    this.key = options?.key;
    Object.setPrototypeOf(this, UnsupportedImageError.prototype);
  }
}
