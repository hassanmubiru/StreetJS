/**
 * @streetjs/storage — SupabaseStorageDriver (submodule `@streetjs/storage/supabase`).
 *
 * Supabase Storage is **not** an S3-wire-compatible provider — its SDK exposes a
 * bucket-scoped file API (`storage.from(bucket).upload/download/remove/list/info`)
 * rather than the `putObject`/`getObject` verbs the S3-style base is built on. So,
 * unlike `s3.ts`/`r2.ts`/`minio.ts`/`backblaze.ts`, this driver does **not**
 * extend the shared S3 base ({@link ../drivers/s3-base}); it maps the
 * {@link StorageDriver} contract directly onto a purpose-built structural
 * {@link SupabaseStorageClientLike} that mirrors just the Supabase Storage calls
 * it needs.
 *
 * ## Two ways to obtain a driver
 *
 * - {@link createSupabaseStorageDriver} wraps an **already-constructed,
 *   injected** {@link SupabaseStorageClientLike} and returns a driver
 *   synchronously. This is the SDK-free path: no provider SDK is touched, so it
 *   is fully testable with an in-memory fake and needs no `@supabase/supabase-js`
 *   install.
 * - {@link connectSupabaseStorageDriver} **builds its own client** from Supabase
 *   connection config. It resolves `@supabase/supabase-js` through a **lazy
 *   dynamic `import()` performed inside the function** (never at module top
 *   level), so the optional peer dependency is only required when this path is
 *   actually used. If the SDK is not installed and no client was injected, it
 *   throws {@link StorageConfigError} (provider `"supabase"`, Requirement 1.5).
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
 * surface. `@supabase/supabase-js` is referenced solely via a dynamic `import()`
 * with a non-literal specifier inside {@link connectSupabaseStorageDriver}, so
 * `tsc` never requires the SDK to be present and `streetjs` stays the only
 * runtime dependency. This driver is a submodule-only export
 * (`./supabase` → `dist/drivers/supabase.js`); it is intentionally not
 * re-exported from the package's main `index.ts`.
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

/** The stable driver name surfaced as {@link StorageDriver.name} for Supabase. */
const SUPABASE_DRIVER_NAME = "supabase";

// ── The structural Supabase Storage client ────────────────────────────────────

/** Input to {@link SupabaseStorageClientLike.upload}. */
export interface SupabaseUploadInput {
  /** The object path (key) within the bucket. */
  readonly path: string;
  /** The bytes to store. */
  readonly body: Uint8Array;
  /** Declared content type, mapped to Supabase's `contentType` upload option. */
  readonly contentType?: string;
  /** Custom metadata (string→string) to persist; used to round-trip the field set. */
  readonly metadata?: Record<string, string>;
  /** Whether to overwrite an existing object at `path` (Supabase `upsert`). */
  readonly upsert?: boolean;
}

/** Result of {@link SupabaseStorageClientLike.upload}. */
export interface SupabaseUploadResult {
  /** The object's entity tag, when the service returns one. */
  readonly etag?: string;
}

/**
 * Object attributes as surfaced by Supabase Storage (`info(path)` / `list`
 * entries). Every field is optional and loosely typed because Supabase returns
 * timestamps as ISO-8601 strings and nests size/mimetype/user metadata under a
 * `metadata` map; the driver normalizes them. Caller-supplied user metadata lives
 * under the nested {@link userMetadata} map (Supabase's custom "metadata").
 */
export interface SupabaseObjectInfo {
  /** Byte length. Supabase may return this as a number or numeric string. */
  readonly size?: number | string;
  /** Declared content type / mimetype. */
  readonly contentType?: string;
  /** Entity tag, when present. */
  readonly etag?: string;
  /** Creation time as an ISO-8601 string. */
  readonly createdAt?: string;
  /** Last-updated time as an ISO-8601 string. */
  readonly updatedAt?: string;
  /** Caller-supplied custom metadata (string→string). */
  readonly userMetadata?: Record<string, string>;
}

/** A single object entry returned by {@link SupabaseStorageClientLike.list}. */
export interface SupabaseListEntry {
  /** The object path (full key). */
  readonly name: string;
  /** Byte length of the object, when the listing includes it. */
  readonly size?: number | string;
  /** Last-updated time as an ISO-8601 string, when the listing includes it. */
  readonly updatedAt?: string;
}

/** Options accepted by {@link SupabaseStorageClientLike.list}. */
export interface SupabaseListInput {
  /** Only list objects whose path begins with this prefix. */
  readonly prefix: string;
  /** Best-effort maximum number of results the caller wants. */
  readonly limit?: number;
}

/**
 * The **minimal, bucket-scoped structural interface** this driver depends on.
 *
 * It describes just the Supabase Storage operations the driver needs — never any
 * concrete `@supabase/supabase-js` type — so the SDK stays an optional peer
 * concern of the consumer (Requirement 3.1). `download`/`info` return `null` for
 * a missing object so not-found maps to the contract's consistent semantics
 * rather than a thrown error.
 */
export interface SupabaseStorageClientLike {
  /** Store `body` under `path` with optional content type and custom metadata. */
  upload(input: SupabaseUploadInput): Promise<SupabaseUploadResult>;
  /** Download the object's bytes, or `null` when it does not exist. */
  download(path: string): Promise<Uint8Array | null>;
  /** Remove the object at `path` (a no-op when it is already absent). */
  remove(path: string): Promise<void>;
  /** Report whether an object exists at `path`. */
  exists(path: string): Promise<boolean>;
  /** Fetch the object's attributes, or `null` when it does not exist. */
  info(path: string): Promise<SupabaseObjectInfo | null>;
  /** List objects whose path begins with `input.prefix`. */
  list(input: SupabaseListInput): Promise<readonly SupabaseListEntry[]>;
}

// ── Reserved user-metadata keys ────────────────────────────────────────────────

/**
 * Reserved custom-metadata keys used to round-trip the typed metadata field set
 * through Supabase's string→string custom-metadata map. Prefixed so they never
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
 * Options for the Supabase driver. The provider name is fixed to `"supabase"`
 * and is not caller-configurable, so provider identity stays stable.
 */
export interface SupabaseStorageDriverOptions {
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
}

// ── The Supabase driver ─────────────────────────────────────────────────────────

/**
 * Maps the {@link StorageDriver} contract onto an injected
 * {@link SupabaseStorageClientLike}.
 *
 * Object identity fields (`etag`/`checksum`/`size`) and timestamps are computed
 * locally at write time — the checksum/etag are the sha-256 hex digest of the
 * stored bytes, the size is the byte length, and timestamps come from the
 * injected {@link Clock} — then encoded into the object's custom metadata so they
 * round-trip on read. Advanced capabilities are left `undefined` for facade
 * simulation.
 */
export class SupabaseStorageDriver implements StorageDriver {
  /** Stable driver name. */
  readonly name = SUPABASE_DRIVER_NAME;

  private readonly client: SupabaseStorageClientLike;
  private readonly clock: Clock;

  constructor(client: SupabaseStorageClientLike, options: SupabaseStorageDriverOptions = {}) {
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

    await this.client.upload({
      path: key,
      body: stored,
      contentType: objectMetadata.contentType,
      metadata: encodeUserMetadata(objectMetadata),
      upsert: true,
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
    const info = await this.client.info(key);
    const metadata = this.decodeMeta(key, bytes.byteLength, info);
    return { found: true, bytes: bytes.slice(), metadata };
  }

  /** Report whether an object is stored under `key` (Requirement 4.3). */
  async exists(key: string): Promise<boolean> {
    return this.client.exists(key);
  }

  /** Delete the object at `key`; deleting a missing key is a no-op (Requirement 4.4). */
  async delete(key: string): Promise<void> {
    await this.client.remove(key);
  }

  /**
   * Return the metadata for `key` without its content, or `null` when absent
   * (Requirement 4.10).
   */
  async stat(key: string): Promise<StorageObjectMetadata | null> {
    const info = await this.client.info(key);
    if (info === null) {
      return null;
    }
    const size = parseSize(info.size);
    return this.decodeMeta(key, size, info);
  }

  /**
   * List objects whose key begins with `prefix`, sorted by key for deterministic
   * ordering (Requirement 4.9). Honors optional `cursor` (exclusive resume
   * point) and `limit`.
   */
  async list(prefix: string, options?: ListOptions): Promise<StorageListItem[]> {
    const entries = await this.client.list({ prefix, limit: options?.limit });

    let items: StorageListItem[] = entries
      .filter((entry) => typeof entry.name === "string")
      .map((entry) => ({
        key: entry.name,
        size: parseSize(entry.size),
        updatedAt: parseIso(entry.updatedAt) ?? 0,
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
   * this driver): `etag`/`createdAt`/`updatedAt` back-fill the identity/timestamp
   * fields, keeping the shape consistent across providers.
   */
  private decodeMeta(
    key: string,
    size: number,
    info: SupabaseObjectInfo | null,
  ): StorageObjectMetadata {
    const attrs = info ?? {};
    const um = attrs.userMetadata ?? {};
    const now = this.clock();

    const checksum = um[MK.checksum] ?? attrs.etag ?? "";
    const createdAt = parseEpoch(um[MK.createdAt]) ?? parseIso(attrs.createdAt) ?? now;
    const updatedAt =
      parseEpoch(um[MK.updatedAt]) ?? parseIso(attrs.updatedAt) ?? createdAt;

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
 * Wrap an injected {@link SupabaseStorageClientLike} as a Supabase driver.
 * Synchronous and SDK-free: the caller supplies the client, so no provider SDK
 * is resolved here.
 *
 * @throws {StorageConfigError} when no client is injected — use
 *   {@link connectSupabaseStorageDriver} to build a client from connection
 *   options instead.
 */
export function createSupabaseStorageDriver(
  client: SupabaseStorageClientLike,
  options: SupabaseStorageDriverOptions = {},
): StorageDriver {
  if (client === undefined || client === null) {
    throw new StorageConfigError(
      "createSupabaseStorageDriver requires an injected SupabaseStorageClientLike. " +
        "Pass a structural client, or use connectSupabaseStorageDriver(config) " +
        "to build one from a bucket using the optional '@supabase/supabase-js' peer dependency.",
      { provider: SUPABASE_DRIVER_NAME },
    );
  }
  return new SupabaseStorageDriver(client, options);
}

/**
 * Connection configuration for {@link connectSupabaseStorageDriver}. `url` and
 * `key` are forwarded to `createClient`; `bucket` scopes the resulting storage
 * client.
 */
export interface SupabaseStorageConfig extends SupabaseStorageDriverOptions {
  /** The Supabase project URL (required). */
  readonly url: string;
  /** The Supabase API key — service-role or anon (required). */
  readonly key: string;
  /** The Supabase Storage bucket the driver operates within (required). */
  readonly bucket: string;
}

/**
 * Build a Supabase driver that owns its client, resolving `@supabase/supabase-js`
 * lazily.
 *
 * The SDK is loaded through a dynamic `import()` with a non-literal specifier so
 * it is never a static/top-level dependency: `tsc` does not require it to be
 * installed, and it is only resolved when this function runs. When the SDK
 * cannot be resolved, a {@link StorageConfigError} is thrown (Requirement 1.5) —
 * callers that cannot install the SDK should use
 * {@link createSupabaseStorageDriver} with their own
 * {@link SupabaseStorageClientLike} instead.
 */
export async function connectSupabaseStorageDriver(
  config: SupabaseStorageConfig,
): Promise<StorageDriver> {
  if (!config.url || !config.key || !config.bucket) {
    throw new StorageConfigError(
      "Supabase driver requires url, key, and bucket.",
      { provider: SUPABASE_DRIVER_NAME },
    );
  }

  // Lazy, non-literal dynamic import so the Supabase SDK stays an optional peer
  // that `tsc` never resolves statically and Node only loads on this path.
  const specifier = "@supabase/supabase-js";
  let sdk: SupabaseSdkModule;
  try {
    sdk = (await import(specifier)) as unknown as SupabaseSdkModule;
  } catch (cause) {
    throw new StorageConfigError(
      'Supabase driver requires the optional peer dependency "@supabase/supabase-js". ' +
        "Install it, or inject your own SupabaseStorageClientLike via createSupabaseStorageDriver().",
      { provider: SUPABASE_DRIVER_NAME, cause },
    );
  }

  let bucketApi: SupabaseSdkBucketApi;
  try {
    const supabase = sdk.createClient(config.url, config.key);
    bucketApi = supabase.storage.from(config.bucket);
  } catch (cause) {
    throw new StorageConfigError(
      `Failed to construct a Supabase Storage client for bucket "${config.bucket}".`,
      { provider: SUPABASE_DRIVER_NAME, cause },
    );
  }

  const client = adaptSupabaseBucketApi(bucketApi);
  return createSupabaseStorageDriver(client, { clock: config.clock });
}

// ── SDK → SupabaseStorageClientLike adapter ────────────────────────────────────

/**
 * Adapt a `@supabase/supabase-js` storage bucket API into the structural
 * {@link SupabaseStorageClientLike} this driver consumes. Only the methods the
 * driver uses are mapped; the SDK's `{ data, error }` envelopes are narrowed
 * through the local structural types below so this module never imports concrete
 * SDK types. A missing object is mapped to `null` so not-found semantics stay
 * consistent.
 */
function adaptSupabaseBucketApi(api: SupabaseSdkBucketApi): SupabaseStorageClientLike {
  return {
    async upload(input: SupabaseUploadInput): Promise<SupabaseUploadResult> {
      const { error } = await api.upload(input.path, Buffer.from(input.body), {
        contentType: input.contentType,
        upsert: input.upsert ?? true,
        metadata: input.metadata,
      });
      if (error) {
        throw asError(error);
      }
      return {};
    },

    async download(path: string): Promise<Uint8Array | null> {
      const { data, error } = await api.download(path);
      if (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw asError(error);
      }
      if (data === null || data === undefined) {
        return null;
      }
      const buffer = await data.arrayBuffer();
      return new Uint8Array(buffer);
    },

    async remove(path: string): Promise<void> {
      const { error } = await api.remove([path]);
      if (error && !isNotFound(error)) {
        throw asError(error);
      }
    },

    async exists(path: string): Promise<boolean> {
      const { data, error } = await api.download(path);
      if (error) {
        if (isNotFound(error)) {
          return false;
        }
        throw asError(error);
      }
      return data !== null && data !== undefined;
    },

    async info(path: string): Promise<SupabaseObjectInfo | null> {
      const { data, error } = await api.info(path);
      if (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw asError(error);
      }
      if (data === null || data === undefined) {
        return null;
      }
      const meta = data.metadata ?? {};
      return {
        size: data.size ?? meta.size,
        contentType: data.contentType ?? meta.mimetype,
        etag: data.etag ?? meta.eTag,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
        userMetadata: data.userMetadata,
      };
    },

    async list(input: SupabaseListInput): Promise<readonly SupabaseListEntry[]> {
      const { data, error } = await api.list(input.prefix, { limit: input.limit });
      if (error) {
        throw asError(error);
      }
      const rows = data ?? [];
      return rows.map((row) => {
        const meta = row.metadata ?? {};
        return {
          name: row.name,
          size: meta.size,
          updatedAt: row.updated_at,
        };
      });
    },
  };
}

/**
 * Recognize the Supabase "object does not exist" condition so
 * `download`/`info`/`remove` can map to `null`/no-op rather than throwing.
 * Supabase surfaces a `statusCode`/`status` of `404` or a `"not_found"` code.
 */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const candidate = error as {
    statusCode?: unknown;
    status?: unknown;
    error?: unknown;
    message?: unknown;
  };
  const statusCode = candidate.statusCode;
  const status = candidate.status;
  return (
    statusCode === 404 ||
    statusCode === "404" ||
    status === 404 ||
    candidate.error === "not_found" ||
    (typeof candidate.message === "string" && /not[_ ]?found/i.test(candidate.message))
  );
}

/** Coerce a Supabase `{ data, error }` error payload into an `Error`. */
function asError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }
  if (error !== null && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") {
      return new Error(message);
    }
  }
  return new Error(String(error));
}

// ── Module-private encoding helpers ────────────────────────────────────────────

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Encode a built object's typed metadata into the Supabase custom-metadata map. */
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

/** Parse a Supabase `size` (number or numeric string), defaulting to `0`. */
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

/** Parse an ISO-8601 timestamp to epoch ms, or `undefined`. */
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

// ── Structural SDK types (never import concrete @supabase/supabase-js types) ─────
//
// These describe only the slice of the `@supabase/supabase-js` SDK this adapter
// touches, so the module compiles with no SDK installed and stays decoupled from
// SDK versions.

/** A `{ data, error }` envelope as returned by the Supabase Storage SDK. */
interface SupabaseResponse<T> {
  readonly data: T | null;
  readonly error: unknown;
}

/** Nested metadata Supabase attaches to storage objects. */
interface SupabaseSdkObjectMetadata {
  readonly size?: number;
  readonly mimetype?: string;
  readonly eTag?: string;
}

/** A storage object as surfaced by `info()`. */
interface SupabaseSdkObjectInfo {
  readonly size?: number;
  readonly contentType?: string;
  readonly etag?: string;
  readonly created_at?: string;
  readonly updated_at?: string;
  readonly metadata?: SupabaseSdkObjectMetadata;
  readonly userMetadata?: Record<string, string>;
}

/** A storage object entry as surfaced by `list()`. */
interface SupabaseSdkListEntry {
  readonly name: string;
  readonly updated_at?: string;
  readonly metadata?: SupabaseSdkObjectMetadata;
}

/** A downloadable blob-like body (`Blob`) returned by `download()`. */
interface SupabaseSdkBlob {
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The `@supabase/supabase-js` storage bucket API surface this adapter drives. */
interface SupabaseSdkBucketApi {
  upload(
    path: string,
    body: Buffer,
    options?: Record<string, unknown>,
  ): Promise<SupabaseResponse<unknown>>;
  download(path: string): Promise<SupabaseResponse<SupabaseSdkBlob>>;
  remove(paths: readonly string[]): Promise<SupabaseResponse<unknown>>;
  info(path: string): Promise<SupabaseResponse<SupabaseSdkObjectInfo>>;
  list(
    prefix: string,
    options?: Record<string, unknown>,
  ): Promise<SupabaseResponse<readonly SupabaseSdkListEntry[]>>;
}

/** The `@supabase/supabase-js` storage namespace surface this adapter drives. */
interface SupabaseSdkStorage {
  from(bucket: string): SupabaseSdkBucketApi;
}

/** The `@supabase/supabase-js` client surface this adapter drives. */
interface SupabaseSdkClient {
  readonly storage: SupabaseSdkStorage;
}

/** Structural view of the `@supabase/supabase-js` module members this adapter uses. */
interface SupabaseSdkModule {
  createClient(url: string, key: string): SupabaseSdkClient;
}
