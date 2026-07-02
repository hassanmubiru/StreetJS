// src/testing.ts
// @streetjs/events — the testing harness: FakeEvents, MemoryEvents, and
// TestHarness. All are Redis-free and require no wall-clock timing.
//
//   - FakeEvents  records every publish/emit call (name + payload + options) and
//     drives listeners synchronously, so tests assert *that* an event was
//     published (and with what) without any scheduling.
//   - MemoryEvents is a real facade over an in-memory store (persistence +
//     replay) for end-to-end tests.
//   - TestHarness wraps a real facade with an injected, advanceable clock plus
//     recording and assertion helpers.

import type { Clock } from 'streetjs';
import {
  isEvent,
  type AnyEventMap,
  type Event,
  type EventContext,
  type EventListener,
  type EventMap,
  type EventName,
  type WildcardPayload,
} from './event.js';
import {
  createEvents,
  type Events,
  type EventsOptions,
  type PublishOptions,
  type Unsubscribe,
} from './facade.js';
import { MemoryEventStore } from './store/memory.js';

/** A recorded publish/emit call captured by {@link FakeEvents} / {@link TestHarness}. */
export interface PublishRecord<TPayload = unknown> {
  /** The event name published. */
  readonly name: string;
  /** The payload published. */
  readonly payload: TPayload;
  /** The publish options (if any). */
  readonly options?: PublishOptions;
  /** Whether it was a fire-and-forget publish (`publishAsync`/`emit`). */
  readonly async: boolean;
}

/** Controls exposed by {@link FakeEvents} beyond the {@link Events} surface. */
export interface FakeEventsControls {
  /** Every publish/emit call, in order. */
  readonly published: ReadonlyArray<PublishRecord>;
  /** Clear recorded calls (listeners are kept). */
  reset(): void;
  /** True when an event with `name` was published at least once. */
  wasPublished(name: string): boolean;
  /** The payloads published under `name`, in order. */
  payloadsFor<TPayload = unknown>(name: string): TPayload[];
}

function normalize(
  nameOrEvent: string | Event,
  payloadOrOptions: unknown,
  maybeOptions: PublishOptions | undefined,
): { name: string; payload: unknown; options: PublishOptions | undefined } {
  if (isEvent(nameOrEvent)) {
    return {
      name: nameOrEvent.type,
      payload: nameOrEvent.payload,
      options: payloadOrOptions as PublishOptions | undefined,
    };
  }
  return { name: nameOrEvent, payload: payloadOrOptions, options: maybeOptions };
}

/**
 * A recording {@link Events} test double. Delegates real (synchronous) delivery
 * to an internal facade so listeners still run, while recording every publish
 * call on {@link published}. `publishAsync`/`emit` deliver synchronously (no
 * background loop) so assertions never need timing.
 */
export class FakeEvents<T extends AnyEventMap = EventMap> implements Events<T>, FakeEventsControls {
  readonly published: PublishRecord[] = [];
  readonly store?: undefined;

  private readonly inner: Events<T>;

  constructor(options: { clock?: Clock } = {}) {
    this.inner = createEvents<T>({ clock: options.clock });
  }

  publish<K extends EventName<T>>(
    name: K,
    payload: T[K],
    options?: PublishOptions,
  ): Promise<EventContext<K>>;
  publish(event: Event, options?: PublishOptions): Promise<EventContext>;
  publish(
    nameOrEvent: EventName<T> | Event,
    payloadOrOptions?: unknown,
    maybeOptions?: PublishOptions,
  ): Promise<EventContext> {
    const { name, payload, options } = normalize(nameOrEvent, payloadOrOptions, maybeOptions);
    this.published.push({ name, payload, options, async: false });
    return (this.inner as InnerAny).publish(name, payload, options);
  }

  publishAsync<K extends EventName<T>>(name: K, payload: T[K], options?: PublishOptions): void;
  publishAsync(event: Event, options?: PublishOptions): void;
  publishAsync(
    nameOrEvent: EventName<T> | Event,
    payloadOrOptions?: unknown,
    maybeOptions?: PublishOptions,
  ): void {
    const { name, payload, options } = normalize(nameOrEvent, payloadOrOptions, maybeOptions);
    this.published.push({ name, payload, options, async: true });
    // Deliver synchronously (fire the promise) so there is no background loop.
    void (this.inner as InnerAny).publish(name, payload, options);
  }

  emit<K extends EventName<T>>(name: K, payload: T[K], options?: PublishOptions): void;
  emit(event: Event, options?: PublishOptions): void;
  emit(
    nameOrEvent: EventName<T> | Event,
    payloadOrOptions?: unknown,
    maybeOptions?: PublishOptions,
  ): void {
    this.publishAsync(nameOrEvent as EventName<T>, payloadOrOptions, maybeOptions);
  }

  on<K extends EventName<T>>(name: K, listener: EventListener<T[K], K>): Unsubscribe;
  on<P extends string>(
    pattern: P,
    listener: EventListener<WildcardPayload<T, P>, string>,
  ): Unsubscribe;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(name: string, listener: (payload: any, ctx: EventContext) => unknown): Unsubscribe {
    return (this.inner as InnerAny).on(name, listener);
  }

  once<K extends EventName<T>>(name: K, listener: EventListener<T[K], K>): Unsubscribe;
  once<P extends string>(
    pattern: P,
    listener: EventListener<WildcardPayload<T, P>, string>,
  ): Unsubscribe;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  once(name: string, listener: (payload: any, ctx: EventContext) => unknown): Unsubscribe {
    return (this.inner as InnerAny).once(name, listener);
  }

  use(middleware: Parameters<Events<T>['use']>[0]): void {
    this.inner.use(middleware);
  }

  onError(handler: Parameters<Events<T>['onError']>[0]): void {
    this.inner.onError(handler);
  }

  replay(): Promise<number> {
    return Promise.reject(new Error('FakeEvents has no store; use MemoryEvents/TestHarness for replay.'));
  }

  stats(): ReturnType<Events<T>['stats']> {
    return this.inner.stats();
  }

  listenerCount(name?: string): number {
    return this.inner.listenerCount(name);
  }

  flush(): Promise<void> {
    return this.inner.flush();
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  // ── FakeEventsControls ─────────────────────────────────────────────────────

  reset(): void {
    this.published.length = 0;
  }

  wasPublished(name: string): boolean {
    return this.published.some((r) => r.name === name);
  }

  payloadsFor<TPayload = unknown>(name: string): TPayload[] {
    return this.published.filter((r) => r.name === name).map((r) => r.payload as TPayload);
  }
}

/** Create a recording {@link FakeEvents} test double. */
export function createFakeEvents<T extends AnyEventMap = EventMap>(options?: {
  clock?: Clock;
}): FakeEvents<T> {
  return new FakeEvents<T>(options);
}

/**
 * Create a real, in-memory {@link Events} facade backed by a {@link MemoryEventStore}
 * (persistence + replay enabled) for end-to-end tests without Redis.
 */
export function createMemoryEvents<T extends AnyEventMap = EventMap>(
  options: Omit<EventsOptions, 'store'> & { maxEvents?: number } = {},
): Events<T> {
  const { maxEvents, ...rest } = options;
  return createEvents<T>({ ...rest, store: new MemoryEventStore({ maxEvents }) });
}

/** Options for {@link TestHarness}. */
export interface TestHarnessOptions {
  /** Seed value for the harness's mutable clock (epoch ms). Default 0. */
  now?: number;
  /** Enable an in-memory store (persistence + replay). Default true. */
  store?: boolean;
  /** Ring-buffer bound for the in-memory store. */
  maxEvents?: number;
}

/**
 * A real {@link Events} facade wrapped with an injected, advanceable clock and
 * recording + assertion helpers. The substrate for deterministic unit tests: no
 * Redis, no wall-clock timing.
 */
export class TestHarness<T extends AnyEventMap = EventMap> {
  /** Every publish/emit call recorded via telemetry, in order. */
  readonly published: PublishRecord[] = [];

  private nowMs: number;
  private readonly eventsImpl: Events<T>;

  constructor(options: TestHarnessOptions = {}) {
    this.nowMs = options.now ?? 0;
    const useStore = options.store ?? true;
    this.eventsImpl = createEvents<T>({
      clock: () => this.nowMs,
      store: useStore ? new MemoryEventStore({ maxEvents: options.maxEvents }) : undefined,
      telemetry: {
        onPublished: (ctx) => {
          // Record name from ctx; payload is captured on the publish wrappers below.
          void ctx;
        },
      },
    });
  }

  /** The facade under test (injected with the harness's advanceable clock). */
  get events(): Events<T> {
    return this.eventsImpl;
  }

  /** The current value of the harness's mutable clock (epoch ms). */
  get clockNow(): number {
    return this.nowMs;
  }

  /** The harness's advanceable clock (`() => now`). */
  get clock(): Clock {
    return () => this.nowMs;
  }

  /** Advance the mutable clock by `ms` (must be non-negative). */
  advance(ms: number): void {
    if (ms < 0) {
      throw new Error(`TestHarness.advance requires a non-negative delta, received ${ms}.`);
    }
    this.nowMs += ms;
  }

  /** Publish (awaited) through the facade, recording the call. */
  async publish<K extends EventName<T>>(
    name: K,
    payload: T[K],
    options?: PublishOptions,
  ): Promise<void> {
    this.published.push({ name, payload, options, async: false });
    await this.eventsImpl.publish(name, payload, options);
  }

  /** Fire-and-forget publish through the facade, recording the call. */
  emit<K extends EventName<T>>(name: K, payload: T[K], options?: PublishOptions): void {
    this.published.push({ name, payload, options, async: true });
    this.eventsImpl.publishAsync(name, payload, options);
  }

  /** Await all queued fire-and-forget deliveries. */
  flush(): Promise<void> {
    return this.eventsImpl.flush();
  }

  /** Assert an event with `name` was published at least once. */
  assertPublished(name: string): void {
    if (!this.published.some((r) => r.name === name)) {
      const names = this.published.map((r) => r.name).join(', ');
      throw new Error(`assertPublished: "${name}" was not published. Published: [${names}]`);
    }
  }

  /** Assert the recorded publish names equal `expected`, in order. */
  assertOrder(expected: readonly string[]): void {
    const actual = this.published.map((r) => r.name);
    if (actual.length !== expected.length || actual.some((n, i) => n !== expected[i])) {
      throw new Error(
        `assertOrder: expected [${expected.join(', ')}] but published [${actual.join(', ')}]`,
      );
    }
  }

  /** Graceful shutdown of the underlying facade. */
  close(): Promise<void> {
    return this.eventsImpl.close();
  }
}

/** Internal helper: address the inner facade through dynamic-name publish/on. */
type InnerAny = {
  publish(name: string, payload: unknown, options?: PublishOptions): Promise<EventContext>;
  on(name: string, listener: (payload: unknown, ctx: EventContext) => unknown): Unsubscribe;
  once(name: string, listener: (payload: unknown, ctx: EventContext) => unknown): Unsubscribe;
};
