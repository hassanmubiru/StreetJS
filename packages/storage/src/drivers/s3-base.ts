/**
 * @streetjs/storage — the shared S3-style driver base and {@link S3ClientLike}.
 *
 * S3-compatible providers (Amazon S3, Cloudflare R2, MinIO, and the Backblaze B2
 * S3 API) share one wire shape: a small set of object operations
 * (`putObject`/`getObject`/`deleteObject`/`listObjects`) plus optional
 * multipart and presign calls. This module captures that shape as the structural
 * {@link S3ClientLike} interface and maps the {@link StorageDriver} contract onto
 * it, so `s3.ts`, `r2.ts`, `minio.ts`, and `backblaze.ts` (tasks 28.2–28.5) only
 * differ in how they build/configure the client, never in how the contract is
 * satisfied.
 *
 * ## SDK isolation (Requirements 3.1, 3.3)
 *
 * This module imports **no provider SDK** at the top level — only Node built-ins,
 * `streetjs` (for the injected {@link Clock}), and this package's own type
 * surface. The base accepts an **injected** {@link S3ClientLike}; it never
 * resolves an SDK itself. The concrete submodules that *can* construct their own
 * client do so with a **lazy dynamic `import()`** performed inside that submodule
 * at construction time, so the optional peer SDK is resolved only when that
 * submodule is actually imported. `streetjs` therefore stays the only runtime
 * dependency.
 *
 * ## Capability delegation (Requirement 2.3)
 *
 * The base implements the **mandatory primitives** (`put`/`get`/`exists`/
 * `delete`/`stat`/`list`/`putStream`/`getStream`) by mapping onto
 * {@link S3ClientLike}, producing every {@link StorageObjectMetadata} through the
 * shared metadata layer ({@link buildObjectMetadata}) so the field set is
 * identical to Memory/Local, and reporting a missing key consistently
 * ({@link MaybeObject} `{ found: false }` for `get`, `null` for `stat`,
 * {@link NotFoundError} for `getStream`).
 *
 * Advanced capabilities are **delegated to the client when available, otherwise
 * left `undefined` so the facade simulates them over the primitives**
 * (Requirement 2, keeping behavior identical across providers):
 *
 * - **Multipart** is wired only when the client exposes the full SDK-shaped
 *   multipart method set; the base adapts those calls into a
 *   {@link MultipartCapability}, tracking the `uploadId → key` mapping the S3 API
 *   requires.
 * - **Versioning / lifecycle / signed URLs** are delegated only when a native
 *   capability object is supplied through `options.capabilities`; otherwise they
 *   are left `undefined`. (A provider's presigned URLs are verified by the
 *   provider, not locally, so the base does not synthesize a
 *   {@link SignedUrlCapability} from a bare `presignUrl` — the facade's HMAC
 *   simulation is used instead unless a full native capability is injected.)
 *
 * _Requirements: 2.3, 3.1, 3.3_
 */

import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { systemClock, type Clock } from "streetjs";

import type {
  MaybeObject,
  MultipartCapability,
  NodeReadable,
  StorageDriver,
  StoredPart,
  VersioningCapability,
  SignedUrlCapability,
  LifecycleCapability,
} from "../driver.js";
import { NotFoundError } from "../errors.js";
import { buildObjectMetadata } from "../metadata.js";
import type {
  AccessLevel,
  ListOptions,
  StorageListItem,
  StorageObjectMetadata,
  WriteMetadata,
} from "../types.js";

// ── The structural S3 client ──────────────────────────────────────────────────

/** Input to {@link S3ClientLike.putObject}. */
export interface S3PutObjectInput {
  readonly key: string;
  readonly body: Uint8Array;
  readonly contentType?: string;
  /** Provider "user metadata" (string→string), used to carry typed metadata. */
  readonly metadata?: Record<string, string>;
}

/** Result of {@link S3ClientLike.putObject}. */
export interface S3PutObjectOutput {
  readonly etag: string;
}

/** Result of {@link S3ClientLike.getObject} (the object body plus attributes). */
export interface S3GetObjectOutput {
  readonly body: Uint8Array;
  readonly contentType?: string;
  readonly etag?: string;
  readonly size?: number;
  /** Last-modified time as epoch ms. */
  readonly lastModified?: number;
  readonly metadata?: Record<string, string>;
}

/** Result of {@link S3ClientLike.headObject} (attributes only, no body). */
export interface S3HeadObjectOutput {
  readonly contentType?: string;
  readonly etag?: string;
  readonly size?: number;
  readonly lastModified?: number;
  readonly metadata?: Record<string, string>;
}

/** A single entry returned by {@link S3ClientLike.listObjects}. */
export interface S3ListItem {
  readonly key: string;
  readonly size: number;
  /** Last-modified time as epoch ms. */
  readonly updatedAt: number;
}

/** Options passed to {@link S3ClientLike.listObjects}. */
export interface S3ListInput {
  readonly prefix: string;
  readonly limit?: number;
  readonly cursor?: string;
  readonly delimiter?: boolean;
}

/**
 * The **minimal, SDK-shaped structural interface** an S3-style driver depends on.
 *
 * It describes just the provider calls the driver needs — never any concrete
 * SDK type — so the actual SDK stays an optional peer concern of the consumer
 * (Requirement 3.1). The four object operations are mandatory; `headObject`,
 * the multipart method set, and `presignUrl` are optional and unlock the
 * corresponding native paths when present.
 */
export interface S3ClientLike {
  /** Store `body` under `key` with optional content type and user metadata. */
  putObject(input: S3PutObjectInput): Promise<S3PutObjectOutput>;
  /** Fetch the object at `key`, or `null` when it does not exist. */
  getObject(input: { readonly key: string }): Promise<S3GetObjectOutput | null>;
  /** Delete the object at `key` (a no-op when it is already absent). */
  deleteObject(input: { readonly key: string }): Promise<void>;
  /** List objects whose key begins with `prefix`. */
  listObjects(input: S3ListInput): Promise<readonly S3ListItem[]>;

  /** Fetch object attributes without the body, or `null` when absent (optional). */
  headObject?(input: { readonly key: string }): Promise<S3HeadObjectOutput | null>;

  // ── Optional native multipart (all four required to enable the capability) ──
  createMultipartUpload?(input: {
    readonly key: string;
    readonly contentType?: string;
    readonly metadata?: Record<string, string>;
  }): Promise<{ readonly uploadId: string }>;
  uploadPart?(input: {
    readonly key: string;
    readonly uploadId: string;
    readonly partNumber: number;
    readonly body: Uint8Array;
  }): Promise<{ readonly etag: string }>;
  completeMultipartUpload?(input: {
    readonly key: string;
    readonly uploadId: string;
    readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
  }): Promise<{ readonly etag: string }>;
  abortMultipartUpload?(input: {
    readonly key: string;
    readonly uploadId: string;
  }): Promise<void>;

  /**
   * Mint a provider presigned URL for `key` (optional). Consumed by concrete
   * provider drivers that expose native presigned URLs; the base does not build
   * a {@link SignedUrlCapability} from it because provider URLs are verified by
   * the provider, not locally.
   */
  presignUrl?(input: {
    readonly key: string;
    readonly op: "GET" | "PUT" | "DELETE";
    readonly expiresInMs: number;
  }): Promise<string>;
}

// ── User-metadata encoding keys ───────────────────────────────────────────────

/**
 * Reserved user-metadata keys used to round-trip the typed metadata field set
 * through the provider's string→string user-metadata map. Prefixed so they never
 * collide with a caller's own custom fields.
 */
const MK = {
  checksum: "x-street-checksum",
  createdAt: "x-street-created-at",
  updatedAt: "x-street-updated-at",
  owner: "x-street-owner",
  tenant: "x-street-tenant",
  accessLevel: "x-street-access-level",
  custom: "x-street-custom",
} as const;

// ── Base options ──────────────────────────────────────────────────────────────

/** Native capability objects a provider driver may inject for delegation. */
export interface S3NativeCapabilities {
  readonly versioning?: VersioningCapability;
  readonly lifecycle?: LifecycleCapability;
  readonly signedUrl?: SignedUrlCapability;
}

/** Options for {@link createS3StyleDriver} / {@link S3StyleDriver}. */
export interface S3StyleDriverOptions {
  /** Stable driver name surfaced as {@link StorageDriver.name}. Default `"s3"`. */
  readonly name?: string;
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
  /**
   * Native capability objects to delegate to. Any capability omitted here (and
   * not derivable from the client) is left `undefined` so the facade simulates
   * it over the primitives.
   */
  readonly capabilities?: S3NativeCapabilities;
}

// ── The S3-style base driver ──────────────────────────────────────────────────

/**
 * Maps the {@link StorageDriver} contract onto an injected {@link S3ClientLike}.
 *
 * This class is provider-agnostic: every S3-compatible driver (S3, R2, MinIO,
 * Backblaze) is this base with a differently-constructed client. It imports no
 * provider SDK; the client is supplied by the caller (typically a submodule that
 * lazily `import()`s its SDK).
 */
export class S3StyleDriver implements StorageDriver {
  readonly name: string;

  private readonly client: S3ClientLike;
  private readonly clock: Clock;

  /** Tracks the `key` for each in-flight multipart `uploadId` (S3 needs both). */
  private readonly multipartKeys = new Map<string, string>();

  // Optional capabilities — populated only when delegation is available.
  multipart?: MultipartCapability;
  versioning?: VersioningCapability;
  signedUrl?: SignedUrlCapability;
  lifecycle?: LifecycleCapability;

  constructor(client: S3ClientLike, options: S3StyleDriverOptions = {}) {
    this.client = client;
    this.name = options.name ?? "s3";
    this.clock = options.clock ?? systemClock;

    // Wire native multipart only when the client exposes the full method set;
    // otherwise the facade simulates multipart over put/get.
    if (
      typeof client.createMultipartUpload === "function" &&
      typeof client.uploadPart === "function" &&
      typeof client.completeMultipartUpload === "function" &&
      typeof client.abortMultipartUpload === "function"
    ) {
      this.multipart = this.buildMultipartCapability();
    }

    // Delegate versioning/lifecycle/signed URLs only when a native capability
    // object is injected; otherwise leave undefined for facade simulation.
    this.versioning = options.capabilities?.versioning;
    this.lifecycle = options.capabilities?.lifecycle;
    this.signedUrl = options.capabilities?.signedUrl;
  }

  // ── Mandatory primitives ──────────────────────────────────────────────────

  /**
   * Store `bytes` under `key`, computing size and sha-256 checksum locally and
   * taking timestamps from the injected clock. When overwriting, the original
   * `createdAt` is preserved (a preceding attribute read). The typed metadata is
   * encoded into the provider's user-metadata map so it round-trips on read
   * (Requirements 4.1, 10.1, 10.2).
   */
  async put(
    key: string,
    bytes: Uint8Array,
    metadata: WriteMetadata,
  ): Promise<StorageObjectMetadata> {
    const stored = bytes.slice();
    const checksum = sha256Hex(stored);
    const now = this.clock();
    const existing = await this.readMeta(key);

    const objectMetadata = buildObjectMetadata({
      key,
      size: stored.byteLength,
      checksum,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      write: metadata,
    });

    await this.client.putObject({
      key,
      body: stored,
      contentType: objectMetadata.contentType,
      metadata: encodeUserMetadata(objectMetadata),
    });

    return objectMetadata;
  }

  /**
   * Read the object at `key`, returning a discriminated {@link MaybeObject} so
   * absence is reported rather than thrown (Requirements 4.2, 2.4). Metadata is
   * rebuilt from the provider attributes and encoded user metadata via the
   * shared metadata layer.
   */
  async get(key: string): Promise<MaybeObject> {
    const out = await this.client.getObject({ key });
    if (out === null) {
      return { found: false };
    }
    const bytes = out.body.slice();
    const metadata = this.decodeMeta(key, {
      contentType: out.contentType,
      etag: out.etag,
      size: bytes.byteLength,
      lastModified: out.lastModified,
      metadata: out.metadata,
    });
    return { found: true, bytes, metadata };
  }

  /** Report whether an object is stored under `key` (Requirement 4.3). */
  async exists(key: string): Promise<boolean> {
    if (typeof this.client.headObject === "function") {
      const head = await this.client.headObject({ key });
      return head !== null;
    }
    const out = await this.client.getObject({ key });
    return out !== null;
  }

  /** Delete the object at `key`; deleting a missing key is a no-op (Requirement 4.4). */
  async delete(key: string): Promise<void> {
    await this.client.deleteObject({ key });
  }

  /**
   * Return the metadata for `key` without its content, or `null` when absent
   * (Requirement 4.10). Uses `headObject` when available, else falls back to a
   * body fetch.
   */
  async stat(key: string): Promise<StorageObjectMetadata | null> {
    if (typeof this.client.headObject === "function") {
      const head = await this.client.headObject({ key });
      if (head === null) {
        return null;
      }
      return this.decodeMeta(key, head);
    }
    const out = await this.client.getObject({ key });
    if (out === null) {
      return null;
    }
    return this.decodeMeta(key, {
      contentType: out.contentType,
      etag: out.etag,
      size: out.size ?? out.body.byteLength,
      lastModified: out.lastModified,
      metadata: out.metadata,
    });
  }

  /** List objects whose key begins with `prefix` (Requirement 4.9). */
  async list(prefix: string, options?: ListOptions): Promise<StorageListItem[]> {
    const items = await this.client.listObjects({
      prefix,
      limit: options?.limit,
      cursor: options?.cursor,
      delimiter: options?.delimiter,
    });
    return items.map((item) => ({
      key: item.key,
      size: item.size,
      updatedAt: item.updatedAt,
    }));
  }

  // ── Streaming ───────────────────────────────────────────────────────────────

  /**
   * Consume a Node {@link Readable} and persist the assembled bytes under `key`
   * with the same computed metadata as {@link put} (Requirement 5.1). Chunks are
   * drained through a `pipeline` (correct backpressure and error propagation),
   * then handed to {@link put}.
   */
  async putStream(
    key: string,
    stream: NodeReadable,
    metadata: WriteMetadata,
  ): Promise<StorageObjectMetadata> {
    const chunks: Buffer[] = [];
    const collector = new Writable({
      write(chunk: unknown, _encoding, callback): void {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
        callback();
      },
    });

    await pipeline(stream, collector);

    return this.put(key, new Uint8Array(Buffer.concat(chunks)), metadata);
  }

  /**
   * Return a Node {@link Readable} of the stored bytes at `key` (Requirement
   * 5.2). Throws {@link NotFoundError} for a missing key (Requirement 5.5).
   */
  async getStream(key: string): Promise<NodeReadable> {
    const out = await this.client.getObject({ key });
    if (out === null) {
      throw new NotFoundError(key);
    }
    return Readable.from([Buffer.from(out.body)]);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Best-effort read of an object's existing metadata (used to preserve
   * `createdAt` on overwrite). Returns `null` when the object does not exist.
   */
  private async readMeta(key: string): Promise<StorageObjectMetadata | null> {
    return this.stat(key);
  }

  /**
   * Rebuild the typed {@link StorageObjectMetadata} field set from provider
   * attributes and the encoded user-metadata map, applying the shared layer's
   * canonical defaults. Provider-supplied values are used as best-effort
   * fallbacks when the encoded fields are absent (e.g. an object written outside
   * this base): `etag`/`size`/`lastModified` back-fill the identity/timestamp
   * fields, keeping the shape consistent across providers.
   */
  private decodeMeta(key: string, out: S3HeadObjectOutput): StorageObjectMetadata {
    const um = out.metadata ?? {};
    const now = this.clock();
    const checksum = um[MK.checksum] ?? out.etag ?? "";
    const createdAt = parseEpoch(um[MK.createdAt]) ?? out.lastModified ?? now;
    const updatedAt = parseEpoch(um[MK.updatedAt]) ?? out.lastModified ?? createdAt;

    const write: WriteMetadata = {
      contentType: out.contentType,
      owner: um[MK.owner],
      tenant: um[MK.tenant],
      accessLevel: decodeAccessLevel(um[MK.accessLevel]),
      custom: parseCustom(um[MK.custom]),
    };

    return buildObjectMetadata({
      key,
      size: out.size ?? 0,
      checksum,
      etag: out.etag ?? checksum,
      createdAt,
      updatedAt,
      write,
    });
  }

  /**
   * Adapt the client's SDK-shaped multipart calls into a
   * {@link MultipartCapability}. The S3 API requires the object key on every
   * part/complete/abort call, so the `uploadId → key` mapping is tracked here.
   */
  private buildMultipartCapability(): MultipartCapability {
    const client = this.client;
    const clock = this.clock;
    const keys = this.multipartKeys;
    const readMeta = (key: string): Promise<StorageObjectMetadata | null> => this.stat(key);

    const requireKey = (uploadId: string): string => {
      const key = keys.get(uploadId);
      if (key === undefined) {
        throw new NotFoundError(uploadId, `Unknown multipart upload "${uploadId}"`);
      }
      return key;
    };

    return {
      async create(key: string, metadata: WriteMetadata): Promise<string> {
        const now = clock();
        const { uploadId } = await client.createMultipartUpload!({
          key,
          contentType: metadata.contentType,
          metadata: encodeWriteMetadata(metadata, now),
        });
        keys.set(uploadId, key);
        return uploadId;
      },

      async uploadPart(
        uploadId: string,
        partNumber: number,
        bytes: Uint8Array,
      ): Promise<StoredPart> {
        const key = requireKey(uploadId);
        const { etag } = await client.uploadPart!({ key, uploadId, partNumber, body: bytes });
        return { partNumber, etag, size: bytes.byteLength };
      },

      async complete(
        uploadId: string,
        parts: readonly StoredPart[],
      ): Promise<StorageObjectMetadata> {
        const key = requireKey(uploadId);
        await client.completeMultipartUpload!({
          key,
          uploadId,
          parts: parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag })),
        });
        keys.delete(uploadId);
        const metadata = await readMeta(key);
        if (metadata !== null) {
          return metadata;
        }
        // The object should exist after completion; fall back to a minimal,
        // shaped record if the provider cannot immediately describe it.
        const now = clock();
        const size = parts.reduce((total, part) => total + part.size, 0);
        return buildObjectMetadata({
          key,
          size,
          checksum: "",
          createdAt: now,
          updatedAt: now,
          write: {},
        });
      },

      async abort(uploadId: string): Promise<void> {
        const key = requireKey(uploadId);
        await client.abortMultipartUpload!({ key, uploadId });
        keys.delete(uploadId);
      },
    };
  }
}

/**
 * Construct an S3-style {@link StorageDriver} over an injected
 * {@link S3ClientLike}. This is the entry point consumed by the concrete
 * provider submodules (`s3.ts`/`r2.ts`/`minio.ts`/`backblaze.ts`), each of which
 * supplies a differently-constructed client.
 */
export function createS3StyleDriver(
  client: S3ClientLike,
  options?: S3StyleDriverOptions,
): StorageDriver {
  return new S3StyleDriver(client, options);
}

// ── Module-private encoding helpers ────────────────────────────────────────────

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Encode a built object's typed metadata into the provider user-metadata map. */
function encodeUserMetadata(metadata: StorageObjectMetadata): Record<string, string> {
  const map: Record<string, string> = {
    [MK.checksum]: metadata.checksum,
    [MK.createdAt]: String(metadata.createdAt),
    [MK.updatedAt]: String(metadata.updatedAt),
    [MK.accessLevel]: metadata.accessLevel,
    [MK.custom]: JSON.stringify(metadata.custom ?? {}),
  };
  if (metadata.owner !== undefined) {
    map[MK.owner] = metadata.owner;
  }
  if (metadata.tenant !== undefined) {
    map[MK.tenant] = metadata.tenant;
  }
  return map;
}

/**
 * Encode write-time metadata (plus timestamps) into a user-metadata map for a
 * multipart create, so the assembled object round-trips its typed fields.
 */
function encodeWriteMetadata(metadata: WriteMetadata, now: number): Record<string, string> {
  const map: Record<string, string> = {
    [MK.createdAt]: String(now),
    [MK.updatedAt]: String(now),
    [MK.accessLevel]: metadata.accessLevel ?? "private",
    [MK.custom]: JSON.stringify(metadata.custom ?? {}),
  };
  if (metadata.owner !== undefined) {
    map[MK.owner] = metadata.owner;
  }
  if (metadata.tenant !== undefined) {
    map[MK.tenant] = metadata.tenant;
  }
  return map;
}

/** Parse an epoch-ms string, returning `undefined` when absent or non-numeric. */
function parseEpoch(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse the encoded custom-field JSON, tolerating malformed values. */
function parseCustom(value: string | undefined): Record<string, unknown> {
  if (value === undefined) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the empty default on malformed JSON.
  }
  return {};
}

/** The recognized access levels, used to validate the decoded value. */
const ACCESS_LEVELS: readonly AccessLevel[] = [
  "public",
  "private",
  "signed",
  "authenticated",
  "role-based",
  "tenant-aware",
];

/** Decode an access-level string, returning `undefined` for an unknown value. */
function decodeAccessLevel(value: string | undefined): AccessLevel | undefined {
  if (value !== undefined && (ACCESS_LEVELS as readonly string[]).includes(value)) {
    return value as AccessLevel;
  }
  return undefined;
}
