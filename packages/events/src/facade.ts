// src/facade.ts
// @streetjs/events — the strongly-typed application event facade.
//
// `createEvents<AppEvents>()` returns an `Events<AppEvents>` that owns the
// subscription registry, the middleware chain, the (optional) event store, the
// injected clock, and the observability telemetry sink. It provides both publish
// forms (string+payload and class-based `Event`), exact and wildcard `on`/`once`
// subscriptions, ordered synchronous dispatch (`publish`), fire-and-forget
// ordered async dispatch (`publishAsync`/`emit`), a composable middleware
// pipeline, per-listener error isolation, and replay over the store.
//
// Design: middleware wraps dispatch and may veto it (errors propagate to the
// publisher); listeners are decoupled consumers whose failures are isolated
// (routed to metrics + the error hook) so one bad listener never blocks its
// siblings or the publisher.

import { systemClock, type Clock } from 'streetjs';
import {
  buildEnvelope,
  isEvent,
  type Event,
  type EventContext,
  type EventEnvelope,
  type EventListener,
  type EventMap,
  type EventName,
  type SerializedError,
  type WildcardPayload,
} from './event.js';
import { Emitter } from './emitter.js';
import { composePipeline, type DeliveryStep, type EventMiddleware } from './middleware.js';
import type { EventStore, ReplayFilter } from './store/store.js';

/** Cancels a subscription. Idempotent. */
export type Unsubscribe = () => void;

/** Per-publish options: attach metadata / tenant carried on the context. */
export interface PublishOptions {
  /** Metadata merged into the event context (correlation id, actor, ...). */
  metadata?: Record<string, unknown>;
  /** Convenience tenant id set on the context and metadata. */
  tenantId?: string;
}

/** Invoked when a listener throws; never itself allowed to break dispatch. */
export type ErrorHandler = (error: unknown, ctx: EventContext) => void;

/**
 * Telemetry sink the observability module implements to feed metrics. All hooks
 * are optional and must never throw into the dispatch path.
 */
export interface EventsTelemetry {
  /** Called once when an event is published (before delivery). */
  onPublished?(ctx: EventContext): void;
  /** Called after a single listener completes successfully, with its latency. */
  onDelivered?(ctx: EventContext, listenerDurationMs: number): void;
  /** Called when a listener throws. */
  onFailed?(ctx: EventContext, error: SerializedError): void;
  /** Called after an event's full dispatch settles. */
  onDispatchComplete?(
    ctx: EventContext,
    totalDurationMs: number,
    delivered: number,
    failed: number,
  ): void;
}

/** Live counters/gauge sources for observability and health. */
export interface EventsStats {
  /** Total events published. */
  published: number;
  /** Total successful (event, listener) deliveries. */
  delivered: number;
  /** Total listener failures (isolated). */
  failed: number;
  /** Active subscriptions (exact + wildcard). */
  listeners: number;
  /** Active wildcard subscriptions. */
  patterns: number;
  /** Fire-and-forget deliveries currently queued/in-flight (async depth). */
  asyncPending: number;
}

/** Options for {@link createEvents}. */
export interface EventsOptions {
  /** Injected clock for deterministic timestamps in tests. Default `systemClock`. */
  clock?: Clock;
  /** Optional event store enabling persistence + {@link Events.replay}. */
  store?: EventStore;
  /**
   * Persist published events to the configured `store`. Default `true` when a
   * store is provided, `false` otherwise. Ignored without a store.
   */
  persist?: boolean;
  /** Invoked when a listener throws (in addition to telemetry). */
  onError?: ErrorHandler;
  /** Telemetry sink (wired by the observability module). */
  telemetry?: EventsTelemetry;
}

/**
 * The strongly-typed application event facade. `T` is the application's event
 * map (`{ 'user.created': User; ... }`).
 */
export interface Events<T extends EventMap = EventMap> {
  /** Publish a typed event by name + payload; resolves after all listeners settle. */
  publish<K extends EventName<T>>(
    name: K,
    payload: T[K],
    options?: PublishOptions,
  ): Promise<EventContext<K>>;
  /** Publish a class-based {@link Event}; resolves after all listeners settle. */
  publish(event: Event, options?: PublishOptions): Promise<EventContext>;

  /**
   * Fire-and-forget publish. Returns immediately; delivery is scheduled on an
   * ordered async queue that preserves publish order. Alias: {@link emit}.
   */
  publishAsync<K extends EventName<T>>(name: K, payload: T[K], options?: PublishOptions): void;
  publishAsync(event: Event, options?: PublishOptions): void;

  /** Alias of {@link publishAsync}. */
  emit<K extends EventName<T>>(name: K, payload: T[K], options?: PublishOptions): void;
  emit(event: Event, options?: PublishOptions): void;

  /** Subscribe to an exact event name (fully typed payload). */
  on<K extends EventName<T>>(name: K, listener: EventListener<T[K], K>): Unsubscribe;
  /** Subscribe to a wildcard pattern (payload typed as the union of matches). */
  on<P extends string>(
    pattern: P,
    listener: EventListener<WildcardPayload<T, P>, string>,
  ): Unsubscribe;

  /** One-shot exact subscription; removed after its first delivery. */
  once<K extends EventName<T>>(name: K, listener: EventListener<T[K], K>): Unsubscribe;
  /** One-shot wildcard subscription; removed after its first delivery. */
  once<P extends string>(
    pattern: P,
    listener: EventListener<WildcardPayload<T, P>, string>,
  ): Unsubscribe;

  /** Append a middleware to the dispatch pipeline (composed in registration order). */
  use(middleware: EventMiddleware): void;

  /** Register an error handler invoked when a listener throws. */
  onError(handler: ErrorHandler): void;

  /**
   * Re-dispatch stored events to current listeners (requires a configured
   * store). Returns the number of events replayed.
   */
  replay(filter?: ReplayFilter): Promise<number>;

  /** The configured event store, if any. */
  readonly store?: EventStore;

  /** Live stats for observability/health (never throws). */
  stats(): EventsStats;

  /** Number of listeners for an exact name, or total when omitted. */
  listenerCount(name?: string): number;

  /** Remove all listeners and await any in-flight async deliveries. */
  close(): Promise<void>;
}

function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: 'Error', message: String(err) };
}

/** A mutable view of the readonly public context (facade-internal). */
type MutableContext = { -readonly [K in keyof EventContext]: EventContext[K] };

class EventsFacade<T extends EventMap> implements Events<T> {
  readonly store?: EventStore;

  private readonly clock: Clock;
  private readonly persist: boolean;
  private readonly emitter = new Emitter();
  private readonly middleware: EventMiddleware[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly telemetry?: EventsTelemetry;

  /** Monotonic publish sequence (envelope ordering + replay ordering). */
  private seq = 0;
  /** Ordered async delivery tail — chains fire-and-forget deliveries in order. */
  private asyncTail: Promise<void> = Promise.resolve();
  private asyncPending = 0;

  private published = 0;
  private delivered = 0;
  private failed = 0;
  private closed = false;

  constructor(options: EventsOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.store = options.store;
    this.persist = options.persist ?? options.store !== undefined;
    this.telemetry = options.telemetry;
    if (options.onError) {
      this.errorHandlers.push(options.onError);
    }
  }

  // ── Publish (ordered, awaited) ──────────────────────────────────────────────

  publish(
    nameOrEvent: EventName<T> | Event,
    payloadOrOptions?: unknown,
    maybeOptions?: PublishOptions,
  ): Promise<EventContext> {
    const { name, payload, options } = normalizeArgs(nameOrEvent, payloadOrOptions, maybeOptions);
    return this.dispatch(name, payload, options);
  }

  // ── Publish (fire-and-forget, ordered async) ────────────────────────────────

  publishAsync(
    nameOrEvent: EventName<T> | Event,
    payloadOrOptions?: unknown,
    maybeOptions?: PublishOptions,
  ): void {
    const { name, payload, options } = normalizeArgs(nameOrEvent, payloadOrOptions, maybeOptions);
    this.asyncPending += 1;
    // Chain onto the tail so deliveries run in publish order, never overlapping.
    this.asyncTail = this.asyncTail
      .then(async () => {
        try {
          await this.dispatch(name, payload, options);
        } finally {
          this.asyncPending -= 1;
        }
      })
      // Swallow so a rejected delivery never poisons the shared tail chain.
      .catch(() => undefined);
  }

  emit(
    nameOrEvent: EventName<T> | Event,
    payloadOrOptions?: unknown,
    maybeOptions?: PublishOptions,
  ): void {
    this.publishAsync(nameOrEvent as EventName<T>, payloadOrOptions, maybeOptions);
  }

  // ── Subscribe ───────────────────────────────────────────────────────────────

  on(key: string, listener: EventListener<unknown, string>): Unsubscribe {
    return this.emitter.add(key, listener as never, false);
  }

  once(key: string, listener: EventListener<unknown, string>): Unsubscribe {
    return this.emitter.add(key, listener as never, true);
  }

  use(middleware: EventMiddleware): void {
    this.middleware.push(middleware);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  // ── Replay ──────────────────────────────────────────────────────────────────

  async replay(filter?: ReplayFilter): Promise<number> {
    if (!this.store) {
      throw new Error('Events.replay requires a configured event store (options.store).');
    }
    const events = await this.store.read(filter);
    for (const envelope of events) {
      // Re-dispatch through the full pipeline to current listeners, preserving
      // stored order. Replayed events are NOT re-persisted.
      // eslint-disable-next-line no-await-in-loop -- ordered replay is intentional
      await this.deliverEnvelope(envelope, false);
    }
    return events.length;
  }

  // ── Introspection / lifecycle ────────────────────────────────────────────────

  stats(): EventsStats {
    return {
      published: this.published,
      delivered: this.delivered,
      failed: this.failed,
      listeners: this.emitter.listenerCount(),
      patterns: this.emitter.patternCount(),
      asyncPending: this.asyncPending,
    };
  }

  listenerCount(name?: string): number {
    return this.emitter.listenerCount(name);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    // Await any queued fire-and-forget deliveries so shutdown is graceful.
    await this.asyncTail;
    this.emitter.clear();
  }

  // ── Internals ─────────────────────────────────────────────────────────────────

  /** Build the envelope, persist (if configured), and run the dispatch pipeline. */
  private async dispatch(
    name: string,
    payload: unknown,
    options: PublishOptions,
  ): Promise<EventContext> {
    const timestamp = this.clock();
    const metadata: Record<string, unknown> = { ...options.metadata };
    if (options.tenantId !== undefined) {
      metadata['tenantId'] = options.tenantId;
    }
    const envelope = buildEnvelope(name, payload, timestamp, this.seq++, metadata);

    this.published += 1;

    if (this.store && this.persist) {
      // Persistence must not block delivery on a store error; surface it via the
      // error hook and continue (loose coupling — a store outage is not fatal).
      try {
        await this.store.append(envelope);
      } catch (err) {
        this.reportError(err, this.contextFor(envelope, options.tenantId));
      }
    }

    return this.deliverEnvelope(envelope, true, options.tenantId);
  }

  /** Run the middleware pipeline + listener delivery for one envelope. */
  private async deliverEnvelope(
    envelope: EventEnvelope,
    countPublishTelemetry: boolean,
    tenantId?: string,
  ): Promise<EventContext> {
    const ctx = this.contextFor(envelope, tenantId);
    if (countPublishTelemetry) {
      this.safeTelemetry(() => this.telemetry?.onPublished?.(ctx));
    }

    const start = this.clock();
    let deliveredCount = 0;
    let failedCount = 0;

    // Terminal delivery step: resolve current listeners and deliver in order.
    const deliver: DeliveryStep = async (context, payload) => {
      const subs = this.emitter.resolve(context.event);
      for (const sub of subs) {
        if (!sub.active) {
          continue;
        }
        if (sub.once) {
          // Remove before invoking so a re-entrant publish won't re-deliver.
          this.emitter.remove(sub);
        }
        const listenerStart = this.clock();
        try {
          // eslint-disable-next-line no-await-in-loop -- ordered, sequential delivery
          await sub.listener(payload, context);
          deliveredCount += 1;
          this.delivered += 1;
          this.safeTelemetry(() =>
            this.telemetry?.onDelivered?.(context, this.clock() - listenerStart),
          );
        } catch (err) {
          failedCount += 1;
          this.failed += 1;
          const serialized = serializeError(err);
          this.safeTelemetry(() => this.telemetry?.onFailed?.(context, serialized));
          this.reportError(err, context);
        }
      }
    };

    // Middleware may veto delivery by throwing / not calling next(); such errors
    // propagate to the publisher (policy), unlike isolated listener errors.
    const runner = composePipeline(this.middleware, deliver);
    await runner(ctx, envelope.payload);

    this.safeTelemetry(() =>
      this.telemetry?.onDispatchComplete?.(ctx, this.clock() - start, deliveredCount, failedCount),
    );
    return ctx;
  }

  private contextFor(envelope: EventEnvelope, tenantId?: string): EventContext {
    const ctx: MutableContext = {
      event: envelope.name,
      id: envelope.id,
      timestamp: envelope.timestamp,
      metadata: envelope.metadata,
      tenantId: tenantId ?? (envelope.metadata['tenantId'] as string | undefined),
    };
    return ctx;
  }

  private reportError(err: unknown, ctx: EventContext): void {
    for (const handler of this.errorHandlers) {
      try {
        handler(err, ctx);
      } catch {
        // An error handler that itself throws must never break dispatch.
      }
    }
  }

  private safeTelemetry(fn: () => void): void {
    try {
      fn();
    } catch {
      // Telemetry must never destabilize dispatch.
    }
  }
}

/** Normalize the two publish forms into `{ name, payload, options }`. */
function normalizeArgs(
  nameOrEvent: string | Event,
  payloadOrOptions: unknown,
  maybeOptions: PublishOptions | undefined,
): { name: string; payload: unknown; options: PublishOptions } {
  if (isEvent(nameOrEvent)) {
    return {
      name: nameOrEvent.type,
      payload: nameOrEvent.payload,
      options: (payloadOrOptions as PublishOptions | undefined) ?? {},
    };
  }
  return {
    name: nameOrEvent,
    payload: payloadOrOptions,
    options: maybeOptions ?? {},
  };
}

/**
 * Create a strongly-typed application event facade.
 *
 * ```ts
 * interface AppEvents { 'user.created': User; 'order.shipped': Order; }
 * const events = createEvents<AppEvents>();
 * events.on('user.created', (user) => { ... });   // user: User
 * await events.publish('user.created', user);
 * ```
 */
export function createEvents<T extends EventMap = EventMap>(options?: EventsOptions): Events<T> {
  return new EventsFacade<T>(options);
}
