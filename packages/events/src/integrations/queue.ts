// src/integrations/queue.ts
// @streetjs/events — bridge from @streetjs/queue lifecycle events into the
// application event layer, e.g.
//
//   queue.on('job.completed', ...) ──▶ events.publish('report.generated', ...)
//
// The bridge depends only on a STRUCTURAL interface (`QueueLike`), never on
// `@streetjs/queue` itself, so the events package keeps its single `streetjs`
// runtime dependency and there is no circular package dependency. Any object
// exposing `on(event, handler)` (the queue facade does) can be bridged.

import type { AnyEventMap, EventMap } from '../event.js';
import type { Events } from '../facade.js';

/**
 * The minimal shape the bridge needs from a queue: a lifecycle-event
 * subscription method. The `@streetjs/queue` `Queue` facade satisfies this
 * (`queue.on('job.completed', handler)`).
 */
export interface QueueLike {
  on(event: string, handler: (payload: unknown) => void): unknown;
}

/**
 * One mapping from a queue lifecycle event to an application event. When the
 * queue fires `queueEvent`, the bridge publishes `appEvent` with either the raw
 * queue payload or the result of `map`.
 */
export interface QueueEventBridge {
  /** The queue lifecycle event to subscribe to (e.g. `'job.completed'`). */
  queueEvent: string;
  /** The application event name to publish. */
  appEvent: string;
  /** Transform the queue event payload into the app event payload. */
  map?: (queuePayload: unknown) => unknown;
  /**
   * Publish synchronously (awaited) instead of fire-and-forget. Default `false`
   * (fire-and-forget) so a slow application listener never back-pressures the
   * queue's worker loop.
   */
  awaitPublish?: boolean;
}

/**
 * Wire queue lifecycle events into the application event layer. Registers one
 * subscription on `queue` per bridge; each fired queue event publishes the
 * mapped application event on `events`.
 *
 * Returns a best-effort detach function: if the queue's `on` returns an
 * unsubscribe function it is invoked, otherwise detach is a no-op (queue
 * bridging is normally startup wiring that lives for the process).
 *
 * ```ts
 * bridgeQueueEvents(queue, events, [
 *   { queueEvent: 'job.completed', appEvent: 'report.generated',
 *     map: (e) => (e as { ctx: { id: string } }).ctx },
 * ]);
 * ```
 */
export function bridgeQueueEvents<T extends AnyEventMap = EventMap>(
  queue: QueueLike,
  events: Events<T>,
  bridges: readonly QueueEventBridge[],
): () => void {
  const detachers: Array<() => void> = [];

  for (const bridge of bridges) {
    const handler = (queuePayload: unknown): void => {
      const payload = bridge.map ? bridge.map(queuePayload) : queuePayload;
      if (bridge.awaitPublish) {
        // Fire the awaited publish but do not block the queue callback on it;
        // errors are already isolated per-listener inside the facade.
        void (events as EventsAny).publish(bridge.appEvent, payload);
      } else {
        (events as EventsAny).publishAsync(bridge.appEvent, payload);
      }
    };

    const maybeUnsub = queue.on(bridge.queueEvent, handler);
    if (typeof maybeUnsub === 'function') {
      detachers.push(maybeUnsub as () => void);
    }
  }

  return () => {
    for (const detach of detachers) {
      try {
        detach();
      } catch {
        // best-effort detach
      }
    }
  };
}

/**
 * Internal helper type: the bridge publishes to dynamically-named app events, so
 * it addresses the facade through its untyped-name publish surface. Consumers of
 * `bridgeQueueEvents` keep full typing on their own `on` subscriptions.
 */
type EventsAny = {
  publish(name: string, payload: unknown): Promise<unknown>;
  publishAsync(name: string, payload: unknown): void;
};
