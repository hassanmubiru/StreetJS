/**
 * @streetjs/storage — the Backblaze B2 driver submodule (`@streetjs/storage/backblaze`).
 *
 * Backblaze B2 exposes a **fully S3-compatible API**, so this driver is a thin
 * specialization of the shared S3-style base ({@link createS3StyleDriver} in
 * `s3-base.ts`): it only differs in how the underlying client is
 * built/configured (a B2 S3 endpoint and B2 application-key credentials), never
 * in how the {@link StorageDriver} contract is satisfied. The driver name is
 * fixed to `"backblaze"`.
 *
 * ## SDK isolation (Requirements 3.1, 3.3)
 *
 * This module imports **no provider SDK at the top level** — only this package's
 * own type surface and the shared S3-style base. It supports two construction
 * modes:
 *
 * 1. **Injected structural client** — the caller passes an {@link S3ClientLike}
 *    (the minimal, SDK-shaped structural interface the base depends on). The SDK
 *    is then entirely a concern of the caller; this package resolves nothing.
 *    ({@link createBackblazeB2Driver} with a client, synchronous.)
 * 2. **Self-built client from connection config** — the driver constructs its own
 *    S3-compatible client for the B2 endpoint using a **lazy dynamic `import()`**
 *    performed inside the factory at construction time (never at module top
 *    level), so `@aws-sdk/client-s3` is resolved only when this submodule is
 *    actually used to build a client. If that optional peer SDK is absent (and no
 *    client was injected), a descriptive {@link StorageConfigError} is thrown.
 *    ({@link createBackblazeB2Driver} with a config, asynchronous.)
 *
 * Because this driver lives behind the `./backblaze` subpath export and the base
 * package never imports it, `streetjs` stays the only runtime dependency and the
 * B2/S3 SDK remains an optional peer dependency.
 *
 * _Requirements: 2.1, 2.3, 3.3_
 */

import { Buffer } from "node:buffer";

import { systemClock, type Clock } from "streetjs";

import type { StorageDriver } from "../driver.js";
import { StorageConfigError } from "../errors.js";
import {
  createS3StyleDriver,
  S3StyleDriver,
  type S3ClientLike,
  type S3GetObjectOutput,
  type S3HeadObjectOutput,
  type S3ListItem,
  type S3NativeCapabilities,
  type S3PutObjectInput,
  type S3PutObjectOutput,
} from "./s3-base.js";

/** The stable driver name surfaced as {@link StorageDriver.name}. */
export const BACKBLAZE_DRIVER_NAME = "backblaze";

/** Peer SDK specifier resolved lazily when the driver builds its own client. */
const BACKBLAZE_SDK_SPECIFIER = "@aws-sdk/client-s3";

// ── Options ─────────────────────────────────────────────────────────────────

/**
 * Options shared by both construction modes. Native capability objects supplied
 * here are delegated by the base; anything omitted is simulated by the facade
 * over the mandatory primitives (identical behavior across providers).
 */
export interface BackblazeB2DriverOptions {
  /** Overrides the driver name. Defaults to `"backblaze"`; changing it is rare. */
  readonly name?: string;
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  readonly clock?: Clock;
  /** Native capability objects (versioning/lifecycle/signed URLs) to delegate. */
  readonly capabilities?: S3NativeCapabilities;
}

/**
 * B2 application-key credentials, expressed in S3 terms. The B2 `keyId` maps to
 * `accessKeyId` and the B2 `applicationKey` maps to `secretAccessKey`.
 */
export interface BackblazeB2Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/**
 * Connection config used when the driver **builds its own** S3-compatible client
 * for the Backblaze B2 endpoint (the lazy-`import()` path).
 */
export interface BackblazeB2ConnectionConfig extends BackblazeB2DriverOptions {
  /** The B2 bucket name every object operation targets. */
  readonly bucket: string;
  /**
   * The B2 S3-compatible endpoint, e.g. `https://s3.us-west-002.backblazeb2.com`.
   */
  readonly endpoint: string;
  /**
   * The B2 region label embedded in the endpoint, e.g. `us-west-002`. Defaults to
   * `"auto"` when omitted (the S3 client requires some region value).
   */
  readonly region?: string;
  /** The B2 application-key credentials (as S3 access/secret keys). */
  readonly credentials: BackblazeB2Credentials;
  /**
   * Use path-style addressing (`endpoint/bucket/key`) instead of virtual-hosted
   * style. Defaults to `false`; B2's S3 endpoint supports virtual-hosted style.
   */
  readonly forcePathStyle?: boolean;
}

// ── Public factory ────────────────────────────────────────────────────────────

/**
 * Create a Backblaze B2 {@link StorageDriver} from an **injected**
 * {@link S3ClientLike}. Synchronous: no SDK is resolved by this package.
 */
export function createBackblazeB2Driver(
  client: S3ClientLike,
  options?: BackblazeB2DriverOptions,
): StorageDriver;
/**
 * Create a Backblaze B2 {@link StorageDriver} that **builds its own** client for
 * the B2 S3 endpoint. Asynchronous: the SDK is resolved through a lazy dynamic
 * `import()`; a {@link StorageConfigError} is thrown when it is absent.
 */
export function createBackblazeB2Driver(
  config: BackblazeB2ConnectionConfig,
): Promise<StorageDriver>;
export function createBackblazeB2Driver(
  clientOrConfig: S3ClientLike | BackblazeB2ConnectionConfig,
  options: BackblazeB2DriverOptions = {},
): StorageDriver | Promise<StorageDriver> {
  if (isS3ClientLike(clientOrConfig)) {
    return buildDriver(clientOrConfig, options);
  }
  return buildFromConnectionConfig(clientOrConfig);
}

/**
 * A Backblaze B2 driver as a concrete class over an injected {@link S3ClientLike},
 * for callers who prefer `new` construction. Equivalent to
 * {@link createBackblazeB2Driver} with an injected client; the name defaults to
 * `"backblaze"`.
 */
export class BackblazeB2Driver extends S3StyleDriver {
  constructor(client: S3ClientLike, options: BackblazeB2DriverOptions = {}) {
    super(client, {
      name: options.name ?? BACKBLAZE_DRIVER_NAME,
      clock: options.clock ?? systemClock,
      capabilities: options.capabilities,
    });
  }
}

// ── Internal construction helpers ───────────────────────────────────────────

/** Delegate to the shared S3-style base, fixing the name to `"backblaze"`. */
function buildDriver(client: S3ClientLike, options: BackblazeB2DriverOptions): StorageDriver {
  return createS3StyleDriver(client, {
    name: options.name ?? BACKBLAZE_DRIVER_NAME,
    clock: options.clock ?? systemClock,
    capabilities: options.capabilities,
  });
}

/**
 * Build a B2 S3-compatible client via a lazy dynamic `import()` of the optional
 * peer SDK, then wrap it in {@link S3ClientLike} and hand it to the base. Throws
 * a descriptive {@link StorageConfigError} when the SDK cannot be resolved.
 */
async function buildFromConnectionConfig(
  config: BackblazeB2ConnectionConfig,
): Promise<StorageDriver> {
  const client = await buildBackblazeS3Client(config);
  return buildDriver(client, config);
}

/**
 * Structural guard distinguishing an injected {@link S3ClientLike} from a
 * connection config: only a client exposes the mandatory `putObject` method.
 */
function isS3ClientLike(value: S3ClientLike | BackblazeB2ConnectionConfig): value is S3ClientLike {
  return typeof (value as Partial<S3ClientLike>).putObject === "function";
}

// ── The lazily-built S3-compatible client for Backblaze B2 ──────────────────────

/**
 * Resolve `@aws-sdk/client-s3` lazily and adapt it into an {@link S3ClientLike}
 * bound to the B2 bucket/endpoint. The specifier is held in a variable so the
 * static build never requires the optional peer dependency to be installed; it
 * is resolved only at call time.
 */
async function buildBackblazeS3Client(
  config: BackblazeB2ConnectionConfig,
): Promise<S3ClientLike> {
  // Lazy dynamic import — never a top-level import. An indirection variable keeps
  // the specifier non-literal so the module is not required at build time.
  const specifier = BACKBLAZE_SDK_SPECIFIER;
  let sdk: BackblazeS3Sdk;
  try {
    sdk = (await import(specifier)) as BackblazeS3Sdk;
  } catch (cause) {
    throw new StorageConfigError(
      `The Backblaze B2 driver requires the optional peer dependency "${BACKBLAZE_SDK_SPECIFIER}". ` +
        `Install it, or pass a pre-constructed S3ClientLike to createBackblazeB2Driver().`,
      { provider: BACKBLAZE_DRIVER_NAME, cause },
    );
  }

  const bucket = config.bucket;
  const raw = new sdk.S3Client({
    endpoint: config.endpoint,
    region: config.region ?? "auto",
    credentials: {
      accessKeyId: config.credentials.accessKeyId,
      secretAccessKey: config.credentials.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle ?? false,
  });

  const send = (command: unknown): Promise<AwsResult> =>
    raw.send(command as never) as Promise<AwsResult>;

  return {
    async putObject(input: S3PutObjectInput): Promise<S3PutObjectOutput> {
      const result = await send(
        new sdk.PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.body,
          ContentType: input.contentType,
          Metadata: input.metadata,
        }),
      );
      return { etag: normalizeEtag(result.ETag) };
    },

    async getObject({ key }): Promise<S3GetObjectOutput | null> {
      let result: AwsResult;
      try {
        result = await send(new sdk.GetObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      const body = await collectBody(result.Body);
      return {
        body,
        contentType: result.ContentType,
        etag: normalizeEtag(result.ETag),
        size: result.ContentLength ?? body.byteLength,
        lastModified: toEpochMs(result.LastModified),
        metadata: result.Metadata,
      };
    },

    async headObject({ key }): Promise<S3HeadObjectOutput | null> {
      let result: AwsResult;
      try {
        result = await send(new sdk.HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (isNotFound(error)) {
          return null;
        }
        throw error;
      }
      return {
        contentType: result.ContentType,
        etag: normalizeEtag(result.ETag),
        size: result.ContentLength,
        lastModified: toEpochMs(result.LastModified),
        metadata: result.Metadata,
      };
    },

    async deleteObject({ key }): Promise<void> {
      await send(new sdk.DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async listObjects({ prefix, limit, cursor, delimiter }): Promise<readonly S3ListItem[]> {
      const result = await send(
        new sdk.ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          MaxKeys: limit,
          ContinuationToken: cursor,
          Delimiter: delimiter === true ? "/" : undefined,
        }),
      );
      const contents = result.Contents ?? [];
      return contents.map((entry: AwsListEntry): S3ListItem => ({
        key: entry.Key ?? "",
        size: entry.Size ?? 0,
        updatedAt: toEpochMs(entry.LastModified) ?? 0,
      }));
    },

    async createMultipartUpload({ key, contentType, metadata }): Promise<{ readonly uploadId: string }> {
      const result = await send(
        new sdk.CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
      if (typeof result.UploadId !== "string") {
        throw new StorageConfigError("Backblaze B2 did not return an upload id for the multipart upload.", {
          provider: BACKBLAZE_DRIVER_NAME,
        });
      }
      return { uploadId: result.UploadId };
    },

    async uploadPart({ key, uploadId, partNumber, body }): Promise<{ readonly etag: string }> {
      const result = await send(
        new sdk.UploadPartCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
        }),
      );
      return { etag: normalizeEtag(result.ETag) };
    },

    async completeMultipartUpload({ key, uploadId, parts }): Promise<{ readonly etag: string }> {
      const result = await send(
        new sdk.CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })),
          },
        }),
      );
      return { etag: normalizeEtag(result.ETag) };
    },

    async abortMultipartUpload({ key, uploadId }): Promise<void> {
      await send(
        new sdk.AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
      );
    },
  };
}

// ── SDK-shaped structural types (no dependency on the SDK's own type surface) ──

/**
 * The minimal structural shape of `@aws-sdk/client-s3` used here. Declared
 * locally so this module never depends on the SDK's published types (which are
 * an optional peer, possibly absent at build time).
 */
interface BackblazeS3Sdk {
  readonly S3Client: new (config: unknown) => { send(command: unknown): Promise<unknown> };
  readonly PutObjectCommand: new (input: unknown) => unknown;
  readonly GetObjectCommand: new (input: unknown) => unknown;
  readonly HeadObjectCommand: new (input: unknown) => unknown;
  readonly DeleteObjectCommand: new (input: unknown) => unknown;
  readonly ListObjectsV2Command: new (input: unknown) => unknown;
  readonly CreateMultipartUploadCommand: new (input: unknown) => unknown;
  readonly UploadPartCommand: new (input: unknown) => unknown;
  readonly CompleteMultipartUploadCommand: new (input: unknown) => unknown;
  readonly AbortMultipartUploadCommand: new (input: unknown) => unknown;
}

/** A single entry from a `ListObjectsV2` response. */
interface AwsListEntry {
  readonly Key?: string;
  readonly Size?: number;
  readonly LastModified?: Date | number;
}

/** The subset of AWS SDK command outputs consumed by the adapter above. */
interface AwsResult {
  readonly ETag?: string;
  readonly ContentType?: string;
  readonly ContentLength?: number;
  readonly LastModified?: Date | number;
  readonly Metadata?: Record<string, string>;
  readonly Body?: unknown;
  readonly Contents?: readonly AwsListEntry[];
  readonly UploadId?: string;
}

// ── Adapter utilities ───────────────────────────────────────────────────────

/** Strip the surrounding quotes S3 wraps around ETags; tolerate an absent value. */
function normalizeEtag(etag: string | undefined): string {
  if (typeof etag !== "string") {
    return "";
  }
  return etag.replace(/^"|"$/g, "");
}

/** Coerce an S3 `LastModified` (Date or epoch ms) into epoch ms, if present. */
function toEpochMs(value: Date | number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  return value instanceof Date ? value.getTime() : value;
}

/** `true` when an AWS SDK error represents a missing key (404 / NoSuchKey / NotFound). */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const err = error as { name?: unknown; $metadata?: { httpStatusCode?: unknown } };
  if (err.name === "NoSuchKey" || err.name === "NotFound") {
    return true;
  }
  return err.$metadata?.httpStatusCode === 404;
}

/**
 * Collect an AWS SDK response body (a streaming blob) into a `Uint8Array`,
 * supporting the SDK's `transformToByteArray()` helper as well as Node streams
 * and already-buffered values.
 */
async function collectBody(body: unknown): Promise<Uint8Array> {
  if (body === undefined || body === null) {
    return new Uint8Array(0);
  }
  const maybe = body as {
    transformToByteArray?: () => Promise<Uint8Array>;
    [Symbol.asyncIterator]?: () => AsyncIterator<unknown>;
  };
  if (typeof maybe.transformToByteArray === "function") {
    return maybe.transformToByteArray();
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  if (typeof maybe[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<unknown>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    return new Uint8Array(Buffer.concat(chunks));
  }
  return new Uint8Array(Buffer.from(body as Uint8Array));
}
