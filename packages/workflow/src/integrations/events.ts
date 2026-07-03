/**
 * @streetjs/workflow — Events bridge (Pillar 3, Requirement 17).
 *
 * This module wires the workflow engine to `@streetjs/events` through the
 * purely STRUCTURAL {@link EventsLike} contract defined in `../types.js`. It
 * imports no pillar package: any object exposing `publish`/`waitFor`/`subscribe`
 * (the `@streetjs/events` facade does) satisfies the shape structurally, so the
 * base package keeps its single `streetjs` runtime dependency and declares no
 * hard, optional, or peer dependency on the events pillar and introduces no
 * circular dependency (Requirement 17.4). A live `@streetjs/events` instance
 * satisfies `EventsLike` structurally with no adapter.
 *
 * {@link bridgeWorkflowEvents} produces the `ctx.events` ({@link EventsContext})
 * surface handed to a Workflow_Function. Its guarantees follow the requirements:
 *
 *  - 17.1 When an `EventsLike` bridge is wired, `ctx.events.publish` publishes the
 *         event and payload through the bridge.
 *  - 17.2 `ctx.events.waitFor` parks the run as `waiting` until a matching event
 *         arrives and then continues with the typed event payload. The bridge
 *         surfaces this waiting intent to the runtime through the
 *         {@link WorkflowEventsBridgeHooks.onWaitFor} hook (mirroring how the
 *         sibling bridges expose a runtime-facing helper alongside their `ctx`
 *         surface) before awaiting the underlying `EventsLike.waitFor`.
 *  - 17.3 `ctx.events.subscribe` delivers each matching event to the supplied
 *         handler and returns the unsubscribe function.
 *  - 17.4 No hard dependency and no circular dependency on `@streetjs/events`:
 *         this module depends only on the structural `EventsLike` shape.
 *  - 17.5 `ctx.events.publish` is fire-and-forget: a publish failure is caught,
 *         surfaced to the runtime as a `publish.failed` History event via the
 *         {@link WorkflowEventsBridgeHooks.onPublishFailure} hook, and the run
 *         continues WITHOUT retrying the publication and WITHOUT the failure
 *         propagating into the Workflow_Function.
 *
 * As with the other bridges, a `ctx.events` call with no bridge wired yields a
 * descriptive {@link WorkflowConfigError} naming the bridge (`"events"`) and the
 * attempted operation.
 *
 * The canonical `EventsLike` / `EventsContext` definitions live in `../types.js`;
 * this module re-exports `EventsLike` for convenience only.
 *
 * _Requirements: 17.1, 17.3, 17.4, 17.5_
 */

import { WorkflowConfigError } from "../errors.js";
import type { EventsContext, EventsLike, SerializedError } from "../types.js";

// Convenience re-export; the canonical definition remains in `../types.js`.
export type { EventsLike } from "../types.js";

/**
 * Runtime-facing hooks the engine supplies so the bridge can surface intents and
 * failures it must not itself act upon.
 *
 * The `ctx.events` surface is called by the Workflow_Function, but the *effects*
 * of two of its operations belong to the runtime, not the bridge: recording a
 * publish failure in the History (17.5) and parking the run as `waiting` (17.2).
 * The bridge therefore surfaces those to the runtime through these hooks rather
 * than owning run state or the History, keeping it a thin structural adapter
 * consistent with the sibling bridges.
 */
export interface WorkflowEventsBridgeHooks {
  /**
   * Invoked when a fire-and-forget `ctx.events.publish` fails, so the runtime can
   * record a `publish.failed` History event. The failure is NOT rethrown and the
   * run continues without retrying the publication (Requirement 17.5).
   *
   * @param event - The event name whose publication failed.
   * @param error - The serialized publish failure.
   */
  readonly onPublishFailure?: (event: string, error: SerializedError) => void;
  /**
   * Invoked when `ctx.events.waitFor` is entered, before awaiting the matching
   * event, so the runtime can park the Workflow_Run as `waiting` on the named
   * event (Requirement 17.2).
   *
   * @param event - The event name the run is now waiting for.
   */
  readonly onWaitFor?: (event: string) => void;
}

/**
 * The events surface the bridge exposes to the rest of the engine.
 *
 * `events` is the `ctx.events` surface passed to a Workflow_Function
 * (Requirement 17). `wired` reflects whether an `EventsLike` bridge was supplied
 * in configuration, mirroring the `wired` flag on the sibling bridges.
 */
export interface WorkflowEventsBridge {
  /** The `ctx.events` surface (Requirement 17). */
  readonly events: EventsContext;
  /** Whether a structural `EventsLike` bridge was supplied. */
  readonly wired: boolean;
}

/**
 * Project an arbitrary thrown value into the JSON-safe {@link SerializedError}
 * shape recorded in the History, so a publish failure can be surfaced to the
 * runtime without leaking a live `Error` instance across the bridge boundary.
 */
function serializeError(err: unknown): SerializedError {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return { name: "Error", message: String(err) };
}

/**
 * Build the workflow Events bridge from an optional structural {@link EventsLike}.
 *
 * Passing `undefined` (no bridge configured) returns a surface whose
 * `publish`/`waitFor`/`subscribe` each throw a descriptive
 * {@link WorkflowConfigError}, so a Workflow_Run that never calls `ctx.events`
 * runs unchanged while any use of the surface without a wired bridge is surfaced
 * precisely.
 *
 * @param events - A live `@streetjs/events` instance or any object matching the
 *   {@link EventsLike} shape; omit to run without an events bridge.
 * @param hooks - Optional runtime hooks: `onPublishFailure` records a publish
 *   failure as a `publish.failed` History event (17.5) and `onWaitFor` lets the
 *   runtime park the run as `waiting` (17.2).
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
        "supply `bridges.events` in the workflow configuration to publish, wait for, or subscribe to events.",
      { bridge: "events", operation },
    );
  }

  const eventsContext: EventsContext = {
    async publish(event: string, payload: unknown): Promise<void> {
      if (events === undefined) {
        unwired("publish");
      }
      // Fire-and-forget: a publish failure is caught, surfaced for recording as a
      // `publish.failed` History event, and swallowed so the run continues
      // without retrying and without the failure propagating (Requirement 17.5).
      try {
        // `publish` may return void or a promise; normalize and await both so a
        // rejected promise is caught here rather than surfacing to the run.
        await Promise.resolve(events.publish(event, payload));
      } catch (err) {
        hooks?.onPublishFailure?.(event, serializeError(err));
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
      // on this event before we await its arrival (Requirement 17.2).
      hooks?.onWaitFor?.(event);
      const payload = await events.waitFor(event);
      // Continue with the typed event payload, applying the optional parser.
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

  return {
    events: eventsContext,
    wired,
  };
}
