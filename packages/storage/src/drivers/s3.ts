/**
 * @streetjs/storage — {@link S3StorageDriver} (Amazon S3), submodule `./s3`.
 *
 * This module is the concrete Amazon S3 provider driver, exposed only through
 * the optional subpath export `@streetjs/storage/s3` (Requirement 3.3). It is
 * **not** re-exported from the package entry point `src/index.ts`, so importing
 * the base package never pulls in this file or any AWS SDK.
 *
 * ## What this module adds over the base
 *
 * The entire {@link StorageDriver} contract mapping already lives in the shared
 * {@link createS3StyleDriver} / {@link S3StyleDriver} base (task 28.1) built over
 * the structural {@link S3ClientLike}. Amazon S3, Cloudflare R2, MinIO and the
 * Backblaze B2 S3 API differ only in **how the client is built/configured**, not
 * in how the contract is satisfied — so this module contributes only:
 *
 * 1. {@link createS3StorageDriver} — wrap an **injected** {@link S3ClientLike}
 *    (the preferred, SDK-free path) as a `name: "s3"` driver by delegating to the
 *    base. No AWS SDK is loaded on this path.
 * 2. {@link createS3StorageDriverFromConfig} — construct an {@link S3ClientLike}
 *    from `bucket`/`region`/`endpoint`/`credentials` using a **lazy dynamic
 *    `import()`** of the AWS SDK performed *inside* the function. The SDK is
 *    therefore resolved only when this construction path actually runs, never at
 *    module load, keeping the AWS SDK an optional peer concern of the consumer
 *    (Requirement 3.1). If the SDK cannot be loaded and no client was injected, a
 *    descriptive {@link StorageConfigError} is thrown.
 *
 * ## SDK isolation (Requirements 2.1, 3.3)
 *
 * There is **no top-level `import` of any AWS SDK** in this file — only `streetjs`
 * (for {@link Clock}), this package's own type surface, and the shared base. The
 * `@aws-sdk/client-s3` / `@aws-sdk/s3-request-presigner` packages are declared as
 * **optional peer dependencies** in `package.json`; they are pulled in only by
 * the lazy `import()` inside {@link createS3StorageDriverFromConfig}. The dynamic
 * specifier is held in a variable so the build never statically requires the SDK
 * to be installed.
 *
 * _Requirements: 2.1, 2.3, 3.3_
 */

import { type Clock } from "streetjs";

import type { StorageDriver } from "../driver.js";
import { StorageConfigError } from "../errors.js";
import {
  createS3StyleDriver,
  type S3ClientLike,
  type S3ListItem,
  type S3NativeCapabilities,
} from "./s3-base.js";

/** The stable driver name surfaced as {@link StorageDriver.name} for this driver. */
const DRIVER_NAME = "s3";

// ── Options ────────────────────────────────────────────────────────────────────

/**
 * Options accepted by {@link createS3StorageDriver} and, alongside the
 * connection fields, by {@link createS3StorageDriverFromConfig}.
 *
 * The driver `name` is always `"s3"` and is intentionally not configurable here
 * (use the shared base directly if a different name is required).
 */
export interface S3StorageDriverOptions {
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
  /**
   * Native capability objects to delegate to (versioning / lifecycle / signed
   * URLs). Any capability omitted here is left `undefined` so the facade
   * simulates it over the primitives, keeping behavior identical across
   * providers (Requirement 2.3).
   */
  readonly capabilities?: S3NativeCapabilities;
}

/** AWS credentials used when constructing a client from configuration. */
export interface S3Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
}

/**
 * Connection configuration for {@link createS3StorageDriverFromConfig}. A
 * pre-constructed {@link S3ClientLike} may be supplied via `client` to bypass SDK
 * construction entirely (the preferred, SDK-free path).
 */
export interface S3StorageDriverConfig extends S3StorageDriverOptions {
  /** The S3 bucket every operation targets. Required when constructing a client. */
  readonly bucket: string;
  /** AWS region (e.g. `"us-east-1"`). */
  readonly region?: string;
  /** Custom endpoint (for S3-compatible gateways). */
  readonly endpoint?: string;
  /** Static credentials; when omitted the SDK's default credential chain is used. */
  readonly credentials?: S3Credentials;
  /** Force path-style addressing (needed by some S3-compatible endpoints). */
  readonly forcePathStyle?: boolean;
  /**
   * A pre-constructed structural client. When provided, no AWS SDK is loaded and
   * this client is wrapped directly.
   */
  readonly client?: S3ClientLike;
}

// ── Public factories ─────────────────────────────────────────────────────────

/**
 * Wrap an **injected** {@link S3ClientLike} as an Amazon S3 {@link StorageDriver}
 * (`name: "s3"`). This is the preferred path: no AWS SDK is required because the
 * caller supplies the structural client, and the whole {@link StorageDriver}
 * contract is satisfied by the shared base (Requirement 2.3).
 *
 * @throws {StorageConfigError} when `client` is missing or does not implement the
 * mandatory {@link S3ClientLike} object operations. To build a client from
 * credentials instead, use {@link createS3StorageDriverFromConfig}.
 */
export function createS3StorageDriver(
  client: S3ClientLike,
  options: S3StorageDriverOptions = {},
): StorageDriver {
  if (!isS3ClientLike(client)) {
    throw new StorageConfigError(
      'createS3StorageDriver requires an injected S3ClientLike implementing ' +
        'putObject/getObject/deleteObject/listObjects. Pass a structural client, ' +
        'or use createS3StorageDriverFromConfig to construct one from credentials ' +
        'via the optional "@aws-sdk/client-s3" peer dependency.',
      { provider: DRIVER_NAME },
    );
  }
  return createS3StyleDriver(client, {
    name: DRIVER_NAME,
    clock: options.clock,
    capabilities: options.capabilities,
  });
}

/**
 * Construct an Amazon S3 {@link StorageDriver} from connection configuration.
 *
 * When `config.client` is supplied it is wrapped directly (no SDK is loaded).
 * Otherwise this **lazily `import()`s** `@aws-sdk/client-s3` and builds a client
 * over the SDK — the SDK is resolved only here, at construction time, never at
 * module load. If the SDK cannot be loaded, a descriptive {@link StorageConfigError}
 * is thrown so a missing optional peer dependency surfaces clearly rather than as
 * an opaque module-resolution failure (Requirements 2.1, 3.3).
 */
export async function createS3StorageDriverFromConfig(
  config: S3StorageDriverConfig,
): Promise<StorageDriver> {
  const client =
    config.client !== undefined && config.client !== null
      ? config.client
      : await buildS3ClientFromSdk(config);

  return createS3StorageDriver(client, {
    clock: config.clock,
    capabilities: config.capabilities,
  });
}

// ── Internal: structural client guard ──────────────────────────────────────────

/**
 * Structural check that `value` implements the mandatory {@link S3ClientLike}
 * object operations. Optional methods (`headObject`, multipart, `presignUrl`) are
 * not required and are feature-detected by the base.
 */
function isS3ClientLike(value: unknown): value is S3ClientLike {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<Record<keyof S3ClientLike, unknown>>;
  return (
    typeof candidate.putObject === "function" &&
    typeof candidate.getObject === "function" &&
    typeof candidate.deleteObject === "function" &&
    typeof candidate.listObjects === "function"
  );
}

// ── Internal: lazy AWS SDK client construction ─────────────────────────────────

/**
 * Build an {@link S3ClientLike} over the real AWS SDK, loaded lazily.
 *
 * The SDK module specifiers are held in variables so the TypeScript build never
 * statically resolves (and therefore never requires) the optional peer
 * dependencies. Any load failure is wrapped in a {@link StorageConfigError}.
 */
async function buildS3ClientFromSdk(config: S3StorageDriverConfig): Promise<S3ClientLike> {
  // Held in a variable so the compiler treats this as a dynamic (untyped) import
  // and does not require "@aws-sdk/client-s3" to be installed to build.
  const clientModuleId = "@aws-sdk/client-s3";
  let sdk: S3Sdk;
  try {
    sdk = (await import(clientModuleId)) as unknown as S3Sdk;
  } catch (cause) {
    throw new StorageConfigError(
      'The AWS SDK ("@aws-sdk/client-s3") is required to construct an S3 client ' +
        "from credentials but could not be loaded. Install it as an optional peer " +
        "dependency, or inject a structural S3ClientLike via createS3StorageDriver.",
      { provider: DRIVER_NAME, cause },
    );
  }

  const bucket = config.bucket;
  const sdkClient = new sdk.S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: config.credentials,
  });

  const send = <R>(command: S3Command): Promise<R> => sdkClient.send(command) as Promise<R>;
  const command = (name: string, input: unknown): S3Command => new sdk[name](input);

  return {
    async putObject({ key, body, contentType, metadata }) {
      const out = await send<{ ETag?: string }>(
        command("PutObjectCommand", {
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
      return { etag: out.ETag ?? "" };
    },

    async getObject({ key }) {
      let out: S3GetResponse;
      try {
        out = await send<S3GetResponse>(
          command("GetObjectCommand", { Bucket: bucket, Key: key }),
        );
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      return {
        body: await collectBody(out.Body),
        contentType: out.ContentType,
        etag: out.ETag,
        size: out.ContentLength,
        lastModified: toEpochMs(out.LastModified),
        metadata: out.Metadata,
      };
    },

    async deleteObject({ key }) {
      await send(command("DeleteObjectCommand", { Bucket: bucket, Key: key }));
    },

    async listObjects({ prefix, limit, cursor }) {
      const out = await send<S3ListResponse>(
        command("ListObjectsV2Command", {
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: limit,
          ContinuationToken: cursor,
        }),
      );
      const contents = out.Contents ?? [];
      const items: S3ListItem[] = [];
      for (const entry of contents) {
        if (entry.Key === undefined) {
          continue;
        }
        items.push({
          key: entry.Key,
          size: entry.Size ?? 0,
          updatedAt: toEpochMs(entry.LastModified) ?? 0,
        });
      }
      return items;
    },

    async headObject({ key }) {
      let out: S3HeadResponse;
      try {
        out = await send<S3HeadResponse>(
          command("HeadObjectCommand", { Bucket: bucket, Key: key }),
        );
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      return {
        contentType: out.ContentType,
        etag: out.ETag,
        size: out.ContentLength,
        lastModified: toEpochMs(out.LastModified),
        metadata: out.Metadata,
      };
    },

    async createMultipartUpload({ key, contentType, metadata }) {
      const out = await send<{ UploadId?: string }>(
        command("CreateMultipartUploadCommand", {
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
      return { uploadId: out.UploadId ?? "" };
    },

    async uploadPart({ key, uploadId, partNumber, body }) {
      const out = await send<{ ETag?: string }>(
        command("UploadPartCommand", {
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
        }),
      );
      return { etag: out.ETag ?? "" };
    },

    async completeMultipartUpload({ key, uploadId, parts }) {
      const out = await send<{ ETag?: string }>(
        command("CompleteMultipartUploadCommand", {
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
      return { etag: out.ETag ?? "" };
    },

    async abortMultipartUpload({ key, uploadId }) {
      await send(
        command("AbortMultipartUploadCommand", {
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        }),
      );
    },

    async presignUrl({ key, op, expiresInMs }) {
      // Held in a variable for the same lazy, build-independent reason as above.
      const presignModuleId = "@aws-sdk/s3-request-presigner";
      let presigner: {
        getSignedUrl: (client: S3SdkClient, command: S3Command, options: unknown) => Promise<string>;
      };
      try {
        presigner = (await import(presignModuleId)) as unknown as typeof presigner;
      } catch (cause) {
        throw new StorageConfigError(
          'The AWS SDK presigner ("@aws-sdk/s3-request-presigner") is required to ' +
            "mint presigned URLs but could not be loaded. Install it as an optional " +
            "peer dependency.",
          { provider: DRIVER_NAME, cause },
        );
      }
      const commandName =
        op === "PUT"
          ? "PutObjectCommand"
          : op === "DELETE"
            ? "DeleteObjectCommand"
            : "GetObjectCommand";
      return presigner.getSignedUrl(sdkClient, command(commandName, { Bucket: bucket, Key: key }), {
        expiresIn: Math.max(1, Math.round(expiresInMs / 1000)),
      });
    },
  };
}

// ── Internal: SDK structural shapes and helpers ────────────────────────────────

/** Minimal structural shape of an SDK command instance. */
interface S3Command {
  readonly input?: unknown;
}

/** Minimal structural shape of the SDK's `S3Client`. */
interface S3SdkClient {
  send(command: S3Command): Promise<unknown>;
}

/** A command constructor as exported by `@aws-sdk/client-s3`. */
type S3CommandCtor = new (input: unknown) => S3Command;

/**
 * Minimal structural shape of the lazily loaded `@aws-sdk/client-s3` module: the
 * `S3Client` constructor plus the command constructors accessed by name.
 */
interface S3Sdk {
  readonly S3Client: new (config: unknown) => S3SdkClient;
}

/** Structural shape of a `GetObjectCommand` response (subset we consume). */
interface S3GetResponse {
  readonly Body?: unknown;
  readonly ContentType?: string;
  readonly ETag?: string;
  readonly ContentLength?: number;
  readonly LastModified?: Date;
  readonly Metadata?: Record<string, string>;
}

/** Structural shape of a `HeadObjectCommand` response (subset we consume). */
interface S3HeadResponse {
  readonly ContentType?: string;
  readonly ETag?: string;
  readonly ContentLength?: number;
  readonly LastModified?: Date;
  readonly Metadata?: Record<string, string>;
}

/** Structural shape of a `ListObjectsV2Command` response (subset we consume). */
interface S3ListResponse {
  readonly Contents?: ReadonlyArray<{
    readonly Key?: string;
    readonly Size?: number;
    readonly LastModified?: Date;
  }>;
}

/** Convert an SDK `Date` (or `undefined`) to epoch ms. */
function toEpochMs(date: Date | undefined): number | undefined {
  return date instanceof Date ? date.getTime() : undefined;
}

/**
 * Detect the SDK's "object does not exist" signals so a missing key maps to the
 * base's `null` convention rather than a thrown error.
 */
function isNotFound(error: unknown): boolean {
  if (error === null || typeof error !== "object") {
    return false;
  }
  const err = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    err.name === "NoSuchKey" ||
    err.name === "NotFound" ||
    err.Code === "NoSuchKey" ||
    err.$metadata?.httpStatusCode === 404
  );
}

/**
 * Collect an SDK response body into a `Uint8Array`. Prefers the SDK's
 * `transformToByteArray()` helper and falls back to async iteration for stream
 * bodies.
 */
async function collectBody(body: unknown): Promise<Uint8Array> {
  if (body === null || body === undefined) {
    return new Uint8Array(0);
  }
  const maybe = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  };
  if (typeof maybe.transformToByteArray === "function") {
    return new Uint8Array(await maybe.transformToByteArray());
  }
  if (typeof maybe[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<unknown>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  if (body instanceof Uint8Array) {
    return body.slice();
  }
  return new Uint8Array(0);
}
