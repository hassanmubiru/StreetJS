/**
 * @streetjs/storage — MinIO driver submodule (`@streetjs/storage/minio`).
 *
 * MinIO speaks the S3 API against a **self-hosted endpoint**, so this driver is a
 * thin endpoint specialization of the shared S3-style base
 * ({@link createS3StyleDriver}). It contributes nothing to the contract mapping —
 * that lives entirely in `s3-base.ts` — and only differs in how the underlying
 * {@link S3ClientLike} is obtained and in the stable driver name (`"minio"`).
 *
 * ## SDK isolation (Requirements 3.1, 3.3)
 *
 * This module imports **no provider SDK** at the top level. There are two ways to
 * obtain a driver:
 *
 * 1. **Inject a structural client.** {@link createMinIODriver} accepts an
 *    already-built {@link S3ClientLike} and delegates straight to the base with
 *    `name: "minio"`. The `minio` SDK stays an optional peer concern of the
 *    consumer and is never touched by this package.
 *
 * 2. **Let the driver build its own client.** {@link connectMinIODriver} resolves
 *    the optional `minio` peer SDK with a **lazy dynamic `import()`** performed
 *    *inside the function* (never at module top level), constructs a MinIO client
 *    from the supplied endpoint/credentials, adapts it to {@link S3ClientLike},
 *    and hands it to the base. If the SDK is absent, it throws
 *    {@link StorageConfigError} rather than a raw module-resolution error.
 *
 * Because the driver lives behind the `./minio` subpath export
 * (`dist/drivers/minio.js`) and is *not* re-exported from the package index, a
 * consumer only loads this code — and any SDK it lazily resolves — when they
 * import `@streetjs/storage/minio`. `package.json` lists `minio` as an optional
 * peer dependency, never a runtime dependency, keeping `streetjs` the only
 * runtime dependency.
 *
 * _Requirements: 2.1, 2.3, 3.3_
 */

import { Readable } from "node:stream";

import type { StorageDriver } from "../driver.js";
import { StorageConfigError } from "../errors.js";
import {
  createS3StyleDriver,
  type S3ClientLike,
  type S3GetObjectOutput,
  type S3HeadObjectOutput,
  type S3ListInput,
  type S3ListItem,
  type S3PutObjectInput,
  type S3PutObjectOutput,
  type S3StyleDriverOptions,
} from "./s3-base.js";

/** The stable {@link StorageDriver.name} surfaced by every MinIO driver. */
const MINIO_DRIVER_NAME = "minio";

/**
 * Options for {@link createMinIODriver}. Extends the shared
 * {@link S3StyleDriverOptions} (clock, native capabilities) but pins the driver
 * name to `"minio"` — the name is not caller-configurable for this
 * specialization.
 */
export type MinIODriverOptions = Omit<S3StyleDriverOptions, "name">;

/**
 * Create a MinIO-backed {@link StorageDriver} over an **injected** structural
 * {@link S3ClientLike}.
 *
 * This is the primary, SDK-free entry point: the caller supplies a client that
 * already speaks the {@link S3ClientLike} shape (built from the `minio` SDK, an
 * S3 SDK pointed at a MinIO endpoint, or a test double), and this function
 * delegates to the shared base with `name: "minio"`. No provider SDK is imported.
 *
 * @throws {StorageConfigError} when no client is injected — use
 *   {@link connectMinIODriver} to build a client from endpoint options instead.
 */
export function createMinIODriver(
  client: S3ClientLike,
  options: MinIODriverOptions = {},
): StorageDriver {
  if (client === undefined || client === null) {
    throw new StorageConfigError(
      "createMinIODriver requires an injected S3-compatible client. " +
        "Pass an S3ClientLike, or use connectMinIODriver(options) to build one " +
        "from a MinIO endpoint using the optional 'minio' peer dependency.",
      { provider: MINIO_DRIVER_NAME },
    );
  }
  return createS3StyleDriver(client, { ...options, name: MINIO_DRIVER_NAME });
}

/** Connection/endpoint options for building a MinIO client via {@link connectMinIODriver}. */
export interface MinIOConnectionOptions {
  /** Bucket the driver operates within (required — MinIO is bucket-scoped). */
  readonly bucket: string;
  /** MinIO server hostname, e.g. `"127.0.0.1"` or `"minio.example.com"`. */
  readonly endPoint: string;
  /** TCP port of the MinIO server. Defaults to the SDK default when omitted. */
  readonly port?: number;
  /** Whether to use TLS. Defaults to `true`. */
  readonly useSSL?: boolean;
  /** Access key (username) for the MinIO server. */
  readonly accessKey: string;
  /** Secret key (password) for the MinIO server. */
  readonly secretKey: string;
  /** Optional region hint (MinIO tolerates any value; defaults to `"us-east-1"`). */
  readonly region?: string;
  /** Optional session token for temporary credentials. */
  readonly sessionToken?: string;
}

/**
 * Build a MinIO-backed {@link StorageDriver}, constructing the underlying client
 * from `connection` options using the optional `minio` peer SDK.
 *
 * The SDK is resolved with a **lazy dynamic `import()`** performed inside this
 * function, so the peer dependency is only touched when a caller actually asks
 * the driver to build its own client. The resolved SDK client is adapted to the
 * structural {@link S3ClientLike} and handed to {@link createMinIODriver}.
 *
 * @throws {StorageConfigError} when the `minio` SDK is not installed, or when the
 *   client cannot be constructed from the supplied options.
 */
export async function connectMinIODriver(
  connection: MinIOConnectionOptions,
  options: MinIODriverOptions = {},
): Promise<StorageDriver> {
  const sdk = await loadMinioSdk();
  let sdkClient: MinioSdkClient;
  try {
    sdkClient = new sdk.Client({
      endPoint: connection.endPoint,
      port: connection.port,
      useSSL: connection.useSSL ?? true,
      accessKey: connection.accessKey,
      secretKey: connection.secretKey,
      region: connection.region,
      sessionToken: connection.sessionToken,
    });
  } catch (cause) {
    throw new StorageConfigError(
      `Failed to construct a MinIO client for endpoint "${connection.endPoint}".`,
      { provider: MINIO_DRIVER_NAME, cause },
    );
  }
  const client = adaptMinioClient(sdkClient, connection.bucket);
  return createMinIODriver(client, options);
}

// ── Lazy SDK loading ────────────────────────────────────────────────────────

/**
 * Lazily resolve the optional `minio` peer SDK. The module specifier is held in
 * a variable so the compiler does not statically resolve (and therefore require)
 * the optional peer at build time; the resolution happens only at call time.
 *
 * @throws {StorageConfigError} when the SDK is not installed.
 */
async function loadMinioSdk(): Promise<MinioModule> {
  const specifier = "minio";
  try {
    return (await import(specifier)) as unknown as MinioModule;
  } catch (cause) {
    throw new StorageConfigError(
      "The optional 'minio' peer dependency is not installed. Install it " +
        "(`npm install minio`) to build a MinIO client from endpoint options, " +
        "or inject your own S3ClientLike via createMinIODriver(client).",
      { provider: MINIO_DRIVER_NAME, cause },
    );
  }
}

// ── Structural SDK surface (no dependency on the real `minio` types) ──────────

/** The subset of MinIO client constructor options this driver forwards. */
interface MinioClientCtorOptions {
  readonly endPoint: string;
  readonly port?: number;
  readonly useSSL: boolean;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly region?: string;
  readonly sessionToken?: string;
}

/** Result of `statObject` from the MinIO SDK (only the fields we consume). */
interface MinioStatResult {
  readonly size: number;
  readonly etag?: string;
  readonly lastModified?: Date;
  readonly metaData?: Record<string, string>;
}

/** A single entry emitted by the MinIO SDK's `listObjectsV2` object stream. */
interface MinioListEntry {
  readonly name?: string;
  readonly size?: number;
  readonly lastModified?: Date;
}

/** The minimal MinIO SDK client surface this adapter drives. */
interface MinioSdkClient {
  putObject(
    bucket: string,
    objectName: string,
    body: Buffer,
    size?: number,
    metaData?: Record<string, string>,
  ): Promise<{ readonly etag: string }>;
  getObject(bucket: string, objectName: string): Promise<Readable>;
  statObject(bucket: string, objectName: string): Promise<MinioStatResult>;
  removeObject(bucket: string, objectName: string): Promise<void>;
  listObjectsV2(bucket: string, prefix: string, recursive: boolean): Readable;
  presignedUrl(
    method: string,
    bucket: string,
    objectName: string,
    expirySeconds: number,
  ): Promise<string>;
}

/** The shape of the lazily-imported `minio` module. */
interface MinioModule {
  readonly Client: new (options: MinioClientCtorOptions) => MinioSdkClient;
}

// ── SDK → S3ClientLike adapter ────────────────────────────────────────────────

/** User-metadata prefix MinIO/S3 uses for caller-supplied metadata keys. */
const USER_META_PREFIX = "x-amz-meta-";
/** Content-Type header key recognized by the MinIO SDK `metaData` map. */
const CONTENT_TYPE_KEY = "Content-Type";

/**
 * Adapt a MinIO SDK client into the structural {@link S3ClientLike} the base
 * driver consumes, scoping every call to `bucket`. Multipart methods are left
 * unimplemented so the facade simulates multipart over the primitives, keeping
 * behavior identical across providers (Requirement 2.3).
 */
function adaptMinioClient(sdk: MinioSdkClient, bucket: string): S3ClientLike {
  return {
    async putObject(input: S3PutObjectInput): Promise<S3PutObjectOutput> {
      const metaData = encodeMetaData(input.contentType, input.metadata);
      const body = Buffer.from(input.body);
      const result = await sdk.putObject(bucket, input.key, body, body.byteLength, metaData);
      return { etag: result.etag };
    },

    async getObject(input: { readonly key: string }): Promise<S3GetObjectOutput | null> {
      let stat: MinioStatResult | null;
      try {
        stat = await sdk.statObject(bucket, input.key);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      let stream: Readable;
      try {
        stream = await sdk.getObject(bucket, input.key);
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      const body = await collectStream(stream);
      const decoded = decodeMetaData(stat.metaData);
      return {
        body,
        contentType: decoded.contentType,
        etag: stat.etag,
        size: stat.size,
        lastModified: stat.lastModified?.getTime(),
        metadata: decoded.userMetadata,
      };
    },

    async deleteObject(input: { readonly key: string }): Promise<void> {
      try {
        await sdk.removeObject(bucket, input.key);
      } catch (error) {
        if (isNotFound(error)) {
          return;
        }
        throw error;
      }
    },

    async listObjects(input: S3ListInput): Promise<readonly S3ListItem[]> {
      const stream = sdk.listObjectsV2(bucket, input.prefix, input.delimiter !== true);
      const items: S3ListItem[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on("data", (entry: MinioListEntry) => {
          if (typeof entry.name === "string") {
            items.push({
              key: entry.name,
              size: entry.size ?? 0,
              updatedAt: entry.lastModified?.getTime() ?? 0,
            });
          }
        });
        stream.on("error", reject);
        stream.on("end", resolve);
        stream.on("close", resolve);
      });
      const sorted = items.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
      return typeof input.limit === "number" ? sorted.slice(0, input.limit) : sorted;
    },

    async headObject(input: { readonly key: string }): Promise<S3HeadObjectOutput | null> {
      try {
        const stat = await sdk.statObject(bucket, input.key);
        const decoded = decodeMetaData(stat.metaData);
        return {
          contentType: decoded.contentType,
          etag: stat.etag,
          size: stat.size,
          lastModified: stat.lastModified?.getTime(),
          metadata: decoded.userMetadata,
        };
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
    },

    async presignUrl(input: {
      readonly key: string;
      readonly op: "GET" | "PUT" | "DELETE";
      readonly expiresInMs: number;
    }): Promise<string> {
      const expirySeconds = Math.max(1, Math.round(input.expiresInMs / 1000));
      return sdk.presignedUrl(input.op, bucket, input.key, expirySeconds);
    },
  };
}

// ── metadata encode/decode helpers ─────────────────────────────────────────────

/** Encode content type + user metadata into the MinIO SDK `metaData` header map. */
function encodeMetaData(
  contentType: string | undefined,
  metadata: Record<string, string> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (contentType !== undefined) {
    map[CONTENT_TYPE_KEY] = contentType;
  }
  if (metadata !== undefined) {
    for (const [key, value] of Object.entries(metadata)) {
      map[`${USER_META_PREFIX}${key}`] = value;
    }
  }
  return map;
}

/**
 * Decode a MinIO SDK `metaData` map back into a content type and the caller's
 * user-metadata map, stripping the `x-amz-meta-` prefix. MinIO lowercases header
 * keys, so lookups are case-insensitive.
 */
function decodeMetaData(metaData: Record<string, string> | undefined): {
  contentType: string | undefined;
  userMetadata: Record<string, string>;
} {
  const userMetadata: Record<string, string> = {};
  let contentType: string | undefined;
  if (metaData !== undefined) {
    for (const [rawKey, value] of Object.entries(metaData)) {
      const key = rawKey.toLowerCase();
      if (key === CONTENT_TYPE_KEY.toLowerCase()) {
        contentType = value;
      } else if (key.startsWith(USER_META_PREFIX)) {
        userMetadata[key.slice(USER_META_PREFIX.length)] = value;
      }
    }
  }
  return { contentType, userMetadata };
}

/** Collect a Node {@link Readable} into a single {@link Uint8Array}. */
async function collectStream(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/**
 * Detect a MinIO/S3 "object does not exist" error so absence maps to `null`
 * rather than a thrown error, keeping not-found semantics identical to the base.
 */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return (
    code === "NoSuchKey" ||
    code === "NotFound" ||
    code === "NoSuchObject" ||
    statusCode === 404
  );
}
