/**
 * @streetjs/storage — the pre-persistence validation pipeline.
 *
 * The {@link ValidationPipeline} runs an ordered set of validators over a
 * {@link ValidationInput} *before* any content is persisted, so an unacceptable
 * upload is rejected without ever reaching the driver and therefore leaves no
 * partial object stored (Requirements 9.3, 9.4). The facade constructs a
 * pipeline from `config.validation` and invokes it as the first step of `put`
 * and `putStream`; the driver's `put` is only called once the pipeline reports
 * success.
 *
 * The built-in validators, applied strictly in this order, are:
 *
 *   1. **MIME type** — the write's `contentType` must be one of
 *      `allowedMimeTypes` (exact match, or a `type/*` wildcard entry).
 *   2. **File extension** — the extension derived from the object key must be
 *      one of `allowedExtensions` (compared case-insensitively, leading dots
 *      ignored so `"png"` and `".png"` are equivalent).
 *   3. **File size** — the byte length must not exceed `maxSize`.
 *   4. **Filename** — the filename (final `/`-delimited segment of the key) must
 *      match `filenamePattern`.
 *   5. **Checksum** — when `requireChecksum` is set, a non-empty `checksum` must
 *      be present on the input.
 *   6. **Custom** — the configured `custom(input)` validator, if any, is invoked
 *      last and may reject with its own descriptive message.
 *
 * The pipeline short-circuits: it returns the **first** rejection it encounters
 * and does not run subsequent validators. Each validator is a no-op (returns
 * `{ ok: true }`) when its governing configuration field is absent, so a sparse
 * {@link ValidationConfig} only enforces the constraints it actually declares.
 *
 * _Requirements: 9.1, 9.2, 9.3, 9.4_
 */

import type {
  ValidationConfig,
  ValidationInput,
  ValidationResult,
} from "./types.js";

/** A single validator: inspects the input against the config, returning a result. */
export type Validator = (
  input: ValidationInput,
  config: ValidationConfig,
) => ValidationResult | Promise<ValidationResult>;

/** The shared "accepted" result, reused to avoid reallocating on every pass. */
const OK: ValidationResult = { ok: true };

/** Build a rejection result carrying a descriptive message. */
function reject(error: string): ValidationResult {
  return { ok: false, error };
}

// ── Built-in validators ───────────────────────────────────────────────────────

/**
 * Validator 1 — MIME type. When `allowedMimeTypes` is configured, the input's
 * `contentType` must exactly equal one of the allowed entries, or match a
 * `type/*` wildcard entry (e.g. `"image/*"` permits `"image/png"`). A missing
 * `contentType` is rejected because it cannot be shown to be permitted.
 */
export const validateMimeType: Validator = (input, config) => {
  const allowed = config.allowedMimeTypes;
  if (allowed === undefined) {
    return OK;
  }
  const contentType = input.contentType;
  if (contentType !== undefined && allowed.some((entry) => mimeMatches(entry, contentType))) {
    return OK;
  }
  return reject(
    `content type "${contentType ?? "(none)"}" is not permitted; ` +
      `allowed MIME types: ${allowed.join(", ")}`,
  );
};

/**
 * Validator 2 — file extension. When `allowedExtensions` is configured, the
 * extension derived from the object key must be one of the allowed entries,
 * compared case-insensitively with any leading dot ignored. A key with no
 * extension is rejected.
 */
export const validateExtension: Validator = (input, config) => {
  const allowed = config.allowedExtensions;
  if (allowed === undefined) {
    return OK;
  }
  const extension = extractExtension(input.key);
  if (extension === undefined) {
    return reject(
      `object key "${input.key}" has no file extension; ` +
        `allowed extensions: ${allowed.join(", ")}`,
    );
  }
  const normalized = normalizeExtension(extension);
  if (allowed.some((entry) => normalizeExtension(entry) === normalized)) {
    return OK;
  }
  return reject(
    `file extension ".${normalized}" is not permitted; ` +
      `allowed extensions: ${allowed.join(", ")}`,
  );
};

/**
 * Validator 3 — file size. When `maxSize` is configured, the input's byte
 * length must not exceed it.
 */
export const validateSize: Validator = (input, config) => {
  const maxSize = config.maxSize;
  if (maxSize === undefined) {
    return OK;
  }
  if (input.size > maxSize) {
    return reject(`size ${input.size} bytes exceeds the maximum of ${maxSize} bytes`);
  }
  return OK;
};

/**
 * Validator 4 — filename. When `filenamePattern` is configured, the filename
 * (final `/`-delimited segment of the key) must match the pattern. The pattern
 * is evaluated against a fresh, non-global {@link RegExp} so a shared, sticky
 * (`/g`) source pattern cannot leak `lastIndex` state across calls.
 */
export const validateFilename: Validator = (input, config) => {
  const pattern = config.filenamePattern;
  if (pattern === undefined) {
    return OK;
  }
  const filename = extractFilename(input.key);
  const safePattern = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
  if (safePattern.test(filename)) {
    return OK;
  }
  return reject(`filename "${filename}" does not match the required pattern ${pattern.toString()}`);
};

/**
 * Validator 5 — checksum. When `requireChecksum` is set, a non-empty `checksum`
 * must be present on the input. For buffered writes the facade always supplies a
 * computed checksum, so this only rejects when a checksum genuinely cannot be
 * determined.
 */
export const validateChecksum: Validator = (input, config) => {
  if (config.requireChecksum !== true) {
    return OK;
  }
  if (input.checksum !== undefined && input.checksum !== "") {
    return OK;
  }
  return reject("a checksum is required for this upload but none was provided");
};

/**
 * Validator 6 — custom. When a `custom(input)` validator is configured it runs
 * last and its (possibly asynchronous) result is returned verbatim, so a custom
 * rejection carries its own descriptive message.
 */
export const validateCustom: Validator = async (input, config) => {
  const custom = config.custom;
  if (custom === undefined) {
    return OK;
  }
  return custom(input);
};

/**
 * The built-in validators applied by every {@link ValidationPipeline}, in the
 * fixed order MIME type → extension → size → filename → checksum → custom.
 */
export const BUILT_IN_VALIDATORS: readonly Validator[] = [
  validateMimeType,
  validateExtension,
  validateSize,
  validateFilename,
  validateChecksum,
  validateCustom,
];

// ── The pipeline ──────────────────────────────────────────────────────────────

/**
 * Runs an ordered chain of validators against a {@link ValidationInput},
 * short-circuiting on the first rejection.
 *
 * Construct one from a {@link ValidationConfig}; the facade does this once per
 * `Storage` instance when `config.validation` is present and calls
 * {@link ValidationPipeline.validate} before delegating any bytes to the driver.
 * Because a rejection is surfaced *before* `driver.put` is ever called, a
 * rejected upload leaves no partial object stored (Requirement 9.4).
 */
export class ValidationPipeline {
  /** The configuration each validator consults. */
  private readonly config: ValidationConfig;

  /** The ordered validators to run (defaults to {@link BUILT_IN_VALIDATORS}). */
  private readonly validators: readonly Validator[];

  constructor(
    config: ValidationConfig,
    validators: readonly Validator[] = BUILT_IN_VALIDATORS,
  ) {
    this.config = config;
    this.validators = validators;
  }

  /**
   * Run every validator in order against `input`, returning the first rejection
   * encountered or `{ ok: true }` when all validators accept. Validators are
   * awaited sequentially so an async custom validator observes the same
   * short-circuiting order as the synchronous built-ins.
   */
  async validate(input: ValidationInput): Promise<ValidationResult> {
    for (const validator of this.validators) {
      const result = await validator(input, this.config);
      if (!result.ok) {
        return result;
      }
    }
    return OK;
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Does a (possibly `type/*` wildcard) allow-list entry match a concrete MIME type? */
function mimeMatches(entry: string, contentType: string): boolean {
  const normalizedEntry = entry.trim().toLowerCase();
  const normalizedType = contentType.trim().toLowerCase();
  if (normalizedEntry === normalizedType) {
    return true;
  }
  if (normalizedEntry.endsWith("/*")) {
    const prefix = normalizedEntry.slice(0, normalizedEntry.length - 1); // keep trailing "/"
    return normalizedType.startsWith(prefix);
  }
  return false;
}

/** The final `/`-delimited segment of a key (its filename). */
function extractFilename(key: string): string {
  const slashIndex = key.lastIndexOf("/");
  return slashIndex === -1 ? key : key.slice(slashIndex + 1);
}

/**
 * The extension of a key's filename (the text after the final `.`), or
 * `undefined` when the filename has no extension. A leading-dot-only filename
 * (e.g. `".gitignore"`) is treated as having no extension.
 */
function extractExtension(key: string): string | undefined {
  const filename = extractFilename(key);
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === filename.length - 1) {
    return undefined;
  }
  return filename.slice(dotIndex + 1);
}

/** Normalize an extension for comparison: lowercase, leading dots stripped. */
function normalizeExtension(extension: string): string {
  return extension.replace(/^\.+/, "").toLowerCase();
}
