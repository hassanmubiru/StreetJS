/**
 * @streetjs/storage — the Queue integration bridge.
 *
 * This module hands heavy, out-of-band work off to a background queue so that
 * storage operations never block on it: thumbnail generation, virus scanning,
 * OCR, PDF processing, transcoding, image optimization, and archive creation
 * (Requirement 17.1). Each job is dispatched through the minimal
 * {@link QueueLike} shape declared in `types.ts` (any object exposing
 * `dispatch(job, payload)`), never through the concrete `@streetjs/queue`
 * package, so there is no hard dependency and no circular dependency
 * (Requirements 17.2, 28.3). {@link QueueLike} is re-exported here for
 * convenience; it is intentionally the single definition that lives in
 * `types.ts`.
 *
 * **Never throws into the operation path.** Every dispatch is wrapped so that a
 * synchronous throw or an asynchronous rejection from the underlying queue is
 * swallowed: a dispatch failure must never break the storage operation that
 * triggered it (Requirement 17.4). Equally, when no queue bridge is configured
 * the facade holds no publisher and job dispatch is a complete no-op — storage
 * operations proceed unaffected (Requirement 17.3). This mirrors the
 * graceful-degradation guarantee the Events and Realtime bridges also uphold.
 *
 * The facade constructs a {@link StorageQueuePublisher} via
 * {@link bridgeStorageQueue} only when `config.bridges?.queue` is provided.
 *
 * _Requirements: 17.1, 17.2, 17.3, 17.4, 28.3_
 */

import type { QueueLike } from "../types.js";

// Re-export the structural queue contract so consumers can import it from the
// integration module as well as from the package root. This is a re-export of
// the single definition in `types.ts`, never a competing declaration.
export type { QueueLike } from "../types.js";

/**
 * The exhaustive set of background job names the storage framework dispatches
 * (Requirement 17.1). Every heavy, out-of-band task maps onto exactly one of
 * these names.
 */
export type StorageJobName =
  | "storage.thumbnail"
  | "storage.virus-scan"
  | "storage.ocr"
  | "storage.pdf-process"
  | "storage.transcode"
  | "storage.image-optimize"
  | "storage.archive";

/**
 * The payload dispatched with every storage job. It always carries the affected
 * object `key` and, when the triggering operation has it in hand, arbitrary
 * job-specific `options` the worker uses to perform the task.
 */
export interface StorageJobPayload {
  /** The affected object key (always present). */
  readonly key: string;
  /** Job-specific options passed through to the worker (optional). */
  readonly options?: Record<string, unknown>;
}

/**
 * The publisher the facade holds and can call to hand heavy work to the queue.
 * Every method is fire-and-forget and guaranteed never to throw into the
 * caller: the underlying dispatch is isolated so a failing (or absent) queue
 * cannot break a storage operation (Requirements 17.3, 17.4).
 */
export interface StorageQueuePublisher {
  /**
   * Dispatch an already-named background job with the given payload. Never
   * throws. The typed convenience methods below are thin wrappers over this.
   */
  dispatch(job: StorageJobName, payload: StorageJobPayload): void;

  /** Dispatch a thumbnail-generation job for an object. */
  thumbnail(key: string, options?: Record<string, unknown>): void;

  /** Dispatch a virus-scan job for an object. */
  virusScan(key: string, options?: Record<string, unknown>): void;

  /** Dispatch an OCR (text-extraction) job for an object. */
  ocr(key: string, options?: Record<string, unknown>): void;

  /** Dispatch a PDF-processing job for an object. */
  pdfProcess(key: string, options?: Record<string, unknown>): void;

  /** Dispatch a media-transcoding job for an object. */
  transcode(key: string, options?: Record<string, unknown>): void;

  /** Dispatch an image-optimization job for an object. */
  imageOptimize(key: string, options?: Record<string, unknown>): void;

  /** Dispatch an archive-creation job for an object. */
  archive(key: string, options?: Record<string, unknown>): void;
}

/**
 * Isolate a single dispatch call. A synchronous throw is caught; a returned
 * promise has its rejection swallowed. Either way nothing propagates back to the
 * storage operation that triggered the job, satisfying the "never throw into the
 * operation path" guarantee (Requirement 17.4).
 */
function safeDispatch(queue: QueueLike, job: StorageJobName, payload: StorageJobPayload): void {
  try {
    const result = queue.dispatch(job, payload);
    if (result !== undefined && result !== null && typeof (result as Promise<void>).then === "function") {
      // Fire-and-forget: absorb any asynchronous rejection.
      (result as Promise<void>).then(undefined, () => {
        /* swallow — a dispatch failure must not break the storage op */
      });
    }
  } catch {
    // swallow — a dispatch failure must not break the storage op
  }
}

/**
 * Create a {@link StorageQueuePublisher} that dispatches background jobs through
 * the supplied structural {@link QueueLike} bridge.
 *
 * The returned publisher is what the facade wires into any heavy, out-of-band
 * work (thumbnail generation, virus scanning, OCR, PDF processing, transcoding,
 * image optimization, archive creation). Every method is guaranteed never to
 * throw into the caller.
 *
 * ```ts
 * const publisher = bridgeStorageQueue(queue);
 * publisher.thumbnail("photo.png"); // dispatches "storage.thumbnail" — never throws
 * ```
 */
export function bridgeStorageQueue(queue: QueueLike): StorageQueuePublisher {
  const dispatch = (job: StorageJobName, payload: StorageJobPayload): void => {
    safeDispatch(queue, job, payload);
  };

  return {
    dispatch,
    thumbnail(key, options) {
      dispatch("storage.thumbnail", { key, options });
    },
    virusScan(key, options) {
      dispatch("storage.virus-scan", { key, options });
    },
    ocr(key, options) {
      dispatch("storage.ocr", { key, options });
    },
    pdfProcess(key, options) {
      dispatch("storage.pdf-process", { key, options });
    },
    transcode(key, options) {
      dispatch("storage.transcode", { key, options });
    },
    imageOptimize(key, options) {
      dispatch("storage.image-optimize", { key, options });
    },
    archive(key, options) {
      dispatch("storage.archive", { key, options });
    },
  };
}
