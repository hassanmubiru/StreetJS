/**
 * @streetjs/storage — GoogleCloudStorageDriver (submodule `@streetjs/storage/gcs`).
 *
 * Google Cloud Storage is **not** an S3-wire-compatible provider — its SDK
 * exposes a bucket/file object model (`bucket.file(name).save/download/delete/
 * exists/getMetadata`, `bucket.getFiles({ prefix })`) rather than the
 * `putObject`/`getObject` verbs the S3-style base is built on. So, unlike
 * `r2.ts`/`minio.ts`/`backblaze.ts`, this driver does **not** extend the shared
 * S3 base ({@link ../drivers/s3-base}); it maps the {@link StorageDriver}
 * contract directly onto a purpose-built structural {@link GcsClientLike} that
 * mirrors just the GCS calls it needs.
 *
 * ## Two ways to obtain a driver
 *
 * - {@link createGoogleCloudStorageDriver} wraps an **already-constructed,
 *   injected** {@link GcsClientLike} and returns a driver synchronously. This is
 *   the SDK-free path: no provider SDK is touched, so it is fully testable with
 *   an in-memory fake and needs no `@google-cloud/storage` install.
 * - {@link connectGoogleCloudStorageDriver} **builds its own client** from GCS
 *   connection config. It resolves `@google-cloud/storage` through a **lazy
 *   dynamic `import()` performed inside the function** (never at module top
 *   level), so the optional peer dependency is only required when this path is
 *   actually used. If the SDK is not installed and no client was injected, it
 *   throws {@link StorageConfigError} (Requirement 1.5).
 *
 * ## Capability delegation (Requirement 2.3)
 *
 * The driver implements only the **mandatory primitives** (`put`/`get`/`exists`/
 * `delete`/`stat`/`list`/`putStream`/`getStream`), producing every
 * {@link StorageObjectMetadata} through the shared metadata layer
 * ({@link buildObjectMetadata}) so the field set is identical to Memory/Local/S3,
 * and reporting a missing key consistently ({@link MaybeObject} `{ found: false }`
 * for `get`, `null` for `stat`, {@link NotFoundError} for `getStream`). Advanced
 * capabilities (`multipart`/`resumable`/`versioning`/`signedUrl`/`lifecycle`) are
 * intentionally left `undefined` so the facade simulates them over the
 * primitives, keeping behavior identical across providers.
 *
 * ## SDK isolation (Requirements 2.1, 3.3)
 *
 * This module imports **no provider SDK at the top level** — only Node built-ins,
 * `streetjs` (for the injected {@link Clock}), and this package's own type
 * surface. `@google-cloud/storage` is referenced solely via a dynamic `import()`
 * with a non-literal specifier inside {@link connectGoogleCloudStorageDriver}, so
 * `tsc` never requires the SDK to be present and `streetjs` stays the only
 * runtime dependency. This driver is a submodule-only export
 * (`./gcs` → `dist/drivers/gcs.js`); it is intentionally not re-exported from the
 * package's main `index.ts`.
 *
 * _Requirements: 2.1, 2.3, 3.3_
 */

import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { systemClock, type Clock } from "streetjs";

import type { MaybeObject, NodeReadable, StorageDriver } from "../driver.js";
import { NotFoundError, StorageConfigError } from "../errors.js";
import { buildObjectMetadata } from "../metadata.js";
import type {
  AccessLevel,
  ListOptions,
  StorageListItem,
  StorageObjectMetadata,
  WriteMetadata,
} from "../types.js";

/** The stable driver name surfaced as {@link StorageDriver.name} for GCS. */
const GCS_DRIVER_NAME = "gcs";

// ── The structural GCS client ─────────────────────────────────────────────────

/**
 * Object attributes as surfaced by the GCS object model (`file.getMetadata()` /
 * entries from `bucket.getFiles`). Every field is optional and loosely typed
 * because GCS returns `size` as a numeric string and timestamps as RFC-3339
 * strings; the driver normalizes them. Caller-supplied user metadata lives under
 * the nested {@link metadata} map (GCS's "custom metadata").
 */
export interface GcsObjectAttributes {
  /** Byte length. GCS returns this as a numeric string; a number is tolerated. */
  readonly size?: number | string;
  /** Declared content type. */
  readonly contentType?: string;
  /** Entity tag. */
  readonly etag?: string;
  /** Base64 MD5 hash of the content, when present. */
  readonly md5Hash?: string;
  /** Creation time as an RFC-3339 / ISO-8601 string. */
  readonly timeCreated?: string;
  /** Last-updated time as an RFC-3339 / ISO-8601 string. */
  readonly updated?: string;
  /** Caller-supplied custom metadata (string→string), GCS's "metadata" map. */
  readonly metadata?: Record<string, string>;
}

/** Options accepted by {@link GcsClientLike.save}. */
export interface GcsSaveOptions {
  /** Content type to persist alongside the object. */
  readonly contentType?: string;
  /** Custom metadata (string→string) to persist as GCS object metadata. */
  readonly metadata?: Record<string, string>;
}

/** Options accepted by {@link GcsClientLike.getFiles}. */
export interface GcsListInput {
  /** Only list objects whose name begins with this prefix. */
  readonly prefix: string;
  /** When set, collapse results on this delimiter (GCS directory semantics). */
  readonly delimiter?: string;
  /** Best-effort maximum number of results the caller wants. */
  readonly maxResults?: number;
}

/** A single object entry returned by {@link GcsClientLike.getFiles}. */
export interface GcsFileEntry {
  /** The object name (full key). */
  readonly name: string;
  /** The entry's attributes, when the listing includes them. */
  readonly attributes?: GcsObjectAttributes;
}

/**
 * The **minimal, GCS-shaped structural interface** this driver depends on.
 *
 * It is bucket-scoped (the concrete adapter binds a bucket) and describes just
 * the object operations the driver needs — never any concrete
 * `@google-cloud/storage` type — so the SDK stays an optional peer concern of the
 * consumer (Requirement 3.1). `download`/`getMetadata` return `null` for a
 * missing object so not-found maps to the contract's consistent semantics rather
 * than a thrown error.
 */
export interface GcsClientLike {
  /** Store `bytes` under `name` with optional content type and custom metadata. */
  save(name: string, bytes: Uint8Array, options?: GcsSaveOptions): Promise<void>;
  /** Download the object's bytes, or `null` when it does not exist. */
  download(name: string): Promise<Uint8Array | null>;
  /** Delete the object at `name` (a no-op when it is already absent). */
  delete(name: string): Promise<void>;
  /** Report whether an object exists at `name`. */
  exists(name: string): Promise<boolean>;
  /** Fetch the object's attributes, or `null` when it does not exist. */
  getMetadata(name: string): Promise<GcsObjectAttributes | null>;
  /** List objects whose name begins with `input.prefix`. */
  getFiles(input: GcsListInput): Promise<readonly GcsFileEntry[]>;
}

// ── Reserved user-metadata keys ────────────────────────────────────────────────

/**
 * Reserved custom-metadata keys used to round-trip the typed metadata field set
 * through GCS's string→string object-metadata map. Prefixed so they never
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

// ── Driver options ─────────────────────────────────────────────────────────────

/**
 * Options for the GCS driver. The provider name is fixed to `"gcs"` and is not
 * caller-configurable, so provider identity stays stable.
 */
export interface GoogleCloudStorageDriverOptions {
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
}

// ── The GCS driver ─────────────────────────────────────────────────────────────

/**
 * Maps the {@link StorageDriver} contract onto an injected {@link GcsClientLike}.
 *
 * Object identity fields (`etag`/`checksum`/`size`) and timestamps are computed
 * locally at write time — the checksum/etag are the sha-256 hex digest of the
 * stored bytes, the size is the byte length, and timestamps come from the
 * injected {@link Clock} — then encoded into the object's custom metadata so they
 * round-trip on read. Advanced capabilities are left `undefined` for facade
 * simulation.
 */
export class GoogleCloudStorageDriver implements StorageDriver {
  /** Stable driver name. */
  readonly name = GCS_DRIVER_NAME;

  private readonly client: GcsClientLike;
  private readonly clock: Clock;

  constructor(client: GcsClientLike, options: GoogleCloudStorageDriverOptions = {}) {
    this.client = client;
    this.clock = options.clock ?? systemClock;
  }

  // ── Mandatory primitives ──────────────────────────────────────────────────

  /**
   * Store `bytes` under `key`, computing size and sha-256 checksum locally and
   * taking timestamps from the injected clock. When overwriting, the original
   * `createdAt` is preserved (a preceding attribute read). The typed metadata is
   * encoded into the object's custom-metadata map so it round-trips on read
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
    const existing = await this.stat(key);

    const objectMetadata = buildObjectMetadata({
      key,
      size: stored.byteLength,
      checksum,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      write: metadata,
    });

    await this.client.save(key, stored, {
      contentType: objectMetadata.contentType,
      metadata: encodeUserMetadata(objectMetadata),
    });

    return objectMetadata;
  }

  /**
   * Read the object at `key`, returning a discriminated {@link MaybeObject} so
   * absence is reported rather than thrown (Requirements 4.2, 2.4). Metadata is
   * rebuilt from the object's attributes and encoded custom metadata via the
   * shared metadata layer.
   */
  async get(key: string): Promise<MaybeObject> {
    const bytes = await this.client.download(key);
    if (bytes === null) {
      return { found: false };
    }
    const attributes = await this.client.getMetadata(key);
    const metadata = this.decodeMeta(key, bytes.byteLength, attributes);
    return { found: true, bytes: bytes.slice(), metadata };
  }

  /** Report whether an object is stored under `key` (Requirement 4.3). */
  async exists(key: string): Promise<boolean> {
    return this.client.exists(key);
  }

  /** Delete the object at `key`; deleting a missing key is a no-op (Requirement 4.4). */
  async delete(key: string): Promise<void> {
    await this.client.delete(key);
  }

  /**
   * Return the metadata for `key` without its content, or `null` when absent
   * (Requirement 4.10).
   */
  async stat(key: string): Promise<StorageObjectMetadata | null> {
    const attributes = await this.client.getMetadata(key);
    if (attributes === null) {
      return null;
    }
    const size = parseSize(attributes.size);
    return this.decodeMeta(key, size, attributes);
  }

  /**
   * List objects whose key begins with `prefix`, sorted by key for deterministic
   * ordering (Requirement 4.9). Honors optional `cursor` (exclusive resume
   * point), `limit`, and `delimiter` (collapse to immediate children on `/`).
   */
  async list(prefix: string, options?: ListOptions): Promise<StorageListItem[]> {
    const entries = await this.client.getFiles({
      prefix,
      delimiter: options?.delimiter === true ? "/" : undefined,
    });

    let items: StorageListItem[] = entries
      .filter((entry) => typeof entry.name === "string")
      .map((entry) => ({
        key: entry.name,
        size: parseSize(entry.attributes?.size),
        updatedAt: parseIso(entry.attributes?.updated) ?? 0,
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

    const cursor = options?.cursor;
    if (cursor !== undefined) {
      items = items.filter((item) => item.key > cursor);
    }

    return typeof options?.limit === "number" ? items.slice(0, options.limit) : items;
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
    const bytes = await this.client.download(key);
    if (bytes === null) {
      throw new NotFoundError(key);
    }
    return Readable.from([Buffer.from(bytes)]);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Rebuild the typed {@link StorageObjectMetadata} field set from the object's
   * attributes and the encoded custom-metadata map, applying the shared layer's
   * canonical defaults. Provider-supplied values are used as best-effort
   * fallbacks when the encoded fields are absent (e.g. an object written outside
   * this driver): `etag`/`md5Hash`/`timeCreated`/`updated` back-fill the
   * identity/timestamp fields, keeping the shape consistent across providers.
   */
  private decodeMeta(
    key: string,
    size: number,
    attributes: GcsObjectAttributes | null,
  ): StorageObjectMetadata {
    const attrs = attributes ?? {};
    const um = attrs.metadata ?? {};
    const now = this.clock();

    const checksum = um[MK.checksum] ?? attrs.etag ?? attrs.md5Hash ?? "";
    const createdAt = parseEpoch(um[MK.createdAt]) ?? parseIso(attrs.timeCreated) ?? now;
    const updatedAt =
      parseEpoch(um[MK.updatedAt]) ?? parseIso(attrs.updated) ?? createdAt;

    const write: WriteMetadata = {
      contentType: attrs.contentType,
      owner: um[MK.owner],
      tenant: um[MK.tenant],
      accessLevel: decodeAccessLevel(um[MK.accessLevel]),
      custom: parseCustom(um[MK.custom]),
    };

    return buildObjectMetadata({
      key,
      size,
      checksum,
      etag: attrs.etag ?? checksum,
      createdAt,
      updatedAt,
      write,
    });
  }
}

/**
 * Wrap an injected {@link GcsClientLike} as a GCS driver. Synchronous and
 * SDK-free: the caller supplies the client, so no provider SDK is resolved here.
 *
 * @throws {StorageConfigError} when no client is injected — use
 *   {@link connectGoogleCloudStorageDriver} to build a client from connection
 *   options instead.
 */
export function createGoogleCloudStorageDriver(
  client: GcsClientLike,
  options: GoogleCloudStorageDriverOptions = {},
): StorageDriver {
  if (client === undefined || client === null) {
    throw new StorageConfigError(
      "createGoogleCloudStorageDriver requires an injected GcsClientLike. " +
        "Pass a structural client, or use connectGoogleCloudStorageDriver(config) " +
        "to build one from a bucket using the optional '@google-cloud/storage' peer dependency.",
      { provider: GCS_DRIVER_NAME },
    );
  }
  return new GoogleCloudStorageDriver(client, options);
}

/**
 * Connection configuration for {@link connectGoogleCloudStorageDriver}. These are
 * forwarded to the `@google-cloud/storage` `Storage` constructor (except
 * `bucket`, which scopes the resulting client).
 */
export interface GoogleCloudStorageConfig extends GoogleCloudStorageDriverOptions {
  /** The GCS bucket the driver operates within (required). */
  readonly bucket: string;
  /** GCP project id. */
  readonly projectId?: string;
  /** Path to a service-account key file. */
  readonly keyFilename?: string;
  /** Inline service-account credentials. */
  readonly credentials?: Record<string, unknown>;
  /** Custom API endpoint (e.g. a fake/emulator host). */
  readonly apiEndpoint?: string;
}

/**
 * Build a GCS driver that owns its client, resolving `@google-cloud/storage`
 * lazily.
 *
 * The SDK is loaded through a dynamic `import()` with a non-literal specifier so
 * it is never a static/top-level dependency: `tsc` does not require it to be
 * installed, and it is only resolved when this function runs. When the SDK
 * cannot be resolved, a {@link StorageConfigError} is thrown (Requirement 1.5) —
 * callers that cannot install the SDK should use
 * {@link createGoogleCloudStorageDriver} with their own {@link GcsClientLike}
 * instead.
 */
export async function connectGoogleCloudStorageDriver(
  config: GoogleCloudStorageConfig,
): Promise<StorageDriver> {
  if (!config.bucket) {
    throw new StorageConfigError(
      "GoogleCloudStorage requires a bucket name.",
      { provider: GCS_DRIVER_NAME },
    );
  }

  // Lazy, non-literal dynamic import so the GCS SDK stays an optional peer that
  // `tsc` never resolves statically and Node only loads on this path.
  const specifier = "@google-cloud/storage";
  let sdk: GcsSdkModule;
  try {
    sdk = (await import(specifier)) as unknown as GcsSdkModule;
  } catch (cause) {
    throw new StorageConfigError(
      'GoogleCloudStorage driver requires the optional peer dependency "@google-cloud/storage". ' +
        "Install it, or inject your own GcsClientLike via createGoogleCloudStorageDriver().",
      { provider: GCS_DRIVER_NAME, cause },
    );
  }

  let storage: GcsSdkStorage;
  try {
    storage = new sdk.Storage({
      projectId: config.projectId,
      keyFilename: config.keyFilename,
      credentials: config.credentials,
      apiEndpoint: config.apiEndpoint,
    });
  } catch (cause) {
    throw new StorageConfigError(
      `Failed to construct a Google Cloud Storage client for bucket "${config.bucket}".`,
      { provider: GCS_DRIVER_NAME, cause },
    );
  }

  const client = adaptGcsSdkBucket(storage.bucket(config.bucket));
  return createGoogleCloudStorageDriver(client, { clock: config.clock });
}

// ── SDK → GcsClientLike adapter ────────────────────────────────────────────────

/**
 * Adapt a `@google-cloud/storage` `Bucket` into the structural
 * {@link GcsClientLike} this driver consumes. Only the methods the driver uses
 * are mapped; the SDK response shapes are narrowed through the local structural
 * types below so this module never imports concrete SDK types. A missing object
 * (`code === 404`) is mapped to `null` so not-found semantics stay consistent.
 */
function adaptGcsSdkBucket(bucket: GcsSdkBucket): GcsClientLike {
  return {
    async save(name: string, bytes: Uint8Array, options?: GcsSaveOptions): Promise<void> {
      await bucket.file(name).save(Buffer.from(bytes), {
        contentType: options?.contentType,
        metadata: { metadata: options?.metadata },
      });
    },

    async download(name: string): Promise<Uint8Array | null> {
      try {
        const [buffer] = await bucket.file(name).download();
        return new Uint8Array(buffer);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async delete(name: string): Promise<void> {
      await bucket.file(name).delete({ ignoreNotFound: true });
    },

    async exists(name: string): Promise<boolean> {
      const [exists] = await bucket.file(name).exists();
      return exists;
    },

    async getMetadata(name: string): Promise<GcsObjectAttributes | null> {
      try {
        const [metadata] = await bucket.file(name).getMetadata();
        return metadata as GcsObjectAttributes;
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async getFiles(input: GcsListInput): Promise<readonly GcsFileEntry[]> {
      const [files] = await bucket.getFiles({
        prefix: input.prefix,
        delimiter: input.delimiter,
        maxResults: input.maxResults,
      });
      return files.map((file) => ({
        name: file.name,
        attributes: file.metadata as GcsObjectAttributes | undefined,
      }));
    },
  };
}

/**
 * Recognize the GCS "object does not exist" condition so `download`/`getMetadata`
 * can return `null` (Requirement 4.2/4.10) rather than throwing. GCS surfaces a
 * `code === 404` on the ApiError.
 */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 404;
}

// ── Module-private encoding helpers ────────────────────────────────────────────

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Encode a built object's typed metadata into the GCS custom-metadata map. */
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

/** Parse a GCS `size` (numeric string or number), defaulting to `0`. */
function parseSize(value: number | string | undefined): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Parse an epoch-ms string, returning `undefined` when absent or non-numeric. */
function parseEpoch(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Parse an RFC-3339 / ISO-8601 timestamp to epoch ms, or `undefined`. */
function parseIso(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Date.parse(value);
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

// ── Structural SDK types (never import concrete @google-cloud/storage types) ─────
//
// These describe only the slice of the `@google-cloud/storage` SDK this adapter
// touches, so the module compiles with no SDK installed and stays decoupled from
// SDK versions.

/** The `@google-cloud/storage` `File` surface this adapter drives. */
interface GcsSdkFile {
  readonly name: string;
  readonly metadata: unknown;
  save(data: Buffer, options?: Record<string, unknown>): Promise<void>;
  download(): Promise<[Buffer]>;
  delete(options?: Record<string, unknown>): Promise<unknown>;
  exists(): Promise<[boolean]>;
  getMetadata(): Promise<[unknown]>;
}

/** The `@google-cloud/storage` `Bucket` surface this adapter drives. */
interface GcsSdkBucket {
  file(name: string): GcsSdkFile;
  getFiles(options: Record<string, unknown>): Promise<[GcsSdkFile[], ...unknown[]]>;
}

/** The `@google-cloud/storage` `Storage` surface this adapter drives. */
interface GcsSdkStorage {
  bucket(name: string): GcsSdkBucket;
}

/** Structural view of the `@google-cloud/storage` module members this adapter uses. */
interface GcsSdkModule {
  Storage: new (options: Record<string, unknown>) => GcsSdkStorage;
}
