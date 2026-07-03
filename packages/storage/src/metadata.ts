/**
 * @streetjs/storage — the typed metadata layer (single source of truth).
 *
 * Every stored object carries a typed {@link StorageObjectMetadata} field set:
 * `key`, `size`, `contentType`, `etag`, `checksum`, `owner`, `tenant`,
 * `accessLevel`, `createdAt`, `updatedAt`, `custom` (and an optional
 * `versionId`). Requirement 10 states this field set must be **complete**,
 * **consistent across providers**, and must **round-trip** through write and
 * read unchanged. Historically each driver assembled that object literal on its
 * own and duplicated the field defaults (`contentType` →
 * `application/octet-stream`, `accessLevel` → `private`, `custom` → `{}`), which
 * risked the shape drifting between drivers over time.
 *
 * This module centralizes that shape in one place so it is preserved
 * identically no matter which {@link StorageDriver} backs the facade:
 *
 * - {@link buildObjectMetadata} is the single constructor for the metadata
 *   field set. Drivers compute the provider-specific identity fields
 *   (`etag`/`checksum`/`size`) and timestamps (`createdAt`/`updatedAt`) and hand
 *   them here together with the caller's {@link WriteMetadata}; this function
 *   applies the canonical defaults and produces the complete, typed object. It
 *   never recomputes the identity fields, so driver-computed values are the
 *   source of truth for content hashing (Requirement 10.1, 10.2).
 * - {@link normalizeMetadata} guarantees the full field set is present on any
 *   metadata surfaced by the facade (`put`/`stat`/`get`), filling the canonical
 *   defaults for any field a driver (e.g. a future cloud driver) left
 *   unpopulated while leaving identity/timestamp fields untouched. It is
 *   idempotent for metadata already produced by {@link buildObjectMetadata}
 *   (Requirement 10.1, 10.3).
 * - {@link toWriteMetadata} projects a stored object's metadata back onto the
 *   write-time subset, used when copying/moving so the destination preserves the
 *   source's content type, ownership, tenancy, access level, and custom fields.
 *
 * The module depends only on the shared type surface (`types.ts`), keeping the
 * dependency direction acyclic (leaf module → types).
 *
 * _Requirements: 10.1, 10.2, 10.3_
 */

import type { AccessLevel, StorageObjectMetadata, WriteMetadata } from "./types.js";

// ── Canonical field-set defaults ──────────────────────────────────────────────

/** Default content type applied when a write does not specify one. */
export const DEFAULT_CONTENT_TYPE = "application/octet-stream" as const;

/** Default access level applied when a write does not specify one. */
export const DEFAULT_ACCESS_LEVEL: AccessLevel = "private";

/**
 * The canonical, ordered set of typed metadata field names every object carries
 * (Requirement 10.1). `versionId` is intentionally excluded — it is an optional
 * field present only on versioned objects, not part of the guaranteed base set.
 */
export const STORAGE_METADATA_FIELDS = [
  "key",
  "size",
  "contentType",
  "etag",
  "checksum",
  "owner",
  "tenant",
  "accessLevel",
  "createdAt",
  "updatedAt",
  "custom",
] as const;

// ── The metadata constructor ──────────────────────────────────────────────────

/**
 * The inputs a driver supplies to build an object's metadata. The driver is
 * responsible for the provider-specific identity fields and timestamps; this
 * layer owns the field-set shape and the caller-facing defaults.
 */
export interface BuildMetadataInput {
  /** The object key. */
  readonly key: string;
  /** Byte length of the stored content, computed by the driver. */
  readonly size: number;
  /** Content hash (e.g. sha-256 hex), computed by the driver. */
  readonly checksum: string;
  /** Entity tag; defaults to {@link checksum} when the driver omits it. */
  readonly etag?: string;
  /** Creation timestamp (epoch ms) from the injected clock. */
  readonly createdAt: number;
  /** Last-updated timestamp (epoch ms) from the injected clock. */
  readonly updatedAt: number;
  /** The caller-supplied write-time metadata. */
  readonly write: WriteMetadata;
  /** Optional version identifier for versioned objects. */
  readonly versionId?: string;
}

/**
 * Build the complete, typed {@link StorageObjectMetadata} field set from the
 * driver-computed identity/timestamp values and the caller's
 * {@link WriteMetadata}. This is the single place the metadata shape and its
 * defaults are defined, so every driver produces an identical field set
 * (Requirement 10.1, 10.2, 10.3).
 *
 * The identity fields (`etag`/`checksum`/`size`) and timestamps are used exactly
 * as provided — this function never recomputes them — so the driver's computed
 * values remain the source of truth and cannot diverge from what was persisted.
 */
export function buildObjectMetadata(input: BuildMetadataInput): StorageObjectMetadata {
  const { key, size, checksum, createdAt, updatedAt, write, versionId } = input;
  const metadata: StorageObjectMetadata = {
    key,
    size,
    contentType: write.contentType ?? DEFAULT_CONTENT_TYPE,
    etag: input.etag ?? checksum,
    checksum,
    owner: write.owner,
    tenant: write.tenant,
    accessLevel: write.accessLevel ?? DEFAULT_ACCESS_LEVEL,
    createdAt,
    updatedAt,
    custom: write.custom ?? {},
    ...(versionId !== undefined ? { versionId } : {}),
  };
  return metadata;
}

/**
 * Return a copy of `metadata` with the complete typed field set guaranteed
 * present, applying the canonical defaults for any missing `contentType`,
 * `accessLevel`, or `custom` field while preserving the driver-computed
 * identity fields (`etag`/`checksum`/`size`) and timestamps untouched
 * (Requirement 10.1, 10.3).
 *
 * The facade runs the metadata it surfaces on `put`/`stat`/`get` through this
 * function so the full field set is consistently present regardless of which
 * driver produced it. It is idempotent for metadata already built by
 * {@link buildObjectMetadata}, so wiring it in adds no behavioral change for the
 * zero-dependency drivers while shielding the public surface from a future
 * driver that returns a partially populated record.
 */
export function normalizeMetadata(metadata: StorageObjectMetadata): StorageObjectMetadata {
  const normalized: StorageObjectMetadata = {
    key: metadata.key,
    size: metadata.size,
    contentType: metadata.contentType ?? DEFAULT_CONTENT_TYPE,
    etag: metadata.etag,
    checksum: metadata.checksum,
    owner: metadata.owner,
    tenant: metadata.tenant,
    accessLevel: metadata.accessLevel ?? DEFAULT_ACCESS_LEVEL,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    custom: metadata.custom ?? {},
    ...(metadata.versionId !== undefined ? { versionId: metadata.versionId } : {}),
  };
  return normalized;
}

/**
 * Project a stored object's {@link StorageObjectMetadata} onto the write-time
 * {@link WriteMetadata} subset. Used when copying/moving an object so the
 * destination preserves the source's content type, ownership, tenancy, access
 * level, and custom fields. The identity/timestamp fields (`etag`/`checksum`/
 * `size`/`createdAt`/`updatedAt`) are intentionally omitted — the driver
 * recomputes them for the destination object.
 */
export function toWriteMetadata(metadata: StorageObjectMetadata): WriteMetadata {
  return {
    contentType: metadata.contentType,
    owner: metadata.owner,
    tenant: metadata.tenant,
    accessLevel: metadata.accessLevel,
    custom: metadata.custom,
  };
}
