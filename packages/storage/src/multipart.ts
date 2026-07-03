/**
 * @streetjs/storage — the multipart upload manager.
 *
 * A {@link Multipart_Upload} splits a large object into independently uploaded
 * parts that are later assembled into a single object whose content equals the
 * concatenation of those parts in order (Requirement 6). {@link MultipartManager}
 * provides this capability in a **provider-agnostic** way:
 *
 * - When the backing {@link StorageDriver} implements the optional native
 *   `multipart` capability, the manager delegates each operation to the driver
 *   so a provider that has first-class multipart support (e.g. S3) is used
 *   directly.
 * - Otherwise the manager **simulates** multipart over the mandatory driver
 *   primitives (`put`/`get`/`putStream`/`delete`). Each `uploadPart` persists
 *   the part bytes under a reserved key derived from `(uploadId, partNumber)`
 *   (mirroring the design's `.multipart/<uploadId>/<partNumber>` layout), and
 *   `complete` streams the persisted parts back in the supplied order into the
 *   final object. Because completion assembles the object by reading one part at
 *   a time into a `Readable` and piping it through `driver.putStream`, the whole
 *   object is never required to be materialized in a single buffer by this
 *   layer — the design streams the concatenation and therefore imposes **no
 *   artificial size cap** (objects of a gigabyte or more are supported,
 *   Requirement 6.5).
 *
 * Semantics (Requirement 6):
 * - {@link MultipartManager.create} mints and returns an upload identifier.
 * - {@link MultipartManager.uploadPart} persists a part keyed by
 *   `(uploadId, partNumber)` and returns a {@link StoredPart} descriptor.
 * - {@link MultipartManager.complete} concatenates the parts in the supplied
 *   order into the final object — equivalent to a single `put` of the
 *   concatenation — and returns the resulting metadata.
 * - {@link MultipartManager.abort} discards every persisted part and creates no
 *   object.
 *
 * The module depends only on the driver contract, the shared type surface, the
 * error hierarchy, and the metadata layer, keeping the dependency direction
 * acyclic.
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_
 */

import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";

import type { MultipartCapability, StorageDriver, StoredPart } from "./driver.js";
import { NotFoundError, StorageError } from "./errors.js";
import { normalizeMetadata } from "./metadata.js";
import type { StorageObjectMetadata, WriteMetadata } from "./types.js";

/**
 * Reserved key prefix under which simulated multipart parts are persisted via
 * the driver primitives. Parts live at `${PART_KEY_PREFIX}<uploadId>/<partNumber>`
 * and are removed on `complete`/`abort`, so they never remain visible after a
 * multipart upload finalizes.
 */
const PART_KEY_PREFIX = ".multipart/";

/** Write metadata used when persisting an individual (transient) part. */
const PART_WRITE_METADATA: WriteMetadata = { contentType: "application/octet-stream" };

/**
 * State tracked for a single in-progress **simulated** multipart upload. The
 * target `key` and its write-time `metadata` are captured at `create` time so
 * the final assembled object is written with the intended metadata; the set of
 * uploaded `partNumbers` is tracked so every persisted part can be discarded on
 * `complete` or `abort` regardless of the ordering supplied at completion.
 *
 * Native-capability drivers manage their own session state, so this is only
 * populated when simulating.
 */
interface MultipartSession {
  readonly key: string;
  readonly metadata: WriteMetadata;
  readonly partNumbers: Set<number>;
}

/**
 * Provider-agnostic multipart upload manager built on the driver contract.
 *
 * A single instance is held by the facade and bound to one {@link StorageDriver}
 * for its lifetime, so the native-vs-simulated decision (based on whether the
 * driver exposes a `multipart` capability) is stable across every call for a
 * given upload identifier.
 */
export class MultipartManager {
  /** The driver every operation is delegated to or simulated over. */
  private readonly driver: StorageDriver;

  /**
   * In-progress simulated sessions keyed by upload id. Empty when the driver
   * provides a native `multipart` capability (that path keeps no local state).
   */
  private readonly sessions = new Map<string, MultipartSession>();

  constructor(driver: StorageDriver) {
    this.driver = driver;
  }

  /** The driver's native multipart capability, when present. */
  private get native(): MultipartCapability | undefined {
    return this.driver.multipart;
  }

  /**
   * Begin a multipart upload for `key` and return its upload identifier
   * (Requirement 6.1). When the driver has a native capability the driver mints
   * the id; otherwise a fresh id is generated and a local session records the
   * target key and its write-time metadata for assembly at completion.
   */
  async create(key: string, metadata: WriteMetadata): Promise<string> {
    if (this.native !== undefined) {
      return this.native.create(key, metadata);
    }
    const uploadId = randomUUID();
    this.sessions.set(uploadId, { key, metadata, partNumbers: new Set<number>() });
    return uploadId;
  }

  /**
   * Persist a single part for `uploadId` and return its {@link StoredPart}
   * descriptor (Requirement 6.2). The part bytes are copied defensively before
   * persistence so later mutation of the caller's buffer cannot corrupt a stored
   * part. The returned `etag` is the sha-256 hex digest of the part bytes,
   * matching the checksum scheme the drivers use elsewhere.
   */
  async uploadPart(
    uploadId: string,
    partNumber: number,
    bytes: Uint8Array,
  ): Promise<StoredPart> {
    if (this.native !== undefined) {
      return this.native.uploadPart(uploadId, partNumber, bytes);
    }
    const session = this.requireSession(uploadId);
    assertValidPartNumber(partNumber);

    const stored = bytes.slice();
    await this.driver.put(this.partKey(uploadId, partNumber), stored, PART_WRITE_METADATA);
    session.partNumbers.add(partNumber);

    return { partNumber, etag: sha256Hex(stored), size: stored.byteLength };
  }

  /**
   * Assemble the supplied `parts` in order into the final object and return its
   * metadata (Requirement 6.3). The assembled content equals the concatenation
   * of the parts in the given order — equivalent to a single `put` of that
   * concatenation.
   *
   * For the simulated path the parts are streamed back one at a time from the
   * driver into a `Readable` piped through `driver.putStream`, so this layer
   * never buffers the full object at once (Requirement 6.5). Every persisted
   * part (whether or not it appears in `parts`) is discarded afterward and the
   * session is closed.
   */
  async complete(uploadId: string, parts: readonly StoredPart[]): Promise<StorageObjectMetadata> {
    if (this.native !== undefined) {
      return normalizeMetadata(await this.native.complete(uploadId, parts));
    }
    const session = this.requireSession(uploadId);
    const driver = this.driver;
    const partKey = (partNumber: number): string => this.partKey(uploadId, partNumber);

    // Stream the parts in the supplied order so the concatenation is assembled
    // incrementally rather than materialized in a single buffer here.
    async function* assembleParts(): AsyncGenerator<Buffer> {
      for (const part of parts) {
        const result = await driver.get(partKey(part.partNumber));
        if (!result.found) {
          throw new NotFoundError(
            partKey(part.partNumber),
            `Multipart part ${part.partNumber} for upload "${uploadId}" was not found.`,
          );
        }
        yield Buffer.from(result.bytes);
      }
    }

    const metadata = await driver.putStream(
      session.key,
      Readable.from(assembleParts()),
      session.metadata,
    );

    await this.discardParts(uploadId, session.partNumbers);
    this.sessions.delete(uploadId);

    return normalizeMetadata(metadata);
  }

  /**
   * Discard every persisted part for `uploadId` and create no completed object
   * (Requirement 6.4). Delegates to the native capability when present; for the
   * simulated path it deletes all recorded part keys and closes the session. An
   * unknown/already-finalized upload id is treated as an idempotent no-op.
   */
  async abort(uploadId: string): Promise<void> {
    if (this.native !== undefined) {
      await this.native.abort(uploadId);
      return;
    }
    const session = this.sessions.get(uploadId);
    if (session === undefined) {
      return;
    }
    await this.discardParts(uploadId, session.partNumbers);
    this.sessions.delete(uploadId);
  }

  /** Delete every persisted part for a simulated upload id. */
  private async discardParts(uploadId: string, partNumbers: Iterable<number>): Promise<void> {
    for (const partNumber of partNumbers) {
      await this.driver.delete(this.partKey(uploadId, partNumber));
    }
  }

  /** The reserved driver key a simulated part is persisted under. */
  private partKey(uploadId: string, partNumber: number): string {
    return `${PART_KEY_PREFIX}${uploadId}/${partNumber}`;
  }

  /**
   * Resolve the simulated session for `uploadId`, throwing a descriptive
   * {@link StorageError} when the id is unknown or the upload has already been
   * finalized.
   */
  private requireSession(uploadId: string): MultipartSession {
    const session = this.sessions.get(uploadId);
    if (session === undefined) {
      throw new StorageError(
        `Unknown or already-finalized multipart upload id "${uploadId}".`,
      );
    }
    return session;
  }
}

/** Compute the lowercase sha-256 hex digest of `bytes`. */
function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Guard that a part number is a positive integer. Part numbers identify the
 * ordinal position of a part and must be well-formed for the reserved part key
 * to be stable and for ordering to be meaningful.
 */
function assertValidPartNumber(partNumber: number): void {
  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new StorageError(
      `Invalid multipart part number ${partNumber}; expected a positive integer.`,
    );
  }
}
