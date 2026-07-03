/**
 * @streetjs/storage — the resumable upload manager.
 *
 * A {@link Resumable_Upload} is an upload session that can be interrupted and
 * continued from the last persisted byte offset without restarting from the
 * beginning (Requirement 7). {@link ResumableManager} provides this capability
 * in a **provider-agnostic** way, mirroring {@link MultipartManager}:
 *
 * - When the backing {@link StorageDriver} implements the optional native
 *   `resumable` capability, the manager delegates to the driver so a provider
 *   with first-class resumable support (e.g. GCS resumable uploads) is used
 *   directly.
 * - Otherwise the manager **simulates** resumable sessions over the mandatory
 *   driver primitives (`put`/`get`/`delete`). The accumulated bytes for a
 *   session are persisted under a reserved key derived from the session id
 *   (mirroring the design's `.resumable/<sessionId>` layout), and the persisted
 *   byte offset is simply the length of that accumulated content.
 *
 * Semantics (Requirement 7):
 * - {@link ResumableManager.start} creates a session and returns a session id
 *   (Requirement 7.1); the persisted offset begins at zero.
 * - {@link ResumableManager.resume} continues the upload from the last persisted
 *   offset (Requirement 7.2). The supplied stream carries the object's **full**
 *   intended content from offset zero; the manager appends only the portion of
 *   the stream that lies beyond the already-persisted offset and skips the bytes
 *   it already holds. Because the final object is exactly the full stream
 *   content regardless of how many times the upload was interrupted and resumed,
 *   completion yields an object byte-identical to an equivalent uninterrupted
 *   upload (Requirement 7.3).
 * - {@link ResumableManager.cancel} discards the session and its persisted data,
 *   creating no object (Requirement 7.4) — **unless** the session is already
 *   completing (its stream has been fully consumed and the final object is being
 *   written), in which case the cancel is ignored and the upload is allowed to
 *   finish and create the object (Requirement 7.5).
 *
 * The module depends only on the driver contract, the shared type surface, the
 * error hierarchy, and the metadata layer, keeping the dependency direction
 * acyclic.
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
 */

import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { NodeReadable, ResumableCapability, StorageDriver } from "./driver.js";
import { StorageError } from "./errors.js";
import { normalizeMetadata } from "./metadata.js";
import type { StorageObjectMetadata, WriteMetadata } from "./types.js";

/**
 * Reserved key prefix under which a simulated session's accumulated bytes are
 * persisted via the driver primitives. Session content lives at
 * `${SESSION_KEY_PREFIX}<sessionId>` and is removed on completion/cancel, so it
 * never remains visible after a resumable upload finalizes.
 */
const SESSION_KEY_PREFIX = ".resumable/";

/** Write metadata used when persisting a session's (transient) accumulated bytes. */
const SESSION_WRITE_METADATA: WriteMetadata = { contentType: "application/octet-stream" };

/**
 * State tracked for a single in-progress **simulated** resumable upload. The
 * target `key` and its write-time `metadata` are captured at `start` time so the
 * final object is written with the intended metadata. The persisted byte offset
 * is not stored here — it is derived from the length of the accumulated content
 * held under the reserved driver key, keeping a single source of truth for how
 * many bytes are persisted.
 *
 * `completing` becomes true once the resume stream has been fully consumed and
 * the manager has begun writing the final object; from that point a concurrent
 * {@link ResumableManager.cancel} is ignored so the upload finishes
 * (Requirement 7.5). `cancelled` is set when a cancel arrives before completion
 * so an in-progress resume aborts without creating an object (Requirement 7.4).
 *
 * Native-capability drivers manage their own session state, so this is only
 * populated when simulating.
 */
interface ResumableSession {
  readonly key: string;
  readonly metadata: WriteMetadata;
  completing: boolean;
  cancelled: boolean;
}

/**
 * Provider-agnostic resumable upload manager built on the driver contract.
 *
 * A single instance is held by the facade and bound to one {@link StorageDriver}
 * for its lifetime, so the native-vs-simulated decision (based on whether the
 * driver exposes a `resumable` capability) is stable across every call for a
 * given session id.
 */
export class ResumableManager {
  /** The driver every operation is delegated to or simulated over. */
  private readonly driver: StorageDriver;

  /**
   * In-progress simulated sessions keyed by session id. Empty when the driver
   * provides a native `resumable` capability (that path keeps no local state).
   */
  private readonly sessions = new Map<string, ResumableSession>();

  constructor(driver: StorageDriver) {
    this.driver = driver;
  }

  /** The driver's native resumable capability, when present. */
  private get native(): ResumableCapability | undefined {
    return this.driver.resumable;
  }

  /**
   * Create a resumable upload session for `key` and return its session id
   * (Requirement 7.1). When the driver has a native capability the driver mints
   * the id and initializes the offset; otherwise a fresh id is generated and a
   * local session records the target key and its write-time metadata. No
   * reserved key is written yet — the persisted offset is zero until the first
   * `resume` appends content.
   */
  async start(key: string, metadata: WriteMetadata): Promise<string> {
    if (this.native !== undefined) {
      return this.native.start(key, metadata);
    }
    const sessionId = randomUUID();
    this.sessions.set(sessionId, { key, metadata, completing: false, cancelled: false });
    return sessionId;
  }

  /**
   * Continue the upload for `sessionId` from the last persisted offset and, on
   * completion, create the final object and return its metadata (Requirements
   * 7.2, 7.3).
   *
   * `stream` carries the object's full intended content from offset zero. The
   * manager appends only the bytes lying beyond the already-persisted offset —
   * bytes it already holds are skipped — so the final object equals the full
   * stream content and is byte-identical to an equivalent uninterrupted upload
   * regardless of how many prior interruptions occurred.
   *
   * Once the stream is fully consumed the session enters its completing phase;
   * from that point a concurrent {@link cancel} is ignored so the object is
   * still created (Requirement 7.5). If a cancel arrives *before* completion,
   * the in-progress resume aborts and creates no object (Requirement 7.4).
   */
  async resume(sessionId: string, stream: NodeReadable): Promise<StorageObjectMetadata> {
    if (this.native !== undefined) {
      return this.resumeNative(this.native, sessionId, stream);
    }

    const session = this.requireSession(sessionId);
    const reservedKey = this.sessionKey(sessionId);

    // The persisted content (and therefore the offset) is the single source of
    // truth for how many bytes have already been stored for this session.
    let persisted = await this.readPersisted(reservedKey);
    let seen = 0;

    for await (const chunk of stream) {
      // A cancel that arrived before completion aborts the resume and leaves no
      // final object (Requirement 7.4); the reserved data has already been
      // discarded by cancel, but delete again defensively in case this resume
      // wrote after the cancel began.
      if (session.cancelled) {
        await this.driver.delete(reservedKey);
        throw new StorageError(
          `Resumable upload session "${sessionId}" was cancelled during resume.`,
        );
      }

      const buf = toBuffer(chunk);
      const chunkEnd = seen + buf.byteLength;

      // Append only the portion of this chunk that lies beyond the persisted
      // offset; bytes at positions already persisted are skipped.
      if (chunkEnd > persisted.byteLength) {
        const skip = Math.max(0, persisted.byteLength - seen);
        const toAppend = buf.subarray(skip);
        persisted = Buffer.concat([persisted, toAppend]);
        await this.driver.put(reservedKey, new Uint8Array(persisted), SESSION_WRITE_METADATA);
      }
      seen = chunkEnd;
    }

    // Completion phase: from here the upload is committing, so a concurrent
    // cancel is ignored and the object is still created (Requirement 7.5).
    session.completing = true;
    const metadata = await this.driver.put(
      session.key,
      new Uint8Array(persisted),
      session.metadata,
    );
    await this.driver.delete(reservedKey);
    this.sessions.delete(sessionId);

    return normalizeMetadata(metadata);
  }

  /**
   * Discard the session `sessionId` and its persisted data, creating no object
   * (Requirement 7.4). If the session is already completing — its stream has
   * been fully consumed and the final object is being written — the cancel is
   * ignored so the upload finishes and creates the object (Requirement 7.5). An
   * unknown/already-finalized session id is treated as an idempotent no-op.
   */
  async cancel(sessionId: string): Promise<void> {
    if (this.native !== undefined) {
      await this.native.cancel(sessionId);
      return;
    }

    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      return;
    }
    // Already committing — let the in-flight resume finish and create the object.
    if (session.completing) {
      return;
    }

    session.cancelled = true;
    await this.driver.delete(this.sessionKey(sessionId));
    this.sessions.delete(sessionId);
  }

  /**
   * Native-capability resume: drive the driver's `offset`/`append`/`finish`
   * primitives. As in the simulated path, `stream` carries the full content and
   * only the portion beyond the driver's reported offset is appended, so the
   * finished object is byte-identical to an uninterrupted upload.
   */
  private async resumeNative(
    native: ResumableCapability,
    sessionId: string,
    stream: NodeReadable,
  ): Promise<StorageObjectMetadata> {
    let offset = await native.offset(sessionId);
    let seen = 0;

    for await (const chunk of stream) {
      const buf = toBuffer(chunk);
      const chunkEnd = seen + buf.byteLength;
      if (chunkEnd > offset) {
        const skip = Math.max(0, offset - seen);
        const toAppend = buf.subarray(skip);
        offset = await native.append(sessionId, new Uint8Array(toAppend), offset);
      }
      seen = chunkEnd;
    }

    return normalizeMetadata(await native.finish(sessionId));
  }

  /**
   * Read the accumulated bytes persisted for a simulated session, returning an
   * empty buffer when nothing has been persisted yet (offset zero).
   */
  private async readPersisted(reservedKey: string): Promise<Buffer> {
    const result = await this.driver.get(reservedKey);
    return result.found ? Buffer.from(result.bytes) : Buffer.alloc(0);
  }

  /** The reserved driver key a simulated session's accumulated bytes live under. */
  private sessionKey(sessionId: string): string {
    return `${SESSION_KEY_PREFIX}${sessionId}`;
  }

  /**
   * Resolve the simulated session for `sessionId`, throwing a descriptive
   * {@link StorageError} when the id is unknown or the session has already been
   * finalized or cancelled.
   */
  private requireSession(sessionId: string): ResumableSession {
    const session = this.sessions.get(sessionId);
    if (session === undefined) {
      throw new StorageError(
        `Unknown or already-finalized resumable upload session "${sessionId}".`,
      );
    }
    return session;
  }
}

/** Normalize a stream chunk to a `Buffer` without copying when already one. */
function toBuffer(chunk: unknown): Buffer {
  return Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
}
