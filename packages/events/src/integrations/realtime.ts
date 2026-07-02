// src/integrations/realtime.ts
// @streetjs/events — bridge from the application event layer to @streetjs/realtime
// room broadcasts, e.g.
//
//   events.on('report.generated', ...) ──▶ realtime.room('reports').broadcast(...)
//
// Like the queue bridge, this depends only on a STRUCTURAL interface
// (`RealtimeLike`), never on `@streetjs/realtime`, so there is no circular
// dependency and the events package keeps its single `streetjs` runtime dep.

import type { AnyEventMap, EventContext, EventMap } from '../event.js';
import type { Events, Unsubscribe } from '../facade.js';

/** The broadcast envelope shape (mirrors realtime's `RealtimeMessage`). */
export interface RealtimeBroadcast<T = unknown> {
  readonly type: string;
  readonly payload: T;
}

/** A room handle: the minimal shape the bridge needs from realtime. */
export interface RoomLike {
  broadcast(message: RealtimeBroadcast, options?: unknown): unknown;
}

/**
 * The minimal shape the bridge needs from realtime: a `room(name)` accessor
 * returning something broadcastable. The `@streetjs/realtime` `Realtime` facade
 * satisfies this (`realtime.room('reports').broadcast({ type, payload })`).
 */
export interface RealtimeLike {
  room(name: string): RoomLike;
}

/**
 * One mapping from an application event (name or wildcard pattern) to a realtime
 * room broadcast.
 */
export interface RealtimeEventBridge {
  /** The application event name or wildcard pattern to subscribe to. */
  appEvent: string;
  /**
   * The destination room: a static name, or a function deriving it from the
   * payload/context (e.g. per-tenant or per-entity rooms).
   */
  room: string | ((payload: unknown, ctx: EventContext) => string);
  /**
   * The realtime message `type`. Defaults to the concrete event name (`ctx.event`).
   */
  type?: string | ((ctx: EventContext) => string);
  /**
   * Transform the event payload into the broadcast payload. Defaults to the raw
   * event payload.
   */
  map?: (payload: unknown, ctx: EventContext) => unknown;
}

/**
 * Wire application events to realtime room broadcasts. Subscribes one listener
 * on `events` per bridge; each matching event is broadcast to the resolved room.
 * Broadcast failures are isolated by the facade's per-listener error handling,
 * so a realtime outage never breaks the publisher.
 *
 * Returns a detach function that unsubscribes every listener the bridge added.
 *
 * ```ts
 * bridgeRealtimeEvents(events, realtime, [
 *   { appEvent: 'report.generated', room: 'reports' },
 *   { appEvent: 'order.*', room: (o) => `orders:${(o as { id: string }).id}` },
 * ]);
 * ```
 */
export function bridgeRealtimeEvents<T extends AnyEventMap = EventMap>(
  events: Events<T>,
  realtime: RealtimeLike,
  bridges: readonly RealtimeEventBridge[],
): () => void {
  const unsubscribes: Unsubscribe[] = [];
  const on = (events as EventsAny).on.bind(events);

  for (const bridge of bridges) {
    const off = on(bridge.appEvent, async (payload: unknown, ctx: EventContext) => {
      const roomName = typeof bridge.room === 'function' ? bridge.room(payload, ctx) : bridge.room;
      const type =
        bridge.type === undefined
          ? ctx.event
          : typeof bridge.type === 'function'
            ? bridge.type(ctx)
            : bridge.type;
      const data = bridge.map ? bridge.map(payload, ctx) : payload;
      await realtime.room(roomName).broadcast({ type, payload: data });
    });
    unsubscribes.push(off);
  }

  return () => {
    for (const off of unsubscribes) {
      try {
        off();
      } catch {
        // best-effort detach
      }
    }
  };
}

/** Internal helper type: subscribe by dynamic (possibly wildcard) event name. */
type EventsAny = {
  on(
    name: string,
    listener: (payload: unknown, ctx: EventContext) => void | Promise<void>,
  ): Unsubscribe;
};
