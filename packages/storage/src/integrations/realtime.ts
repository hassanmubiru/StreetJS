/**
 * @streetjs/storage — the Realtime integration bridge.
 *
 * This module broadcasts live upload-lifecycle events — `upload.started`,
 * `upload.progress`, `upload.completed`, `upload.failed` — as an upload changes
 * state, so connected clients can display live progress (Requirement 19.1).
 * Each broadcast goes out through the minimal {@link RealtimeLike} shape
 * declared in `types.ts` (any object exposing
 * `broadcast(channel, event, payload)`), never through the concrete
 * `@streetjs/realtime` package, so there is no hard dependency and no circular
 * dependency (Requirements 19.2, 28.3). {@link RealtimeLike} is re-exported here
 * for convenience; it is intentionally the single definition that lives in
 * `types.ts`.
 *
 * **Never throws into the operation path.** Every broadcast is wrapped so that a
 * synchronous throw or an asynchronous rejection from the underlying realtime
 * layer is swallowed: a broadcast failure must never break the upload that
 * triggered it (Requirement 19.3). Equally, when no realtime bridge is
 * configured the facade holds no publisher and broadcasting is a complete no-op
 * — uploads proceed unaffected (Requirement 19.3). This mirrors the
 * graceful-degradation guarantee the Events and Queue bridges also uphold.
 *
 * The facade constructs a {@link StorageRealtimePublisher} via
 * {@link bridgeStorageRealtime} only when `config.bridges?.realtime` is
 * provided.
 *
 * _Requirements: 19.1, 19.2, 19.3, 28.3_
 */

import type { RealtimeLike } from "../types.js";

// Re-export the structural realtime contract so consumers can import it from the
// integration module as well as from the package root. This is a re-export of
// the single definition in `types.ts`, never a competing declaration.
export type { RealtimeLike } from "../types.js";

/**
 * The channel every upload-lifecycle event is broadcast on. A single channel
 * keeps the client subscription surface simple; the typed
 * {@link StorageRealtimeEventName} distinguishes the state transitions, and the
 * payload's `key` distinguishes the upload.
 */
export const STORAGE_UPLOAD_CHANNEL = "storage.uploads" as const;

/**
 * The exhaustive set of upload-lifecycle event names the storage framework
 * broadcasts (Requirement 19.1). Every upload state transition maps onto
 * exactly one of these names.
 */
export type StorageRealtimeEventName =
  | "upload.started"
  | "upload.progress"
  | "upload.completed"
  | "upload.failed";

/**
 * The payload broadcast with every upload-lifecycle event. It always carries the
 * affected object `key` and, depending on the transition, optional progress
 * counters or an error description.
 */
export interface StorageRealtimeEventPayload {
  /** The affected object key (always present). */
  readonly key: string;
  /** Bytes transferred so far, present on `upload.progress`. */
  readonly bytesTransferred?: number;
  /** Total expected bytes when known, present on `upload.progress`. */
  readonly totalBytes?: number;
  /** A human-readable failure reason, present on `upload.failed`. */
  readonly error?: string;
}

/**
 * The publisher the facade holds and calls at each upload state transition.
 * Every method is fire-and-forget and guaranteed never to throw into the caller:
 * the underlying broadcast is isolated so a failing (or absent) realtime layer
 * cannot break an upload (Requirement 19.3).
 */
export interface StorageRealtimePublisher {
  /**
   * Broadcast an already-named upload event with the given payload. Never
   * throws. The typed convenience methods below are thin wrappers over this.
   */
  broadcast(event: StorageRealtimeEventName, payload: StorageRealtimeEventPayload): void;

  /** Broadcast `upload.started` when an upload begins. */
  started(key: string): void;

  /** Broadcast `upload.progress` as bytes transfer. */
  progress(key: string, bytesTransferred: number, totalBytes?: number): void;

  /** Broadcast `upload.completed` when an upload finishes successfully. */
  completed(key: string): void;

  /** Broadcast `upload.failed` when an upload errors out. */
  failed(key: string, error?: string): void;
}

/**
 * Isolate a single broadcast call. A synchronous throw is caught; a returned
 * promise has its rejection swallowed. Either way nothing propagates back to the
 * upload that triggered the event, satisfying the "never throw into the
 * operation path" guarantee (Requirement 19.3).
 */
function safeBroadcast(
  realtime: RealtimeLike,
  event: StorageRealtimeEventName,
  payload: StorageRealtimeEventPayload,
): void {
  try {
    const result = realtime.broadcast(STORAGE_UPLOAD_CHANNEL, event, payload);
    if (result !== undefined && result !== null && typeof (result as Promise<void>).then === "function") {
      // Fire-and-forget: absorb any asynchronous rejection.
      (result as Promise<void>).then(undefined, () => {
        /* swallow — a broadcast failure must not break the upload */
      });
    }
  } catch {
    // swallow — a broadcast failure must not break the upload
  }
}

/**
 * Create a {@link StorageRealtimePublisher} that broadcasts upload-lifecycle
 * events through the supplied structural {@link RealtimeLike} bridge.
 *
 * The returned publisher is what the facade wires into its streaming/resumable
 * upload paths (`putStream`/`resumeUpload` → started/completed, and failed on
 * error). Every method is guaranteed never to throw into the caller.
 *
 * ```ts
 * const publisher = bridgeStorageRealtime(realtime);
 * publisher.started("video.mp4");   // broadcasts "upload.started" — never throws
 * publisher.completed("video.mp4"); // broadcasts "upload.completed" — never throws
 * ```
 */
export function bridgeStorageRealtime(realtime: RealtimeLike): StorageRealtimePublisher {
  const broadcast = (event: StorageRealtimeEventName, payload: StorageRealtimeEventPayload): void => {
    safeBroadcast(realtime, event, payload);
  };

  return {
    broadcast,
    started(key) {
      broadcast("upload.started", { key });
    },
    progress(key, bytesTransferred, totalBytes) {
      broadcast("upload.progress", { key, bytesTransferred, totalBytes });
    },
    completed(key) {
      broadcast("upload.completed", { key });
    },
    failed(key, error) {
      broadcast("upload.failed", { key, error });
    },
  };
}
