/**
 * @streetjs/storage — the Events integration bridge.
 *
 * This module publishes typed storage lifecycle events (`storage.uploaded`,
 * `storage.deleted`, `storage.updated`, `storage.moved`, `storage.restored`,
 * `storage.expired`) through an events layer, each payload carrying the affected
 * object key and (when available) its {@link StorageObjectMetadata}
 * (Requirements 18.1, 18.2). Lifecycle-rule actions publish through this same
 * bridge (Requirement 13.4).
 *
 * Following the events package's structural-interface pattern, the bridge
 * depends only on the minimal {@link EventsLike} shape declared in `types.ts`
 * (any object exposing `publish(event, payload)`), never on the concrete
 * `@streetjs/events` package, so there is no hard dependency and no circular
 * dependency (Requirements 18.3, 28.3). {@link EventsLike} is re-exported here
 * for convenience; it is intentionally the single definition that lives in
 * `types.ts`.
 *
 * **Never throws into the operation path.** Every publish is wrapped so that a
 * synchronous throw or an asynchronous rejection from the underlying events
 * layer is swallowed: a publish failure must never break the storage operation
 * that triggered it. This mirrors the graceful-degradation guarantee the Queue
 * and Realtime bridges also uphold.
 *
 * The facade constructs a {@link StorageEventPublisher} via
 * {@link bridgeStorageEvents} only when `config.bridges?.events` is provided;
 * when it is absent the facade holds no publisher and event publication is a
 * complete no-op.
 *
 * _Requirements: 13.4, 18.1, 18.2, 18.3, 28.3_
 */

import type { EventsLike, LifecycleOutcome, StorageObjectMetadata } from "../types.js";

// Re-export the structural events contract so consumers can import it from the
// integration module as well as from the package root. This is a re-export of
// the single definition in `types.ts`, never a competing declaration.
export type { EventsLike } from "../types.js";

/**
 * The exhaustive set of typed event names the storage framework publishes
 * (Requirement 18.1). Every object mutation and every applied lifecycle action
 * maps onto exactly one of these names.
 */
export type StorageEventName =
  | "storage.uploaded"
  | "storage.deleted"
  | "storage.updated"
  | "storage.moved"
  | "storage.restored"
  | "storage.expired";

/**
 * The payload published with every storage event. It always carries the
 * affected object `key` (Requirement 18.2) and, when the triggering operation
 * has it in hand, the object's full {@link StorageObjectMetadata}. Events raised
 * from an applied lifecycle rule additionally carry the originating lifecycle
 * `action` so a single `storage.moved`/`storage.deleted`/`storage.expired`
 * listener can still distinguish the rule that produced it.
 */
export interface StorageEventPayload {
  /** The affected object key (always present — Requirement 18.2). */
  readonly key: string;
  /** The object metadata when the operation has it available. */
  readonly metadata?: StorageObjectMetadata;
  /** The originating lifecycle action, present only for lifecycle events. */
  readonly action?: LifecycleOutcome["action"];
}

/**
 * The publisher the facade holds and calls at each object-mutation point. Every
 * method is fire-and-forget and guaranteed never to throw into the caller: the
 * underlying publish is isolated so a failing events layer cannot break a
 * storage operation.
 */
export interface StorageEventPublisher {
  /**
   * Publish an already-named storage event with the given payload. Never throws.
   * The typed convenience methods below are thin wrappers over this.
   */
  publish(event: StorageEventName, payload: StorageEventPayload): void;

  /** Publish `storage.uploaded` for a newly created object. */
  uploaded(metadata: StorageObjectMetadata): void;

  /** Publish `storage.updated` for an overwritten (already-existing) object. */
  updated(metadata: StorageObjectMetadata): void;

  /** Publish `storage.deleted` for a removed object. */
  deleted(key: string, metadata?: StorageObjectMetadata): void;

  /** Publish `storage.moved` for a relocated/renamed object. */
  moved(metadata: StorageObjectMetadata): void;

  /** Publish `storage.restored` for a version restored to current. */
  restored(metadata: StorageObjectMetadata): void;

  /** Publish `storage.expired` for an expired transient/temporary object. */
  expired(key: string, metadata?: StorageObjectMetadata): void;

  /**
   * Publish the event corresponding to an applied {@link LifecycleOutcome}
   * (Requirement 13.4). The lifecycle `action` maps onto the typed event name
   * and is echoed in the payload's `action` field:
   *
   * - `deleted`  → `storage.deleted`
   * - `expired`  → `storage.expired`
   * - `moved`    → `storage.moved`
   * - `archived` → `storage.moved` (archiving relocates the object)
   */
  lifecycle(outcome: LifecycleOutcome): void;
}

/**
 * Map an applied {@link LifecycleOutcome} action onto its typed storage event
 * name. `archived` is surfaced as `storage.moved` because archiving relocates
 * the object under the reserved archive prefix; the original action is retained
 * in the payload so listeners can still tell the two apart.
 */
const LIFECYCLE_EVENT_BY_ACTION: Readonly<Record<LifecycleOutcome["action"], StorageEventName>> = {
  deleted: "storage.deleted",
  expired: "storage.expired",
  moved: "storage.moved",
  archived: "storage.moved",
};

/**
 * Isolate a single publish call. A synchronous throw is caught; a returned
 * promise has its rejection swallowed. Either way nothing propagates back to the
 * storage operation that triggered the event, satisfying the "never throw into
 * the operation path" guarantee.
 */
function safePublish(events: EventsLike, event: StorageEventName, payload: StorageEventPayload): void {
  try {
    const result = events.publish(event, payload);
    if (result !== undefined && result !== null && typeof (result as Promise<void>).then === "function") {
      // Fire-and-forget: absorb any asynchronous rejection.
      (result as Promise<void>).then(undefined, () => {
        /* swallow — a publish failure must not break the storage op */
      });
    }
  } catch {
    // swallow — a publish failure must not break the storage op
  }
}

/**
 * Create a {@link StorageEventPublisher} that publishes typed storage events
 * through the supplied structural {@link EventsLike} bridge.
 *
 * The returned publisher is what the facade wires into its object operations
 * (`put` → uploaded/updated, `delete` → deleted, `move`/`rename` → moved,
 * `restoreVersion` → restored) and its lifecycle evaluation (`applyLifecycle`
 * → deleted/expired/moved via {@link StorageEventPublisher.lifecycle}). Every
 * method is guaranteed never to throw into the caller.
 *
 * ```ts
 * const publisher = bridgeStorageEvents(events);
 * publisher.uploaded(metadata); // publishes "storage.uploaded" — never throws
 * ```
 */
export function bridgeStorageEvents(events: EventsLike): StorageEventPublisher {
  const publish = (event: StorageEventName, payload: StorageEventPayload): void => {
    safePublish(events, event, payload);
  };

  return {
    publish,
    uploaded(metadata) {
      publish("storage.uploaded", { key: metadata.key, metadata });
    },
    updated(metadata) {
      publish("storage.updated", { key: metadata.key, metadata });
    },
    deleted(key, metadata) {
      publish("storage.deleted", { key, metadata });
    },
    moved(metadata) {
      publish("storage.moved", { key: metadata.key, metadata });
    },
    restored(metadata) {
      publish("storage.restored", { key: metadata.key, metadata });
    },
    expired(key, metadata) {
      publish("storage.expired", { key, metadata });
    },
    lifecycle(outcome) {
      publish(LIFECYCLE_EVENT_BY_ACTION[outcome.action], {
        key: outcome.key,
        action: outcome.action,
      });
    },
  };
}
