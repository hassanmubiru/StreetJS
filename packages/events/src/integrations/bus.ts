// src/integrations/bus.ts
// @streetjs/events — distributed fan-out bridge between the in-process
// application event layer and the core `EventBus` (which itself can run over
// Redis/RabbitMQ/Kafka transports). Opt-in via the `@streetjs/events/bus`
// submodule.
//
//   forwardToBus:   events.on('order.shipped', ...) ──▶ bus.publish('order.shipped', payload)
//   forwardFromBus: bus.subscribe('order.shipped', ...) ──▶ events.publish('order.shipped', payload)
//
// Wiring both directions on the same logical event is safe: inbound-published
// events are tagged in metadata so outbound forwarding skips them, preventing an
// infinite publish loop. The bridge depends only on a STRUCTURAL `EventBusLike`
// (the core `EventBus` satisfies it), so there is no circular dependency and any
// bus-shaped object works.

import type { AnyEventMap, EventContext, EventMap } from '../event.js';
import type { Events, Unsubscribe } from '../facade.js';

/** The envelope shape delivered by the bus (mirrors the core `EventEnvelope`). */
export interface BusEnvelope {
  readonly topic: string;
  readonly payload: unknown;
  readonly id?: string;
  readonly timestamp?: string;
}

/** The minimal bus surface the bridge needs (the core `EventBus` satisfies it). */
export interface EventBusLike {
  publish(topic: string, payload: unknown): Promise<void>;
  subscribe(topic: string, handler: (env: BusEnvelope) => Promise<void>): () => void;
}

/** Metadata key marking an app event that originated from the bus (loop guard). */
export const FROM_BUS = '__fromBus';

/** One mapping from an application event to a bus topic (outbound). */
export interface ToBusBridge {
  /** App event name or wildcard pattern to forward. */
  appEvent: string;
  /** Destination bus topic. Static, or derived from the context. Default `ctx.event`. */
  topic?: string | ((ctx: EventContext) => string);
  /** Transform the app payload into the bus payload. Default: the raw payload. */
  map?: (payload: unknown, ctx: EventContext) => unknown;
}

/** One mapping from a bus topic to an application event (inbound). */
export interface FromBusBridge {
  /** Bus topic to subscribe to. */
  topic: string;
  /** App event name to publish. Static, or derived from the envelope. Default `env.topic`. */
  appEvent?: string | ((env: BusEnvelope) => string);
  /** Transform the bus envelope into the app payload. Default: `env.payload`. */
  map?: (env: BusEnvelope) => unknown;
  /**
   * Publish awaited instead of fire-and-forget. Default `false` so a slow app
   * listener never back-pressures the bus transport.
   */
  awaitPublish?: boolean;
}

/**
 * Forward selected application events onto the core `EventBus` for cross-process
 * fan-out. Events that arrived FROM the bus (via {@link forwardFromBus}) are
 * skipped to prevent a publish loop. Returns a detach function.
 */
export function forwardToBus<T extends AnyEventMap = EventMap>(
  events: Events<T>,
  bus: EventBusLike,
  bridges: readonly ToBusBridge[],
): () => void {
  const on = (events as EventsAny).on.bind(events);
  const unsubscribes: Unsubscribe[] = [];

  for (const bridge of bridges) {
    const off = on(bridge.appEvent, async (payload: unknown, ctx: EventContext) => {
      // Loop guard: never re-forward an event that originated from the bus.
      if (ctx.metadata[FROM_BUS] === true) {
        return;
      }
      const topic =
        bridge.topic === undefined
          ? ctx.event
          : typeof bridge.topic === 'function'
            ? bridge.topic(ctx)
            : bridge.topic;
      const data = bridge.map ? bridge.map(payload, ctx) : payload;
      await bus.publish(topic, data);
    });
    unsubscribes.push(off);
  }

  return () => {
    for (const off of unsubscribes) {
      try {
        off();
      } catch {
        /* best-effort detach */
      }
    }
  };
}

/**
 * Subscribe to bus topics and republish them into the application event layer.
 * Republished events are tagged with {@link FROM_BUS} metadata so a concurrent
 * {@link forwardToBus} does not echo them back. Returns a detach function.
 */
export function forwardFromBus<T extends AnyEventMap = EventMap>(
  bus: EventBusLike,
  events: Events<T>,
  bridges: readonly FromBusBridge[],
): () => void {
  const target = events as EventsAny;
  const unsubscribes: Array<() => void> = [];

  for (const bridge of bridges) {
    const unsub = bus.subscribe(bridge.topic, async (env) => {
      const name =
        bridge.appEvent === undefined
          ? env.topic
          : typeof bridge.appEvent === 'function'
            ? bridge.appEvent(env)
            : bridge.appEvent;
      const payload = bridge.map ? bridge.map(env) : env.payload;
      const options = { metadata: { [FROM_BUS]: true } };
      if (bridge.awaitPublish) {
        await target.publish(name, payload, options);
      } else {
        target.publishAsync(name, payload, options);
      }
    });
    unsubscribes.push(unsub);
  }

  return () => {
    for (const unsub of unsubscribes) {
      try {
        unsub();
      } catch {
        /* best-effort detach */
      }
    }
  };
}

/** Internal helper: address the facade through dynamic-name publish/on. */
type EventsAny = {
  publish(name: string, payload: unknown, options?: { metadata?: Record<string, unknown> }): Promise<unknown>;
  publishAsync(name: string, payload: unknown, options?: { metadata?: Record<string, unknown> }): void;
  on(
    name: string,
    listener: (payload: unknown, ctx: EventContext) => void | Promise<void>,
  ): Unsubscribe;
};
