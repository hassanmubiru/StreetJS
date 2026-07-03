/**
 * @streetjs/storage — CloudflareR2Driver (submodule `@streetjs/storage/r2`).
 *
 * Cloudflare R2 speaks the S3 API, so this driver is a thin **endpoint/credential
 * specialization** of the shared S3-style base ({@link createS3StyleDriver} in
 * `s3-base.ts`). It differs from `s3.ts` only in how the underlying client is
 * built — R2 uses an account-specific endpoint
 * (`https://<accountId>.r2.cloudflarestorage.com`) with `region: "auto"` — never
 * in how the {@link StorageDriver} contract is satisfied.
 *
 * ## Two ways to obtain a driver
 *
 * - {@link createCloudflareR2Driver} wraps an **already-constructed, injected**
 *   structural {@link S3ClientLike} and returns a driver synchronously. This is
 *   the SDK-free path: no provider SDK is touched, so it is fully testable with
 *   an in-memory fake and needs no `@aws-sdk/*` install.
 * - {@link connectCloudflareR2Driver} **builds its own client** from R2
 *   connection config. It resolves the S3-compatible SDK through a **lazy
 *   dynamic `import()` performed inside the function** (never at module top
 *   level), so the optional peer dependency is only required when this path is
 *   actually used. If the SDK is not installed and no client was injected, it
 *   throws {@link StorageConfigError} (Requirement 1.5).
 *
 * ## SDK isolation (Requirements 2.1, 3.3)
 *
 * This module imports **no provider SDK at the top level** — only this package's
 * own base/types/errors. The AWS S3 SDK (which R2 uses) is referenced solely via
 * a dynamic `import()` with a non-literal specifier inside
 * {@link connectCloudflareR2Driver}, so `tsc` never requires the SDK to be
 * present and `streetjs` stays the only runtime dependency. This driver is a
 * submodule-only export (`./r2` → `dist/drivers/r2.js`); it is intentionally not
 * re-exported from the package's main `index.ts`.
 *
 * _Requirements: 2.1, 2.3, 3.3_
 */

import type { Clock } from "streetjs";

import type { StorageDriver } from "../driver.js";
import { StorageConfigError } from "../errors.js";
import {
  createS3StyleDriver,
  S3StyleDriver,
  type S3ClientLike,
  type S3GetObjectOutput,
  type S3HeadObjectOutput,
  type S3ListInput,
  type S3ListItem,
  type S3NativeCapabilities,
  type S3PutObjectInput,
  type S3PutObjectOutput,
} from "./s3-base.js";

/** The stable driver name surfaced as {@link StorageDriver.name} for R2. */
const R2_DRIVER_NAME = "r2";

/**
 * Options for the R2 driver. Mirrors the S3-style base options but omits `name`
 * — the R2 driver's name is fixed to `"r2"` so provider identity is stable.
 */
export interface CloudflareR2DriverOptions {
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
  /**
   * Native capability objects to delegate to. Any capability omitted here (and
   * not derivable from the client) is left `undefined` so the facade simulates
   * it over the primitives.
   */
  readonly capabilities?: S3NativeCapabilities;
}

/**
 * Connection configuration for {@link connectCloudflareR2Driver}. These are the
 * R2-specific coordinates used to build the endpoint and sign requests.
 */
export interface CloudflareR2Config extends CloudflareR2DriverOptions {
  /** Cloudflare account id — forms the R2 endpoint host. */
  readonly accountId: string;
  /** Target R2 bucket name. */
  readonly bucket: string;
  /** R2 access key id (S3-compatible credential). */
  readonly accessKeyId: string;
  /** R2 secret access key (S3-compatible credential). */
  readonly secretAccessKey: string;
  /**
   * Override the derived endpoint. Defaults to
   * `https://<accountId>.r2.cloudflarestorage.com`.
   */
  readonly endpoint?: string;
  /** S3 SDK region. R2 ignores region but the SDK requires one; default `"auto"`. */
  readonly region?: string;
}

/**
 * The CloudflareR2 {@link StorageDriver}: the shared S3-style base pinned to the
 * `"r2"` provider name. Construction is identical to the base — supply an
 * {@link S3ClientLike} — the only difference is the fixed name.
 */
export class CloudflareR2Driver extends S3StyleDriver {
  constructor(client: S3ClientLike, options: CloudflareR2DriverOptions = {}) {
    super(client, { ...options, name: R2_DRIVER_NAME });
  }
}

/**
 * Wrap an injected {@link S3ClientLike} as an R2 driver, delegating to
 * {@link createS3StyleDriver} with the name `"r2"`. Synchronous and SDK-free:
 * the caller supplies the client, so no provider SDK is resolved here.
 */
export function createCloudflareR2Driver(
  client: S3ClientLike,
  options: CloudflareR2DriverOptions = {},
): StorageDriver {
  return createS3StyleDriver(client, { ...options, name: R2_DRIVER_NAME });
}

/**
 * Build an R2 driver that owns its client, resolving the S3-compatible SDK
 * lazily.
 *
 * The SDK is loaded through a dynamic `import()` with a non-literal specifier so
 * it is never a static/top-level dependency: `tsc` does not require it to be
 * installed, and it is only resolved when this function runs. When the SDK
 * cannot be resolved, a {@link StorageConfigError} is thrown (Requirement 1.5) —
 * callers that cannot install the SDK should use {@link createCloudflareR2Driver}
 * with their own {@link S3ClientLike} instead.
 */
export async function connectCloudflareR2Driver(
  config: CloudflareR2Config,
): Promise<StorageDriver> {
  const { accountId, bucket, accessKeyId, secretAccessKey } = config;
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) {
    throw new StorageConfigError(
      "CloudflareR2 requires accountId, bucket, accessKeyId, and secretAccessKey.",
      { provider: R2_DRIVER_NAME },
    );
  }

  const endpoint =
    config.endpoint ?? `https://${accountId}.r2.cloudflarestorage.com`;
  const region = config.region ?? "auto";

  // Lazy, non-literal dynamic import so the S3 SDK stays an optional peer that
  // `tsc` never resolves statically and Node only loads on this path.
  const specifier = "@aws-sdk/client-s3";
  let sdk: AwsS3Module;
  try {
    sdk = (await import(specifier)) as unknown as AwsS3Module;
  } catch (cause) {
    throw new StorageConfigError(
      'CloudflareR2 driver requires the optional peer dependency "@aws-sdk/client-s3". ' +
        "Install it, or inject your own S3ClientLike via createCloudflareR2Driver().",
      { provider: R2_DRIVER_NAME, cause },
    );
  }

  const s3 = new sdk.S3Client({
    region,
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });

  const client = adaptAwsS3Client(s3, sdk, bucket);
  return createCloudflareR2Driver(client, {
    clock: config.clock,
    capabilities: config.capabilities,
  });
}

// ── AWS S3 SDK adapter ─────────────────────────────────────────────────────────

/**
 * Adapt an AWS S3 v3 client into the structural {@link S3ClientLike} the base
 * depends on, binding every call to `bucket`. Only the methods the base uses are
 * mapped; the AWS response shapes are narrowed through the local structural
 * types below so this module never imports concrete SDK types.
 */
function adaptAwsS3Client(
  s3: AwsS3Client,
  sdk: AwsS3Module,
  bucket: string,
): S3ClientLike {
  return {
    async putObject(input: S3PutObjectInput): Promise<S3PutObjectOutput> {
      const res = await s3.send(
        new sdk.PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
      return { etag: res.ETag ?? "" };
    },

    async getObject(input: { readonly key: string }): Promise<S3GetObjectOutput | null> {
      let res: AwsGetObjectResponse;
      try {
        res = await s3.send(
          new sdk.GetObjectCommand({ Bucket: bucket, Key: input.key }),
        );
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      const body = res.Body ? await res.Body.transformToByteArray() : new Uint8Array(0);
      return {
        body,
        contentType: res.ContentType,
        etag: res.ETag,
        size: res.ContentLength ?? body.byteLength,
        lastModified: toEpochMs(res.LastModified),
        metadata: res.Metadata,
      };
    },

    async deleteObject(input: { readonly key: string }): Promise<void> {
      await s3.send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: input.key }));
    },

    async listObjects(input: S3ListInput): Promise<readonly S3ListItem[]> {
      const res = await s3.send(
        new sdk.ListObjectsV2Command({
          Bucket: bucket,
          Prefix: input.prefix,
          MaxKeys: input.limit,
          ContinuationToken: input.cursor,
          Delimiter: input.delimiter === true ? "/" : undefined,
        }),
      );
      const contents = res.Contents ?? [];
      return contents.map((item) => ({
        key: item.Key ?? "",
        size: item.Size ?? 0,
        updatedAt: toEpochMs(item.LastModified) ?? 0,
      }));
    },

    async headObject(
      input: { readonly key: string },
    ): Promise<S3HeadObjectOutput | null> {
      let res: AwsHeadObjectResponse;
      try {
        res = await s3.send(
          new sdk.HeadObjectCommand({ Bucket: bucket, Key: input.key }),
        );
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      return {
        contentType: res.ContentType,
        etag: res.ETag,
        size: res.ContentLength,
        lastModified: toEpochMs(res.LastModified),
        metadata: res.Metadata,
      };
    },

    async createMultipartUpload(input: {
      readonly key: string;
      readonly contentType?: string;
      readonly metadata?: Record<string, string>;
    }): Promise<{ readonly uploadId: string }> {
      const res = await s3.send(
        new sdk.CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: input.key,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
      return { uploadId: res.UploadId ?? "" };
    },

    async uploadPart(input: {
      readonly key: string;
      readonly uploadId: string;
      readonly partNumber: number;
      readonly body: Uint8Array;
    }): Promise<{ readonly etag: string }> {
      const res = await s3.send(
        new sdk.UploadPartCommand({
          Bucket: bucket,
          Key: input.key,
          UploadId: input.uploadId,
          PartNumber: input.partNumber,
          Body: input.body,
        }),
      );
      return { etag: res.ETag ?? "" };
    },

    async completeMultipartUpload(input: {
      readonly key: string;
      readonly uploadId: string;
      readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
    }): Promise<{ readonly etag: string }> {
      const res = await s3.send(
        new sdk.CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: input.key,
          UploadId: input.uploadId,
          MultipartUpload: {
            Parts: input.parts.map((part) => ({
              PartNumber: part.partNumber,
              ETag: part.etag,
            })),
          },
        }),
      );
      return { etag: res.ETag ?? "" };
    },

    async abortMultipartUpload(input: {
      readonly key: string;
      readonly uploadId: string;
    }): Promise<void> {
      await s3.send(
        new sdk.AbortMultipartUploadCommand({
          Bucket: bucket,
          Key: input.key,
          UploadId: input.uploadId,
        }),
      );
    },
  };
}

/**
 * Recognize the "no such key / not found" conditions the S3 API reports so
 * `getObject`/`headObject` can return `null` (Requirement 4.2/4.10) rather than
 * throwing. Matches the SDK's error `name` and the HTTP 404 status.
 */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const record = error as {
    readonly name?: unknown;
    readonly Code?: unknown;
    readonly $metadata?: { readonly httpStatusCode?: unknown };
  };
  if (record.name === "NoSuchKey" || record.name === "NotFound") {
    return true;
  }
  if (record.Code === "NoSuchKey" || record.Code === "NotFound") {
    return true;
  }
  return record.$metadata?.httpStatusCode === 404;
}

/** Convert an SDK `Date` (or undefined) to epoch milliseconds. */
function toEpochMs(value: Date | undefined): number | undefined {
  return value instanceof Date ? value.getTime() : undefined;
}

// ── Structural SDK types (never import concrete @aws-sdk types) ──────────────────
//
// These describe only the slice of the AWS S3 v3 SDK this adapter touches, so
// the module compiles with no SDK installed and stays decoupled from SDK
// versions. They are intentionally loose (command inputs are plain records).

/** The AWS S3 v3 `GetObject` response fields this adapter reads. */
interface AwsGetObjectResponse {
  readonly Body?: { transformToByteArray(): Promise<Uint8Array> };
  readonly ContentType?: string;
  readonly ETag?: string;
  readonly ContentLength?: number;
  readonly LastModified?: Date;
  readonly Metadata?: Record<string, string>;
}

/** The AWS S3 v3 `HeadObject` response fields this adapter reads. */
interface AwsHeadObjectResponse {
  readonly ContentType?: string;
  readonly ETag?: string;
  readonly ContentLength?: number;
  readonly LastModified?: Date;
  readonly Metadata?: Record<string, string>;
}

/** A single `ListObjectsV2` content entry. */
interface AwsListObjectEntry {
  readonly Key?: string;
  readonly Size?: number;
  readonly LastModified?: Date;
}

/** Union of the response shapes returned by the commands this adapter sends. */
interface AwsSendResponse {
  readonly ETag?: string;
  readonly UploadId?: string;
  readonly Body?: { transformToByteArray(): Promise<Uint8Array> };
  readonly ContentType?: string;
  readonly ContentLength?: number;
  readonly LastModified?: Date;
  readonly Metadata?: Record<string, string>;
  readonly Contents?: readonly AwsListObjectEntry[];
}

/** The minimal AWS S3 v3 client surface: a single `send`. */
interface AwsS3Client {
  send(command: unknown): Promise<AwsSendResponse & AwsGetObjectResponse & AwsHeadObjectResponse>;
}

/** Structural view of the `@aws-sdk/client-s3` module members this adapter uses. */
interface AwsS3Module {
  S3Client: new (config: {
    readonly region: string;
    readonly endpoint: string;
    readonly credentials: { readonly accessKeyId: string; readonly secretAccessKey: string };
    readonly forcePathStyle?: boolean;
  }) => AwsS3Client;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
  HeadObjectCommand: new (input: Record<string, unknown>) => unknown;
  DeleteObjectCommand: new (input: Record<string, unknown>) => unknown;
  ListObjectsV2Command: new (input: Record<string, unknown>) => unknown;
  CreateMultipartUploadCommand: new (input: Record<string, unknown>) => unknown;
  UploadPartCommand: new (input: Record<string, unknown>) => unknown;
  CompleteMultipartUploadCommand: new (input: Record<string, unknown>) => unknown;
  AbortMultipartUploadCommand: new (input: Record<string, unknown>) => unknown;
}
