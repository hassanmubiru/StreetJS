/**
 * @streetjs/workflow — Events bridge (Pillar 3, Requirement 17).
 *
 * This module wires the workflow engine to `@streetjs/events` through the purely
 * STRUCTURAL {@link EventsLike} contract defined in `../types.js`. It imports no
 * pillar package: any object exposing `publish`/`waitFor`/`subscribe` (the
 * `@streetjs/events` facade does) satisfies the shape structurally, so the base
 * package keeps its single `streetjs` runtime dependency and there is neither a
 * hard dependency nor a circular dependency on `@streetjs/events`
 * (Requirement 17.4). A live `@streetjs/events` instance satisfies `EventsLike`
 * structurally with no adapter.
 *
 * {@link bridgeWorkflowEvents} produces the `ctx.events` ({@link EventsContext})
 * surface handed to a Workflow_Function, with the behavior mandated by
 * Requirement 17:
 *
 *  - 17.1 When wired, `publish(event, payload)` publishes through the
 *         `EventsLike` bridge.
 *  - 17.2 When wired, `waitFor(event)` parks the run as `waiting` until a
 *         matching event arrives, then continues with the (optionally parsed)
 *         typed payload. The waiting intent is surfaced to the runtime through
 *         the optional `onWaitFor` callback so the Coordinator can persist the
 *         `waiting` Run_Status and the awaited event name.
 *  - 17.3 When wired, `subscribe(event, handler)` delivers each matching event
 *         to the supplied handler and returns an unsubscribe function.
 *  - 17.4 No hard/circular dependency on `@streetjs/events` — the bridge depends
 *         only on the structural {@link EventsLike} shape.
 *  - 17.5 `publish` is fire-and-forget: a failure is caught (never rethrown) and
 *         surfaced to the runtime through the optional `onPublishFailure`
 *         callback so it can record a `publish.failed` History event, and the
 *         Workflow_Run continues WITHOUT retrying the publication.
 *
 * When no bridge is wired, any `ctx.events` operation yields a descriptive
 * {@link WorkflowConfigError} naming the `events` bridge and the attempted
 * operation, mirroring the storage and queue bridges.
 *
 * The canonical `EventsLike` / `EventsContext` definitions live in
 * `../types.js`; this module re-exports `EventsLike` for convenience only.
 *
 * _Requirements: 17.1, 17.3, 17.4, 17.5_
 */

import { WorkflowConfigError } from "../errors.js";
import type { EventsContext, EventsLike } from "../types.js";

// Convenience re-export; the canonical definition remains in `../types.js`.
export type { EventsLike } from "../types.js";

/**
 * Runtime coordination hooks the Events bridge invokes so the surrounding engine
 * can react to fire-and-forget publish failures and waiting intents without the
 * bridge itself owning journaling or Run_Status transitions.
 */
export interface WorkflowEventsBridgeHooks {
  /**
   * Invoked when a wired `publish` rejects or throws. The bridge catches the
   * failure and never rethrows (Requirement 17.5); the runtime uses this hook to
   * record a `publish.failed` History event and continue the run without
   * retrying the publication.
   */
  readonly onPublishFailure?: (event: string, error: unknown) => void;
  /**
   * Invoked when `waitFor` is entered, before the awaited event resolves, so the
   * runtime can park the Workflow_Run as `waiting` and persist the awaited event
   * name (Requirement 17.2).
   */
  readonly onWaitFor?: (event: string) => void;
}

/**
 * The events surface the bridge exposes to the rest of the engine.
 *
 * `events` is the `ctx.events` surface passed to a Workflow_Function; `wired`
 * reflects whether a structural {@link EventsLike} bridge was supplied in
 * configuration, mirroring the {@link WorkflowQueueBridge} `wired` flag.
 */
export interface WorkflowEventsBridge {
  /** The `ctx.events` surface (Requirement 17). */
  readonly events: EventsContext;
  /** Whether a structural `EventsLike` bridge was supplied. */
  readonly wired: boolean;
}

/**
 * Build the workflow Events bridge from an optional structural {@link EventsLike}.
 *
 * Passing `undefined` (no bridge configured) returns a surface whose every
 * operation throws a descriptive {@link WorkflowConfigError} naming the `events`
 * bridge, so a Workflow_Run that never calls `ctx.events` runs unchanged while a
 * misconfigured call fails loudly and precisely.
 *
 * @param events - A live `@streetjs/events` instance or any object matching the
 *   {@link EventsLike} shape; omit to run without an events bridge.
 * @param hooks - Optional runtime coordination hooks used to surface
 *   fire-and-forget publish failures (Requirement 17.5) and waiting intents
 *   (Requirement 17.2) to the engine without the bridge owning journaling.
 */
export function bridgeWorkflowEvents(
  events?: EventsLike,
  hooks?: WorkflowEventsBridgeHooks,
): WorkflowEventsBridge {
  const wired = events !== undefined;

  /** Raise the descriptive misconfiguration error for an unwired bridge. */
  function unwired(operation: string): never {
    throw new WorkflowConfigError(
      `ctx.events.${operation} was called but no EventsLike bridge is wired; ` +
        "supply `bridges.events` in the workflow configuration to use ctx.events.",
      { bridge: "events", operation },
    );
  }

  const eventsContext: EventsContext = {
    async publish(event: string, payload: unknown): Promise<void> {
      if (events === undefined) {
        unwired("publish");
      }
      // Fire-and-forget: isolate any failure, surface it for a `publish.failed`
      // History event, and continue the run WITHOUT retrying (Requirement 17.5).
      try {
        await events.publish(event, payload);
      } catch (error) {
        hooks?.onPublishFailure?.(event, error);
      }
    },

    async waitFor<P>(
      event: string,
      options?: { parse?: (p: unknown) => P },
    ): Promise<P> {
      if (events === undefined) {
        unwired("waitFor");
      }
      // Surface the waiting intent so the runtime can park the run as `waiting`
      // and persist the awaited event name (Requirement 17.2).
      hooks?.onWaitFor?.(event);
      const payload = await events.waitFor(event);
      // Continue with the typed payload, applying the optional parser.
      return options?.parse ? options.parse(payload) : (payload as P);
    },

    subscribe(event: string, handler: (payload: unknown) => void): () => void {
      if (events === undefined) {
        unwired("subscribe");
      }
      // Deliver each matching event to the handler; return the unsubscribe fn
      // produced by the underlying bridge (Requirement 17.3).
      return events.subscribe(event, handler);
    },
  };

  return { events: eventsContext, wired };
}
