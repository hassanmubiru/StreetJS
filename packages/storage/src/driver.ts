/**
 * @streetjs/storage — the single driver contract.
 *
 * `StorageDriver` is the one interface every provider implements. The storage
 * facade never assumes a provider; it only calls the methods defined here.
 * Mandatory methods are the primitive object operations (`put`/`get`/`exists`/
 * `delete`/`stat`/`list`) plus streaming (`putStream`/`getStream`). Advanced
 * capabilities (`multipart`/`resumable`/`versioning`/`signedUrl`/`lifecycle`)
 * are **optional**; when a driver does not implement one natively, the facade's
 * cross-cutting layer supplies a provider-agnostic simulation built on the
 * mandatory primitives, keeping observable behavior identical across providers.
 *
 * Requirements: 2.1, 2.3, 2.4, 4.6, 5.5
 */

import type { Readable } from "node:stream";

import type {
  StorageObjectMetadata,
  WriteMetadata,
  StorageListItem,
  ListOptions,
  VersionInfo,
  SignedOperation,
  SignedUrlOptions,
  SignedUrlVerification,
  LifecycleRule,
  LifecycleOutcome,
  DriverProbe,
} from "./types.js";

/** Node's `Readable` stream, used for streaming uploads/downloads. */
export type NodeReadable = Readable;

/** Result of a lookup that may be absent, distinguishing "not found" from errors. */
export type MaybeObject =
  | { readonly found: true; readonly bytes: Uint8Array; readonly metadata: StorageObjectMetadata }
  | { readonly found: false };

/** A single stored part for multipart assembly. */
export interface StoredPart {
  readonly partNumber: number;
  readonly etag: string;
  readonly size: number;
}

/**
 * The single contract every provider implements. Mandatory methods are the
 * primitive object operations; capability methods are optional and, when
 * absent, are simulated by the facade over the primitives.
 */
export interface StorageDriver {
  /** Stable driver name (e.g. "memory", "local", "s3"). */
  readonly name: string;

  // ── Mandatory primitives ──────────────────────────────────────────────────
  put(key: string, bytes: Uint8Array, metadata: WriteMetadata): Promise<StorageObjectMetadata>;
  get(key: string): Promise<MaybeObject>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  stat(key: string): Promise<StorageObjectMetadata | null>;
  list(prefix: string, options?: ListOptions): Promise<StorageListItem[]>;

  // ── Streaming (mandatory; may be a wrapper over put/get for small providers) ─
  putStream(key: string, stream: NodeReadable, metadata: WriteMetadata): Promise<StorageObjectMetadata>;
  getStream(key: string): Promise<NodeReadable>;

  // ── Optional capabilities (facade simulates when undefined) ─────────────────
  multipart?: MultipartCapability;
  resumable?: ResumableCapability;
  versioning?: VersioningCapability;
  signedUrl?: SignedUrlCapability;
  lifecycle?: LifecycleCapability;

  /** Best-effort connectivity/quota probe for health checks. */
  probe?(): Promise<DriverProbe>;
}

export interface MultipartCapability {
  create(key: string, metadata: WriteMetadata): Promise<string>;
  uploadPart(uploadId: string, partNumber: number, bytes: Uint8Array): Promise<StoredPart>;
  complete(uploadId: string, parts: readonly StoredPart[]): Promise<StorageObjectMetadata>;
  abort(uploadId: string): Promise<void>;
}

export interface ResumableCapability {
  start(key: string, metadata: WriteMetadata): Promise<string>;
  append(sessionId: string, bytes: Uint8Array, offset: number): Promise<number>; // returns new offset
  offset(sessionId: string): Promise<number>;
  finish(sessionId: string): Promise<StorageObjectMetadata>;
  cancel(sessionId: string): Promise<void>;
}

export interface VersioningCapability {
  snapshot(key: string): Promise<string | null>; // returns versionId, or null if nothing to snapshot
  list(key: string): Promise<VersionInfo[]>;
  restore(key: string, versionId: string): Promise<StorageObjectMetadata>;
  deleteVersion(key: string, versionId: string): Promise<void>;
}

export interface SignedUrlCapability {
  sign(key: string, op: SignedOperation, options: SignedUrlOptions): Promise<string>;
  verify(url: string, now: number): SignedUrlVerification;
}

export interface LifecycleCapability {
  apply(rule: LifecycleRule, now: number): Promise<LifecycleOutcome[]>;
}
