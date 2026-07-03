/**
 * @streetjs/storage — the Image Processor over a structural codec (task 19.1).
 *
 * The Image Processor generates transformed / reformatted variants of stored
 * image objects. Application code reaches it as `storage.images` and calls
 * {@link ImageProcessor.transform | transform(key, operations)}. All actual
 * pixel work is delegated to the optional, structural {@link ImageCodec}
 * supplied as `config.imageCodec`; this module owns only the provider-agnostic
 * orchestration:
 *
 * - **Source resolution & guarding.** The source object is read through the
 *   driver. A missing object raises {@link NotFoundError}. A source whose
 *   content type is not an image raises {@link UnsupportedImageError}, and — as
 *   Requirement 14.4 requires — the source object is never modified: the guard
 *   runs before any codec call or any write, and the derived variant is always
 *   written to a distinct reserved key, so the source bytes are left untouched
 *   regardless of whether processing would otherwise succeed.
 * - **Transformations (Requirement 14.1).** `resize`, `crop`, `rotate`, `fit`,
 *   `thumbnail`, and `compress` are assembled into a single codec operation and
 *   performed THROUGH the injected {@link ImageCodec}. `thumbnail` additionally
 *   projects onto a square `resize` so minimal codecs that only understand
 *   `resize` still produce a thumbnail.
 * - **Format conversion (Requirement 14.2).** Output in `webp`, `avif`, `png`,
 *   or `jpeg` is selected via `operations.format` (defaulting to the source's
 *   own format); any other requested output format raises
 *   {@link UnsupportedImageError}.
 * - **Caching (Requirement 14.3).** Identical requests — the same source object
 *   (keyed by its content checksum) with the same transformation parameters —
 *   return a cached result without re-invoking the codec or re-writing the
 *   variant.
 *
 * The public {@link ImageProcessor}/{@link ImageOperations} types are owned by
 * `facade.ts` (and re-exported from `index.ts`); they are imported here
 * type-only so there is no runtime import cycle between the two modules, exactly
 * as `directory.ts` relates to `facade.ts`.
 *
 * _Requirements: 14.1, 14.2, 14.3, 14.4_
 */

import { createHash } from "node:crypto";

import type { StorageDriver } from "./driver.js";
import { NotFoundError, StorageError, UnsupportedImageError } from "./errors.js";
import type { ImageFormat, ImageOperations, ImageProcessor } from "./facade.js";
import { normalizeMetadata } from "./metadata.js";
import type { ImageCodec, StorageObjectMetadata } from "./types.js";

/** Reserved key prefix under which derived image variants are written. */
export const IMAGE_VARIANT_PREFIX = ".image-variants/";

/** The output formats the processor can emit (Requirement 14.2). */
const SUPPORTED_OUTPUT_FORMATS: ReadonlySet<ImageFormat> = new Set<ImageFormat>([
  "webp",
  "avif",
  "png",
  "jpeg",
]);

/**
 * The richer codec operation this module builds from {@link ImageOperations}.
 * It is a structural superset of the minimal {@link ImageCodec} operation shape
 * (which declares only `resize`/`format`/`quality`), so a value of this type is
 * assignable to `ImageCodec.transform`'s parameter while still carrying the
 * additional transformation fields for codecs that understand them. Extending
 * the codec operation here — rather than widening the shared {@link ImageCodec}
 * contract — keeps the exported structural type stable.
 */
interface CodecOperation {
  resize?: { readonly width?: number; readonly height?: number };
  crop?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  rotate?: number;
  fit?: { readonly width: number; readonly height: number; readonly mode?: string };
  thumbnail?: { readonly size: number };
  compress?: { readonly quality: number };
  format?: string;
  quality?: number;
}

/**
 * Map a source object content type onto one of the supported output
 * {@link ImageFormat}s, used as the default output format when a transform does
 * not request an explicit `format`. Returns `undefined` when the source content
 * type is not an image (the caller turns that into an
 * {@link UnsupportedImageError}).
 */
function contentTypeToFormat(contentType: string): ImageFormat | undefined {
  const lower = contentType.toLowerCase();
  if (!lower.startsWith("image/")) {
    return undefined;
  }
  const subtype = lower.slice("image/".length).split(";")[0]?.trim() ?? "";
  switch (subtype) {
    case "jpeg":
    case "jpg":
      return "jpeg";
    case "png":
      return "png";
    case "webp":
      return "webp";
    case "avif":
      return "avif";
    default:
      // A recognised image content type we do not emit natively still counts as
      // an image source; default its output to png so conversion is possible.
      return "png";
  }
}

/**
 * A concrete {@link ImageProcessor} over any {@link StorageDriver}, delegating
 * pixel work to the injected structural {@link ImageCodec}. It holds the driver,
 * the optional codec, and an in-memory cache of previously produced variant
 * metadata keyed by `(source key, source checksum, operation signature)` so an
 * identical repeated request is served from cache (Requirement 14.3).
 */
export class StorageImageProcessor implements ImageProcessor {
  private readonly driver: StorageDriver;
  private readonly codec?: ImageCodec;

  /** Cache of produced variant metadata, keyed by the transform signature. */
  private readonly cache = new Map<string, StorageObjectMetadata>();

  constructor(driver: StorageDriver, codec?: ImageCodec) {
    this.driver = driver;
    this.codec = codec;
  }

  /**
   * Produce a transformed / reformatted variant of the image stored at `key`
   * and return the variant's {@link StorageObjectMetadata}.
   *
   * The source object is read first and guarded: a missing object throws
   * {@link NotFoundError}; a non-image source throws {@link UnsupportedImageError}
   * before any codec call or write, so the source object is never modified
   * (Requirement 14.4). Supported transformations (resize/crop/rotate/fit/
   * thumbnail/compress — Requirement 14.1) and output formats (webp/avif/png/
   * jpeg — Requirement 14.2) are performed through the injected codec. An
   * identical prior request (same source content + same parameters) is served
   * from the in-memory cache without re-invoking the codec (Requirement 14.3).
   */
  async transform(key: string, operations: ImageOperations): Promise<StorageObjectMetadata> {
    // 1. Resolve the source. A missing object has no image to process.
    const source = await this.driver.get(key);
    if (!source.found) {
      throw new NotFoundError(key, `Cannot transform image "${key}": object not found.`);
    }

    // 2. Guard: the source must be a supported image. This runs before any
    //    codec call and before any write, and the variant is written to a
    //    distinct reserved key, so the source object is never modified
    //    regardless of the requested operations (Requirement 14.4).
    const sourceFormat = contentTypeToFormat(source.metadata.contentType);
    if (sourceFormat === undefined) {
      throw new UnsupportedImageError(
        `Cannot transform "${key}": content type "${source.metadata.contentType}" is not a ` +
          `supported image format.`,
        { format: source.metadata.contentType, key },
      );
    }

    // 3. Resolve the output format (Requirement 14.2). An explicit, unsupported
    //    output format is rejected without modifying the source.
    const outputFormat = operations.format ?? sourceFormat;
    if (!SUPPORTED_OUTPUT_FORMATS.has(outputFormat)) {
      throw new UnsupportedImageError(
        `Cannot transform "${key}": output format "${String(operations.format)}" is not ` +
          `supported. Supported output formats: webp, avif, png, jpeg.`,
        { format: String(operations.format), key },
      );
    }

    // 4. Cache lookup keyed by source identity + operation signature so an
    //    identical repeated request returns the cached variant without touching
    //    the codec or the store again (Requirement 14.3).
    const signature = this.signature(key, source.metadata.checksum, operations, outputFormat);
    const cached = this.cache.get(signature);
    if (cached !== undefined) {
      return cached;
    }

    // 5. A codec is required to perform the pixel work.
    if (this.codec === undefined) {
      throw new StorageError(
        `Cannot transform image "${key}": no image codec is configured. Provide ` +
          `"imageCodec" in the storage configuration to enable image processing.`,
      );
    }

    // 6. Perform the transformation THROUGH the injected structural codec
    //    (Requirement 14.1). The derived bytes are written to a distinct
    //    reserved variant key, never back over the source.
    const codecOperation = this.toCodecOperation(operations, outputFormat);
    const processed = await this.codec.transform(source.bytes, codecOperation);

    const variantKey = this.variantKey(key, signature, outputFormat);
    const metadata = normalizeMetadata(
      await this.driver.put(variantKey, processed, {
        contentType: `image/${outputFormat}`,
        owner: source.metadata.owner,
        tenant: source.metadata.tenant,
        accessLevel: source.metadata.accessLevel,
      }),
    );

    this.cache.set(signature, metadata);
    return metadata;
  }

  /**
   * Assemble the requested {@link ImageOperations} into a single
   * {@link CodecOperation}. `thumbnail` additionally projects onto a square
   * `resize` (unless `resize` is explicitly provided) so a minimal codec that
   * only understands `resize` still yields a thumbnail; `compress` supplies the
   * `quality` when an explicit `quality` is not set.
   */
  private toCodecOperation(operations: ImageOperations, outputFormat: ImageFormat): CodecOperation {
    const quality = operations.quality ?? operations.compress?.quality;
    const operation: CodecOperation = { format: outputFormat };

    if (operations.resize !== undefined) {
      operation.resize = operations.resize;
    } else if (operations.thumbnail !== undefined) {
      operation.resize = { width: operations.thumbnail.size, height: operations.thumbnail.size };
    }
    if (operations.crop !== undefined) {
      operation.crop = operations.crop;
    }
    if (operations.rotate !== undefined) {
      operation.rotate = operations.rotate;
    }
    if (operations.fit !== undefined) {
      operation.fit = operations.fit;
    }
    if (operations.thumbnail !== undefined) {
      operation.thumbnail = operations.thumbnail;
    }
    if (operations.compress !== undefined) {
      operation.compress = operations.compress;
    }
    if (quality !== undefined) {
      operation.quality = quality;
    }
    return operation;
  }

  /**
   * Build a stable signature for a transform request from the source key, the
   * source content checksum (so a changed source is a cache miss), the
   * normalized operations, and the resolved output format. Used both as the
   * cache key and to derive the variant's storage key.
   */
  private signature(
    key: string,
    checksum: string,
    operations: ImageOperations,
    outputFormat: ImageFormat,
  ): string {
    const canonical = JSON.stringify({
      resize: operations.resize ?? null,
      crop: operations.crop ?? null,
      rotate: operations.rotate ?? null,
      fit: operations.fit ?? null,
      thumbnail: operations.thumbnail ?? null,
      compress: operations.compress ?? null,
      quality: operations.quality ?? null,
      format: outputFormat,
    });
    return createHash("sha256").update(`${key}\u0000${checksum}\u0000${canonical}`).digest("hex");
  }

  /**
   * Derive the reserved storage key the variant is written under. It nests the
   * variant beneath {@link IMAGE_VARIANT_PREFIX} and the source key, keyed by
   * the transform signature so distinct transforms of the same source never
   * collide and the source object's own key is never targeted (Requirement 14.4).
   */
  private variantKey(key: string, signature: string, outputFormat: ImageFormat): string {
    return `${IMAGE_VARIANT_PREFIX}${key}/${signature.slice(0, 32)}.${outputFormat}`;
  }
}
