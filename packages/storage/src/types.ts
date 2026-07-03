/**
 * @streetjs/storage — shared, strongly typed data models.
 *
 * This module is the foundational, provider-agnostic type surface of the
 * package. Every other module (`driver.ts`, `facade.ts`, the drivers, the
 * cross-cutting layers, the plugin/CLI/testing utilities, and the integration
 * bridges) imports the models defined here, so this file intentionally has no
 * dependency on any sibling module other than a type-only reference to the
 * driver contract for {@link StorageConfig.driver}. Only core StreetJS
 * primitives (`Clock`, `MetricsRegistry`, `HealthCheckRegistry`) are imported
 * from `streetjs`.
 *
 * The structural bridge/auth/codec contracts ({@link AuthLike},
 * {@link ImageCodec}, {@link EventsLike}, {@link QueueLike},
 * {@link RealtimeLike}) live here because {@link StorageConfig} references them;
 * the access/image/integration modules import these shapes from this module,
 * keeping the dependency direction acyclic (leaf modules → types, never the
 * reverse).
 *
 * _Requirements: 1.1, 4.1, 8.2, 10.1, 12.2, 13.1, 16.1, 23.2_
 */

import type { Clock, HealthCheckRegistry, MetricsRegistry } from "streetjs";

import type { StorageDriver } from "./driver.js";

// ── Custom metadata map ───────────────────────────────────────────────────────

/** Optional per-application map of custom metadata field types (default: unknown). */
export interface StorageMetadataMap {
  [key: string]: unknown;
}

// ── Object metadata ───────────────────────────────────────────────────────────

/** The typed metadata associated with every object (Requirement 10.1). */
export interface StorageObjectMetadata<C = Record<string, unknown>> {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;
  readonly etag: string;
  readonly checksum: string; // content hash (e.g. sha-256 hex)
  readonly owner?: string;
  readonly tenant?: string;
  readonly accessLevel: AccessLevel;
  readonly createdAt: number; // epoch ms from injected Clock
  readonly updatedAt: number;
  readonly custom: C; // strongly typed custom fields
  readonly versionId?: string;
}

/** Metadata supplied on write (Requirement 4.1). */
export interface WriteMetadata {
  readonly contentType?: string;
  readonly owner?: string;
  readonly tenant?: string;
  readonly accessLevel?: AccessLevel;
  readonly custom?: Record<string, unknown>;
}

// ── Operation results ─────────────────────────────────────────────────────────

export interface GetResult {
  readonly found: boolean;
  readonly bytes?: Uint8Array;
  readonly metadata?: StorageObjectMetadata;
}

export interface CopyResult {
  readonly copied: boolean;
  readonly metadata?: StorageObjectMetadata;
}

export interface MoveResult {
  readonly moved: boolean;
  readonly metadata?: StorageObjectMetadata;
}

export interface StorageListItem {
  readonly key: string;
  readonly size: number;
  readonly updatedAt: number;
}

/** Options for listing keys under a prefix. */
export interface ListOptions {
  /** Maximum number of items to return. */
  readonly limit?: number;
  /** Continuation token / key to resume listing after (exclusive). */
  readonly cursor?: string;
  /**
   * When true, collapse results to immediate children by treating `/` as a
   * directory delimiter rather than returning every key under the prefix.
   */
  readonly delimiter?: boolean;
}

// ── Access levels ─────────────────────────────────────────────────────────────

/** Access classifications (Requirement 11.1). */
export type AccessLevel =
  | "public"
  | "private"
  | "signed"
  | "authenticated"
  | "role-based"
  | "tenant-aware";

// ── Signed URLs ───────────────────────────────────────────────────────────────

/** Signed URL surface (Requirement 8). */
export type SignedOperation = "GET" | "PUT" | "DELETE";

export interface SignedUrlOptions {
  readonly expiresInMs?: number;
  readonly headers?: Record<string, string>;
  readonly contentType?: string;
  readonly maxSize?: number;
  readonly metadata?: Record<string, string>;
}

export interface SignedUrlVerification {
  readonly valid: boolean;
  readonly reason?: "expired" | "operation-mismatch" | "signature-mismatch" | "malformed";
  readonly key?: string;
  readonly op?: SignedOperation;
}

// ── Versioning ────────────────────────────────────────────────────────────────

/** Versioning (Requirement 12). */
export interface VersionInfo {
  readonly versionId: string;
  readonly size: number;
  readonly createdAt: number;
  readonly checksum: string;
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

/** Lifecycle rules (Requirement 13.1). */
export type LifecycleRule =
  | { readonly type: "delete-after-days"; readonly days: number; readonly prefix?: string }
  | { readonly type: "archive-after-months"; readonly months: number; readonly prefix?: string }
  | { readonly type: "expire-temp-uploads"; readonly afterMs: number }
  | {
      readonly type: "move-to-cold";
      readonly afterDays: number;
      readonly coldPrefix: string;
      readonly prefix?: string;
    };

export interface LifecycleOutcome {
  readonly key: string;
  readonly action: "deleted" | "archived" | "expired" | "moved";
}

// ── Validation ────────────────────────────────────────────────────────────────

/** Validation (Requirement 9). */
export interface ValidationConfig {
  readonly allowedMimeTypes?: readonly string[];
  readonly allowedExtensions?: readonly string[];
  readonly maxSize?: number;
  readonly filenamePattern?: RegExp;
  readonly requireChecksum?: boolean;
  readonly custom?: (input: ValidationInput) => ValidationResult | Promise<ValidationResult>;
}

/** The subject a validator inspects before any content is persisted. */
export interface ValidationInput {
  readonly key: string;
  readonly size: number;
  readonly contentType?: string;
  readonly checksum?: string;
  readonly metadata?: WriteMetadata;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly error?: string;
}

// ── Search ────────────────────────────────────────────────────────────────────

/** Search (Requirement 16.1). */
export interface SearchFilters {
  readonly prefix?: string;
  readonly contentType?: string;
  readonly owner?: string;
  readonly tenant?: string;
  readonly minSize?: number;
  readonly maxSize?: number;
  readonly updatedAfter?: number;
  readonly updatedBefore?: number;
  readonly metadata?: Record<string, unknown>;
}

// ── Structural bridge / auth / codec contracts ────────────────────────────────
//
// These are minimal structural shapes referenced by StorageConfig. The concrete
// access/image/integration modules import these contracts from this module and
// depend only on the shape (never on a concrete package), preserving the
// no-hard-dependency / no-circular-dependency guarantee (Requirements 17.2,
// 18.3, 19.2, 28.3).

/** Structural auth bridge used for access-level decisions (optional). */
export interface AuthLike {
  /** Resolve whether the given context is permitted to perform an operation. */
  can(context: {
    readonly key: string;
    readonly operation: string;
    readonly accessLevel: AccessLevel;
    readonly owner?: string;
    readonly tenant?: string;
  }): boolean | Promise<boolean>;
}

/** Structural image codec used by the image processor (optional). */
export interface ImageCodec {
  /** Transform/convert source image bytes, returning the processed bytes. */
  transform(
    bytes: Uint8Array,
    operation: {
      readonly resize?: { readonly width?: number; readonly height?: number };
      readonly format?: string;
      readonly quality?: number;
    },
  ): Uint8Array | Promise<Uint8Array>;
}

/** Structural events bridge: publishes typed storage events (optional). */
export interface EventsLike {
  publish(event: string, payload: unknown): void | Promise<void>;
}

/** Structural queue bridge: dispatches background jobs (optional). */
export interface QueueLike {
  dispatch(job: string, payload: unknown): void | Promise<void>;
}

/** Structural realtime bridge: broadcasts upload progress/state (optional). */
export interface RealtimeLike {
  broadcast(channel: string, event: string, payload: unknown): void | Promise<void>;
}

// ── Configuration ─────────────────────────────────────────────────────────────

/** Configuration (Requirement 1). */
export interface StorageConfig {
  readonly provider: "memory" | "local" | (string & {});
  readonly driver?: StorageDriver; // pre-constructed cloud driver (submodule)
  readonly root?: string; // for local driver
  readonly clock?: Clock;
  readonly validation?: ValidationConfig;
  readonly versioning?: boolean;
  readonly signingSecret?: string; // HMAC key for simulated signed URLs
  readonly metrics?: MetricsRegistry;
  readonly health?: HealthCheckRegistry;
  readonly auth?: AuthLike; // optional structural auth bridge
  readonly imageCodec?: ImageCodec; // optional structural image codec
  readonly bridges?: {
    readonly events?: EventsLike;
    readonly queue?: QueueLike;
    readonly realtime?: RealtimeLike;
  };
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface StorageStats {
  readonly uploads: number;
  readonly downloads: number;
  readonly bytesUploaded: number;
  readonly bytesDownloaded: number;
  readonly activeUploads: number;
  readonly failedUploads: number;
  readonly storageUsage: number;
  readonly multipartUploads: number;
  readonly resumableSessions: number;
}

// ── Driver probe ──────────────────────────────────────────────────────────────

/** Best-effort connectivity/quota probe result surfaced by driver health checks. */
export interface DriverProbe {
  readonly connectivity: boolean;
  readonly writable: boolean;
  readonly readable: boolean;
  readonly quotaAvailable: boolean;
}
