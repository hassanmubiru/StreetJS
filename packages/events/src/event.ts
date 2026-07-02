// src/event.ts
// @streetjs/events — the event model: the typed event-map contract, the
// class-based `Event` base, the serialized envelope a store persists, the
// per-dispatch execution context, and the wildcard type machinery that keeps
// `on("user.*", ...)` fully type-safe.
//
// This module is pure types + a tiny base class; it has no runtime behavior
// beyond `Event` and `buildEnvelope`, so it stays trivially testable and
// dependency-free.

/**
 * The contract every application supplies to {@link createEvents}. Keys are
 * dot-delimited event names; values are the fully-typed payload delivered to a
 * listener of that event. Example:
 *
 * ```ts
 * interface AppEvents {
 *   'user.created': User;
 *   'payment.completed': Payment;
 *   'order.shipped': Order;
 * }
 * ```
 */
export type EventMap = Record<string, unknown>;

/** The set of concrete (non-wildcard) event names declared by a map. */
export type EventName<T extends EventMap> = keyof T & string;

/** The payload type for a concrete event name. */
export type EventPayload<T extends EventMap, K extends EventName<T>> = T[K];

// ── Wildcard pattern typing ───────────────────────────────────────────────────
//
// Wildcard semantics (matched identically at runtime by `matchesPattern`):
//   - a pattern is a dot-delimited list of segments;
//   - `*`  matches EXACTLY ONE segment (`user.*` ⇒ `user.created`, not `user.a.b`);
//   - `**` matches ONE OR MORE segments (`user.**` ⇒ `user.created` AND `user.a.b`);
//   - a pattern with no `*` matches only the exact event name.

/** True when `S` contains no `.` (i.e. it is a single segment). */
type SingleSegment<S extends string> = S extends `${string}.${string}` ? false : true;

/**
 * The concrete event names of `T` that a pattern `P` matches, at the type level.
 * Mirrors the runtime matcher so wildcard listeners receive a correctly-typed
 * payload union.
 */
export type MatchingEventNames<T extends EventMap, P extends string> =
  P extends `${infer Head}.**`
    ? Extract<EventName<T>, `${Head}.${string}`>
    : P extends `${infer Head}.*`
      ? {
          [K in EventName<T>]: K extends `${Head}.${infer Rest}`
            ? SingleSegment<Rest> extends true
              ? K
              : never
            : never;
        }[EventName<T>]
      : P extends '**'
        ? EventName<T>
        : P extends '*'
          ? { [K in EventName<T>]: SingleSegment<K> extends true ? K : never }[EventName<T>]
          : Extract<EventName<T>, P>;

/**
 * The payload a listener for pattern `P` receives: the union of payloads of
 * every event name `P` matches. Falls back to `unknown` when the pattern
 * matches no declared event (so a forward-looking pattern still compiles).
 */
export type WildcardPayload<T extends EventMap, P extends string> = [
  MatchingEventNames<T, P>,
] extends [never]
  ? unknown
  : T[MatchingEventNames<T, P> & keyof T];

/** A value or a promise of it. */
export type Awaitable<T> = T | Promise<T>;

/**
 * The context handed to every listener and middleware for one delivered event.
 * `metadata` is a mutable bag middleware can enrich (tenant, correlation id,
 * tracing span, actor) and later middleware/listeners observe.
 */
export interface EventContext<TName extends string = string> {
  /** The concrete event name that fired (never a wildcard pattern). */
  readonly event: TName;
  /** Unique id assigned to this event occurrence. */
  readonly id: string;
  /** Epoch ms at which the event was published (from the injected clock). */
  readonly timestamp: number;
  /** Mutable metadata propagated through middleware for the rest of dispatch. */
  readonly metadata: Record<string, unknown>;
  /** Convenience tenant id set by tenant-context middleware, if any. */
  tenantId?: string;
}

/** A typed listener for a concrete event. */
export type EventListener<TPayload, TName extends string = string> = (
  payload: TPayload,
  ctx: EventContext<TName>,
) => Awaitable<void>;

/** A structured, serialized representation of a listener failure. */
export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

/**
 * The serialized unit an {@link EventStore} persists and a replay re-dispatches.
 * Carries everything needed to re-deliver the event to current listeners.
 */
export interface EventEnvelope<TPayload = unknown> {
  /** Unique id of this event occurrence. */
  readonly id: string;
  /** The concrete event name. */
  readonly name: string;
  /** The typed payload. */
  readonly payload: TPayload;
  /** Epoch ms at which the event was published. */
  readonly timestamp: number;
  /** Monotonic publish sequence, used to preserve/replay publish order. */
  readonly seq: number;
  /** Metadata captured at publish time (tenant, correlation id, ...). */
  readonly metadata: Record<string, unknown>;
}

/**
 * Base class for a strongly-typed application event. Subclasses fix the stable
 * `type` string and carry a typed `payload`, enabling the class-based publish
 * form `events.publish(new UserCreated(user))`.
 *
 * ```ts
 * class UserCreated extends Event<User> {
 *   readonly type = 'user.created';
 * }
 * ```
 */
export abstract class Event<TPayload = unknown> {
  /** Stable, unique event name used to route to listeners. */
  abstract readonly type: string;
  /** The typed payload delivered to listeners. */
  readonly payload: TPayload;

  constructor(payload: TPayload) {
    this.payload = payload;
  }
}

/** A type guard for the class-based {@link Event} publish form. */
export function isEvent(value: unknown): value is Event<unknown> {
  return value instanceof Event;
}

/**
 * Build the serialized {@link EventEnvelope} for a published event. `id` is a
 * unique occurrence id, `timestamp` is stamped from the injected clock, and
 * `seq` is the caller-provided monotonic publish sequence.
 */
export function buildEnvelope<TPayload>(
  name: string,
  payload: TPayload,
  timestamp: number,
  seq: number,
  metadata: Record<string, unknown> = {},
): EventEnvelope<TPayload> {
  return {
    id: `evt_${timestamp.toString(36)}_${seq.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    payload,
    timestamp,
    seq,
    metadata,
  };
}
