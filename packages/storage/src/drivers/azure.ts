/**
 * @streetjs/storage — Azure Blob Storage driver submodule (`@streetjs/storage/azure`).
 *
 * Azure Blob Storage does **not** speak the S3 wire shape, so — unlike
 * `s3.ts`/`r2.ts`/`minio.ts`/`backblaze.ts`, which specialize the shared
 * {@link createS3StyleDriver} base — this driver maps the {@link StorageDriver}
 * contract **directly** onto a structural Azure Blob client
 * ({@link AzureBlobClientLike}). It computes object identity fields
 * (`size`/`checksum`/`etag`) and timestamps locally and assembles every
 * {@link StorageObjectMetadata} through the shared metadata layer
 * ({@link buildObjectMetadata}) so the field set is identical to Memory/Local
 * and every other provider (Requirement 2.1, 10.1).
 *
 * ## SDK isolation (Requirements 3.1, 3.3)
 *
 * This module imports **no provider SDK** at the top level — only Node built-ins,
 * `streetjs` (for the injected {@link Clock}), and this package's own type
 * surface. There are two ways to obtain a driver:
 *
 * 1. **Inject a structural client.** {@link createAzureBlobDriver} accepts an
 *    already-built {@link AzureBlobClientLike} (real SDK adapter or a test
 *    double) and maps the contract onto it. The `@azure/storage-blob` SDK stays
 *    an optional peer concern of the consumer and is never touched by this
 *    package.
 *
 * 2. **Let the driver build its own client.** {@link connectAzureBlobDriver}
 *    resolves the optional `@azure/storage-blob` peer SDK with a **lazy dynamic
 *    `import()`** performed *inside the function* (never at module top level),
 *    constructs a container-scoped client, adapts it to
 *    {@link AzureBlobClientLike}, and hands it to {@link createAzureBlobDriver}.
 *    If the SDK is absent, it throws {@link StorageConfigError} rather than a raw
 *    module-resolution error.
 *
 * Because the driver lives behind the `./azure` subpath export
 * (`dist/drivers/azure.js`) and is *not* re-exported from the package index, a
 * consumer only loads this code — and any SDK it lazily resolves — when they
 * import `@streetjs/storage/azure`. `package.json` lists `@azure/storage-blob`
 * as an optional peer dependency, never a runtime dependency, keeping `streetjs`
 * the only runtime dependency.
 *
 * ## Capability delegation (Requirement 2.3)
 *
 * Only the **mandatory primitives** (`put`/`get`/`exists`/`delete`/`stat`/
 * `list`/`putStream`/`getStream`) are implemented. The advanced capabilities
 * (`multipart`/`resumable`/`versioning`/`signedUrl`/`lifecycle`) are left
 * `undefined` so the facade's cross-cutting layer supplies a provider-agnostic
 * simulation over the primitives, keeping observable behavior identical across
 * providers.
 *
 * _Requirements: 2.1, 2.3, 3.3_
 */

import { createHash } from "node:crypto";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { systemClock, type Clock } from "streetjs";

import type { MaybeObject, NodeReadable, StorageDriver } from "../driver.js";
import { StorageConfigError, NotFoundError } from "../errors.js";
import { buildObjectMetadata } from "../metadata.js";
import type {
  AccessLevel,
  ListOptions,
  StorageListItem,
  StorageObjectMetadata,
  WriteMetadata,
} from "../types.js";

/** The stable {@link StorageDriver.name} surfaced by every Azure Blob driver. */
const AZURE_DRIVER_NAME = "azure";

// ── The structural Azure Blob client ──────────────────────────────────────────

/** Input to {@link AzureBlobClientLike.upload}. */
export interface AzureUploadInput {
  /** The blob name (object key) within the container. */
  readonly blobName: string;
  /** The bytes to store. */
  readonly body: Uint8Array;
  /** Blob content type, mapped to `blobHTTPHeaders.blobContentType`. */
  readonly contentType?: string;
  /** Blob metadata (string→string); used to round-trip the typed field set. */
  readonly metadata?: Record<string, string>;
}

/** Result of {@link AzureBlobClientLike.upload}. */
export interface AzureUploadResult {
  /** The blob's entity tag, when the service returns one. */
  readonly etag?: string;
}

/** Blob attributes shared by download and property reads. */
export interface AzureBlobProperties {
  /** Blob content type (`blobContentType`). */
  readonly contentType?: string;
  /** The blob's entity tag. */
  readonly etag?: string;
  /** Byte length of the blob content (`contentLength`). */
  readonly contentLength?: number;
  /** Last-modified time as epoch ms. */
  readonly lastModified?: number;
  /** Blob metadata (string→string). */
  readonly metadata?: Record<string, string>;
}

/** Result of {@link AzureBlobClientLike.download} — attributes plus the body. */
export interface AzureBlobDownloadResult extends AzureBlobProperties {
  /** The blob's content bytes. */
  readonly body: Uint8Array;
}

/** A single entry returned by {@link AzureBlobClientLike.listBlobs}. */
export interface AzureBlobListItem {
  /** The blob name (object key). */
  readonly name: string;
  /** Byte length of the blob content. */
  readonly contentLength: number;
  /** Last-modified time as epoch ms. */
  readonly lastModified: number;
}

/** Options passed to {@link AzureBlobClientLike.listBlobs}. */
export interface AzureListInput {
  /** Only blobs whose name begins with this prefix are returned. */
  readonly prefix: string;
  /** Maximum number of blobs to return. */
  readonly limit?: number;
}

/**
 * The **minimal, container-scoped structural interface** the Azure Blob driver
 * depends on.
 *
 * It describes just the blob operations the driver needs — never any concrete
 * `@azure/storage-blob` type — so the actual SDK stays an optional peer concern
 * of the consumer (Requirement 3.1). Every call is scoped to a single container
 * (the adapter built by {@link connectAzureBlobDriver} closes over the container
 * name), so the driver only ever passes blob names.
 */
export interface AzureBlobClientLike {
  /** Upload `body` to `blobName` with optional content type and metadata. */
  upload(input: AzureUploadInput): Promise<AzureUploadResult>;
  /** Download the blob at `blobName`, or `null` when it does not exist. */
  download(input: { readonly blobName: string }): Promise<AzureBlobDownloadResult | null>;
  /** Read blob attributes without the body, or `null` when absent. */
  getProperties(input: { readonly blobName: string }): Promise<AzureBlobProperties | null>;
  /** Delete the blob at `blobName` (a no-op when it is already absent). */
  deleteBlob(input: { readonly blobName: string }): Promise<void>;
  /** Report whether a blob exists at `blobName`. */
  exists(input: { readonly blobName: string }): Promise<boolean>;
  /** List blobs whose name begins with `prefix`. */
  listBlobs(input: AzureListInput): Promise<readonly AzureBlobListItem[]>;
}

// ── Metadata encoding keys ────────────────────────────────────────────────────

/**
 * Reserved blob-metadata keys used to round-trip the typed metadata field set
 * through Azure's string→string blob metadata map. Azure blob metadata names
 * must be valid C# identifiers (letters/digits/underscore, no hyphens), so these
 * keys are underscore-delimited rather than the `x-...-` style used by the
 * S3-style base. The `street_` prefix keeps them from colliding with a caller's
 * own custom fields.
 */
const MK = {
  checksum: "street_checksum",
  createdAt: "street_created_at",
  updatedAt: "street_updated_at",
  owner: "street_owner",
  tenant: "street_tenant",
  accessLevel: "street_access_level",
  custom: "street_custom",
} as const;

// ── Driver options ────────────────────────────────────────────────────────────

/** Options for {@link createAzureBlobDriver} / {@link AzureBlobDriver}. */
export interface AzureBlobDriverOptions {
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
}

// ── The Azure Blob driver ──────────────────────────────────────────────────────

/**
 * Maps the {@link StorageDriver} contract directly onto an injected
 * {@link AzureBlobClientLike}.
 *
 * Unlike the S3-compatible providers, Azure Blob does not share the S3 wire
 * shape, so this driver does not build on {@link createS3StyleDriver}. It
 * computes size/checksum/etag and timestamps locally, encodes the typed metadata
 * into the blob metadata map so it round-trips on read, and reports a missing
 * key consistently ({@link MaybeObject} `{ found: false }` for `get`, `null` for
 * `stat`, {@link NotFoundError} for `getStream`).
 */
export class AzureBlobDriver implements StorageDriver {
  /** Stable driver name. */
  readonly name = AZURE_DRIVER_NAME;

  private readonly client: AzureBlobClientLike;
  private readonly clock: Clock;

  constructor(client: AzureBlobClientLike, options: AzureBlobDriverOptions = {}) {
    this.client = client;
    this.clock = options.clock ?? systemClock;
  }

  // ── Mandatory primitives ──────────────────────────────────────────────────

  /**
   * Store `bytes` under `key`, computing size and sha-256 checksum locally and
   * taking timestamps from the injected clock. When overwriting, the original
   * `createdAt` is preserved (a preceding attribute read). The typed metadata is
   * encoded into the blob metadata map so it round-trips on read
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
      blobName: key,
      body: stored,
      contentType: objectMetadata.contentType,
      metadata: encodeMetadata(objectMetadata),
    });

    return objectMetadata;
  }

  /**
   * Read the object at `key`, returning a discriminated {@link MaybeObject} so
   * absence is reported rather than thrown (Requirements 4.2, 2.4). Metadata is
   * rebuilt from the blob attributes and encoded metadata via the shared layer.
   */
  async get(key: string): Promise<MaybeObject> {
    const out = await this.client.download({ blobName: key });
    if (out === null) {
      return { found: false };
    }
    const bytes = out.body.slice();
    const metadata = this.decodeMeta(key, {
      contentType: out.contentType,
      etag: out.etag,
      contentLength: bytes.byteLength,
      lastModified: out.lastModified,
      metadata: out.metadata,
    });
    return { found: true, bytes, metadata };
  }

  /** Report whether an object is stored under `key` (Requirement 4.3). */
  async exists(key: string): Promise<boolean> {
    return this.client.exists({ blobName: key });
  }

  /** Delete the object at `key`; deleting a missing key is a no-op (Requirement 4.4). */
  async delete(key: string): Promise<void> {
    await this.client.deleteBlob({ blobName: key });
  }

  /**
   * Return the metadata for `key` without its content, or `null` when absent
   * (Requirement 4.10).
   */
  async stat(key: string): Promise<StorageObjectMetadata | null> {
    const props = await this.client.getProperties({ blobName: key });
    if (props === null) {
      return null;
    }
    return this.decodeMeta(key, props);
  }

  /** List objects whose key begins with `prefix` (Requirement 4.9). */
  async list(prefix: string, options?: ListOptions): Promise<StorageListItem[]> {
    const items = await this.client.listBlobs({ prefix, limit: options?.limit });
    const sorted = [...items].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const limited =
      typeof options?.limit === "number" ? sorted.slice(0, options.limit) : sorted;
    return limited.map((item) => ({
      key: item.name,
      size: item.contentLength,
      updatedAt: item.lastModified,
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
    const out = await this.client.download({ blobName: key });
    if (out === null) {
      throw new NotFoundError(key);
    }
    return Readable.from([Buffer.from(out.body)]);
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Rebuild the typed {@link StorageObjectMetadata} field set from blob
   * attributes and the encoded metadata map, applying the shared layer's
   * canonical defaults. Provider-supplied values back-fill identity/timestamp
   * fields when the encoded ones are absent (e.g. a blob written outside this
   * driver), keeping the shape consistent across providers.
   */
  private decodeMeta(key: string, props: AzureBlobProperties): StorageObjectMetadata {
    const bm = props.metadata ?? {};
    const now = this.clock();
    const checksum = bm[MK.checksum] ?? props.etag ?? "";
    const createdAt = parseEpoch(bm[MK.createdAt]) ?? props.lastModified ?? now;
    const updatedAt = parseEpoch(bm[MK.updatedAt]) ?? props.lastModified ?? createdAt;

    const write: WriteMetadata = {
      contentType: props.contentType,
      owner: bm[MK.owner],
      tenant: bm[MK.tenant],
      accessLevel: decodeAccessLevel(bm[MK.accessLevel]),
      custom: parseCustom(bm[MK.custom]),
    };

    return buildObjectMetadata({
      key,
      size: props.contentLength ?? 0,
      checksum,
      etag: props.etag ?? checksum,
      createdAt,
      updatedAt,
      write,
    });
  }
}

/**
 * Create an Azure-Blob-backed {@link StorageDriver} over an **injected**
 * structural {@link AzureBlobClientLike}.
 *
 * This is the primary, SDK-free entry point: the caller supplies a client that
 * already speaks the {@link AzureBlobClientLike} shape (built from
 * `@azure/storage-blob`, or a test double), and this function maps the contract
 * onto it. No provider SDK is imported.
 *
 * @throws {StorageConfigError} when no client is injected — use
 *   {@link connectAzureBlobDriver} to build a client from connection options.
 */
export function createAzureBlobDriver(
  client: AzureBlobClientLike,
  options: AzureBlobDriverOptions = {},
): StorageDriver {
  if (client === undefined || client === null) {
    throw new StorageConfigError(
      "createAzureBlobDriver requires an injected Azure Blob client. " +
        "Pass an AzureBlobClientLike, or use connectAzureBlobDriver(options) to " +
        "build one from a connection string using the optional " +
        "'@azure/storage-blob' peer dependency.",
      { provider: AZURE_DRIVER_NAME },
    );
  }
  return new AzureBlobDriver(client, options);
}

// ── Connection / SDK-building path ─────────────────────────────────────────────

/** Connection options for building an Azure Blob client via {@link connectAzureBlobDriver}. */
export interface AzureBlobConnectionOptions {
  /** The blob container the driver operates within (required). */
  readonly container: string;
  /** An Azure Storage connection string (e.g. from the portal). */
  readonly connectionString: string;
}

/**
 * Build an Azure-Blob-backed {@link StorageDriver}, constructing the underlying
 * client from `connection` options using the optional `@azure/storage-blob` peer
 * SDK.
 *
 * The SDK is resolved with a **lazy dynamic `import()`** performed inside this
 * function, so the peer dependency is only touched when a caller actually asks
 * the driver to build its own client. The resolved SDK client is adapted to the
 * structural {@link AzureBlobClientLike} and handed to {@link createAzureBlobDriver}.
 *
 * @throws {StorageConfigError} when the `@azure/storage-blob` SDK is not
 *   installed, or when the client cannot be constructed from the supplied options.
 */
export async function connectAzureBlobDriver(
  connection: AzureBlobConnectionOptions,
  options: AzureBlobDriverOptions = {},
): Promise<StorageDriver> {
  const sdk = await loadAzureSdk();
  let containerClient: AzureContainerClientLike;
  try {
    const service = sdk.BlobServiceClient.fromConnectionString(connection.connectionString);
    containerClient = service.getContainerClient(connection.container);
  } catch (cause) {
    throw new StorageConfigError(
      `Failed to construct an Azure Blob client for container "${connection.container}".`,
      { provider: AZURE_DRIVER_NAME, cause },
    );
  }
  const client = adaptAzureContainerClient(containerClient);
  return createAzureBlobDriver(client, options);
}

/**
 * Lazily resolve the optional `@azure/storage-blob` peer SDK. The module
 * specifier is held in a variable so the compiler does not statically resolve
 * (and therefore require) the optional peer at build time; the resolution
 * happens only at call time.
 *
 * @throws {StorageConfigError} when the SDK is not installed.
 */
async function loadAzureSdk(): Promise<AzureStorageBlobModule> {
  const specifier = "@azure/storage-blob";
  try {
    return (await import(specifier)) as unknown as AzureStorageBlobModule;
  } catch (cause) {
    throw new StorageConfigError(
      "The optional '@azure/storage-blob' peer dependency is not installed. " +
        "Install it (`npm install @azure/storage-blob`) to build an Azure Blob " +
        "client from a connection string, or inject your own AzureBlobClientLike " +
        "via createAzureBlobDriver(client).",
      { provider: AZURE_DRIVER_NAME, cause },
    );
  }
}

// ── Structural SDK surface (no dependency on the real @azure/storage-blob types) ─

/** The subset of Azure `BlockBlobClient` this adapter drives. */
interface AzureBlockBlobClientLike {
  upload(
    body: Buffer,
    contentLength: number,
    options?: {
      readonly blobHTTPHeaders?: { readonly blobContentType?: string };
      readonly metadata?: Record<string, string>;
    },
  ): Promise<{ readonly etag?: string }>;
  download(): Promise<{
    readonly readableStreamBody?: NodeJS.ReadableStream;
    readonly contentLength?: number;
    readonly contentType?: string;
    readonly etag?: string;
    readonly lastModified?: Date;
    readonly metadata?: Record<string, string>;
  }>;
  getProperties(): Promise<{
    readonly contentLength?: number;
    readonly contentType?: string;
    readonly etag?: string;
    readonly lastModified?: Date;
    readonly metadata?: Record<string, string>;
  }>;
  deleteIfExists(): Promise<unknown>;
  exists(): Promise<boolean>;
}

/** A single entry yielded by the Azure `listBlobsFlat` async iterator. */
interface AzureListBlobItem {
  readonly name: string;
  readonly properties?: {
    readonly contentLength?: number;
    readonly lastModified?: Date;
  };
}

/** The subset of Azure `ContainerClient` this adapter drives. */
interface AzureContainerClientLike {
  getBlockBlobClient(blobName: string): AzureBlockBlobClientLike;
  listBlobsFlat(options?: { readonly prefix?: string }): AsyncIterable<AzureListBlobItem>;
}

/** The subset of Azure `BlobServiceClient` this adapter drives. */
interface AzureBlobServiceClientLike {
  getContainerClient(container: string): AzureContainerClientLike;
}

/** The shape of the lazily-imported `@azure/storage-blob` module. */
interface AzureStorageBlobModule {
  readonly BlobServiceClient: {
    fromConnectionString(connectionString: string): AzureBlobServiceClientLike;
  };
}

// ── SDK → AzureBlobClientLike adapter ──────────────────────────────────────────

/**
 * Adapt an Azure `ContainerClient` into the structural {@link AzureBlobClientLike}
 * the driver consumes, scoping every call to that container. Not-found responses
 * (a 404 `RestError`/`BlobNotFound`) are mapped to `null`/no-op so absence is
 * reported consistently rather than thrown.
 */
function adaptAzureContainerClient(container: AzureContainerClientLike): AzureBlobClientLike {
  return {
    async upload(input: AzureUploadInput): Promise<AzureUploadResult> {
      const blob = container.getBlockBlobClient(input.blobName);
      const body = Buffer.from(input.body);
      const result = await blob.upload(body, body.byteLength, {
        blobHTTPHeaders:
          input.contentType !== undefined
            ? { blobContentType: input.contentType }
            : undefined,
        metadata: input.metadata,
      });
      return { etag: result.etag };
    },

    async download(input: { readonly blobName: string }): Promise<AzureBlobDownloadResult | null> {
      const blob = container.getBlockBlobClient(input.blobName);
      let response: Awaited<ReturnType<AzureBlockBlobClientLike["download"]>>;
      try {
        response = await blob.download();
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      const body = response.readableStreamBody
        ? await collectStream(response.readableStreamBody)
        : new Uint8Array(0);
      return {
        body,
        contentType: response.contentType,
        etag: response.etag,
        contentLength: response.contentLength ?? body.byteLength,
        lastModified: response.lastModified?.getTime(),
        metadata: response.metadata,
      };
    },

    async getProperties(input: { readonly blobName: string }): Promise<AzureBlobProperties | null> {
      const blob = container.getBlockBlobClient(input.blobName);
      try {
        const props = await blob.getProperties();
        return {
          contentType: props.contentType,
          etag: props.etag,
          contentLength: props.contentLength,
          lastModified: props.lastModified?.getTime(),
          metadata: props.metadata,
        };
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async deleteBlob(input: { readonly blobName: string }): Promise<void> {
      const blob = container.getBlockBlobClient(input.blobName);
      await blob.deleteIfExists();
    },

    async exists(input: { readonly blobName: string }): Promise<boolean> {
      const blob = container.getBlockBlobClient(input.blobName);
      return blob.exists();
    },

    async listBlobs(input: AzureListInput): Promise<readonly AzureBlobListItem[]> {
      const items: AzureBlobListItem[] = [];
      for await (const blob of container.listBlobsFlat({ prefix: input.prefix })) {
        items.push({
          name: blob.name,
          contentLength: blob.properties?.contentLength ?? 0,
          lastModified: blob.properties?.lastModified?.getTime() ?? 0,
        });
        if (typeof input.limit === "number" && items.length >= input.limit) {
          break;
        }
      }
      return items;
    },
  };
}

// ── Metadata encode/decode helpers ──────────────────────────────────────────────

/** Encode a built object's typed metadata into the Azure blob metadata map. */
function encodeMetadata(metadata: StorageObjectMetadata): Record<string, string> {
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

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Collect a Node readable stream into a single {@link Uint8Array}. */
async function collectStream(stream: NodeJS.ReadableStream): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Detect an Azure "blob does not exist" error so absence maps to `null`/no-op
 * rather than a thrown error, keeping not-found semantics identical across
 * providers.
 */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return code === "BlobNotFound" || code === "ContainerNotFound" || statusCode === 404;
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
