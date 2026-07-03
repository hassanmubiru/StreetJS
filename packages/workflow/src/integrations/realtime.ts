/**
 * @streetjs/workflow — Realtime bridge (Pillar 1, Requirement 18).
 *
 * This module wires the workflow engine to `@streetjs/realtime` through the
 * purely STRUCTURAL {@link RealtimeLike} contract defined in `../types.js`. It
 * imports no pillar package: any object exposing a
 * `broadcast(channel, event, payload)` method (the `@streetjs/realtime` facade
 * does) satisfies the shape structurally, so the base package keeps its single
 * `streetjs` runtime dependency and declares no hard, optional, or peer
 * dependency on the realtime pillar (Requirement 18.3). A live
 * `@streetjs/realtime` instance satisfies `RealtimeLike` structurally with no
 * adapter.
 *
 * {@link bridgeWorkflowRealtime} produces the `ctx.realtime`
 * ({@link RealtimeContext}) surface handed to a Workflow_Function plus a
 * `broadcastLifecycle` helper the engine/runtime calls on run transitions. Its
 * guarantees follow the requirements:
 *
 *  - 18.1 When a `RealtimeLike` bridge is wired, `ctx.realtime.broadcast`
 *         broadcasts the payload on the channel through the bridge. The
 *         {@link RealtimeContext} surface takes `(channel, payload)` while the
 *         structural bridge takes `(channel, event, payload)`, so the channel
 *         broadcast is mapped onto the bridge with a sensible default event
 *         name ({@link DEFAULT_BROADCAST_EVENT}).
 *  - 18.2 When a Workflow_Run transitions, `broadcastLifecycle` broadcasts the
 *         corresponding lifecycle event (`workflow.started`,
 *         `workflow.progress`, `workflow.completed`, `workflow.failed`, or
 *         `workflow.cancelled`) carrying the Workflow_Run_Id.
 *  - 18.3 No hard dependency on `@streetjs/realtime`: this module depends only
 *         on the structural `RealtimeLike` shape.
 *  - 18.4 When no bridge is wired, runs proceed without broadcasting and
 *         without error: `broadcastLifecycle` is a silent no-op. A direct
 *         `ctx.realtime.broadcast` call with no bridge wired still yields a
 *         descriptive {@link WorkflowConfigError} consistent with the other
 *         bridges.
 *
 * Realtime broadcasting is best-effort (see the "Graceful degradation of
 * bridges" note in the design): once a bridge is wired, a broadcast failure is
 * swallowed and never propagates into or halts the Workflow_Run.
 *
 * The canonical `RealtimeLike` / `RealtimeContext` definitions live in
 * `../types.js`; this module re-exports `RealtimeLike` for convenience only.
 *
 * _Requirements: 18.1, 18.2, 18.3, 18.4_
 */

import { WorkflowConfigError } from "../errors.js";
import type { RealtimeContext, RealtimeLike } from "../types.js";

// Convenience re-export; the canonical definition remains in `../types.js`.
export type { RealtimeLike } from "../types.js";

/**
 * The default event name used when mapping the `(channel, payload)` shape of
 * {@link RealtimeContext.broadcast} onto the `(channel, event, payload)` shape
 * of {@link RealtimeLike.broadcast}. A caller of `ctx.realtime.broadcast`
 * supplies only a channel and payload, so the bridge tags the broadcast with
 * this stable, descriptive event name.
 */
export const DEFAULT_BROADCAST_EVENT = "workflow.broadcast";

/**
 * The channel on which Workflow_Run lifecycle transitions are broadcast
 * (Requirement 18.2). Lifecycle broadcasts are tagged with a
 * {@link WorkflowLifecycleEvent} and carry the runId in their payload.
 */
export const WORKFLOW_LIFECYCLE_CHANNEL = "workflow";

/**
 * The lifecycle events broadcast on a Workflow_Run transition (Requirement
 * 18.2). One of these is emitted as the `event` on
 * {@link WORKFLOW_LIFECYCLE_CHANNEL} whenever the run's status advances.
 */
export type WorkflowLifecycleEvent =
  | "workflow.started"
  | "workflow.progress"
  | "workflow.completed"
  | "workflow.failed"
  | "workflow.cancelled";

/**
 * The realtime surface the bridge exposes to the rest of the engine.
 *
 * `realtime` is the `ctx.realtime` surface passed to a Workflow_Function
 * (Requirement 18.1). `broadcastLifecycle` is the engine/runtime-facing helper
 * invoked on run transitions to broadcast lifecycle events carrying the runId
 * (Requirement 18.2). `wired` reflects whether a `RealtimeLike` bridge was
 * supplied in configuration.
 */
export interface WorkflowRealtimeBridge {
  /** The `ctx.realtime` surface (Requirement 18.1). */
  readonly realtime: RealtimeContext;
  /** Whether a structural `RealtimeLike` bridge was supplied. */
  readonly wired: boolean;
  /**
   * Broadcast a Workflow_Run lifecycle event carrying the runId on the
   * lifecycle channel (Requirement 18.2). When no bridge is wired this is a
   * silent no-op so runs proceed unaffected (Requirement 18.4). Broadcast
   * failures are swallowed and never propagate into the run (best-effort).
   *
   * @param event - The lifecycle event to broadcast.
   * @param runId - The Workflow_Run_Id the event pertains to.
   * @param extra - Optional additional payload fields merged with the runId.
   */
  broadcastLifecycle(
    event: WorkflowLifecycleEvent,
    runId: string,
    extra?: Record<string, unknown>,
  ): Promise<void>;
}

/**
 * Build the workflow Realtime bridge from an optional structural
 * {@link RealtimeLike}.
 *
 * Passing `undefined` (no bridge configured) returns a surface whose
 * `ctx.realtime.broadcast` throws a descriptive {@link WorkflowConfigError}
 * while leaving `broadcastLifecycle` a silent no-op, so a Workflow_Run that
 * never calls `ctx.realtime` runs unchanged and lifecycle transitions broadcast
 * nothing (Requirement 18.4).
 *
 * @param realtime - A live `@streetjs/realtime` instance or any object matching
 *   the {@link RealtimeLike} shape; omit to run without a realtime bridge.
 */
export function bridgeWorkflowRealtime(
  realtime?: RealtimeLike,
): WorkflowRealtimeBridge {
  const wired = realtime !== undefined;

  /**
   * Perform a best-effort broadcast through the wired bridge, swallowing any
   * synchronous throw or rejected promise so a broadcast failure never
   * propagates into or halts the Workflow_Run (graceful degradation).
   */
  async function safeBroadcast(
    channel: string,
    event: string,
    payload: unknown,
  ): Promise<void> {
    if (realtime === undefined) {
      return;
    }
    try {
      // `broadcast` may return void or a promise; normalize and await both so a
      // rejected promise is caught here rather than surfacing to the run.
      await Promise.resolve(realtime.broadcast(channel, event, payload));
    } catch {
      // Best-effort: broadcast failures are intentionally ignored so the run
      // continues unaffected (Requirement 18.4 / graceful degradation).
    }
  }

  const realtimeContext: RealtimeContext = {
    async broadcast(channel: string, payload: unknown): Promise<void> {
      if (realtime === undefined) {
        throw new WorkflowConfigError(
          `ctx.realtime.broadcast("${channel}") was called but no RealtimeLike bridge is wired; ` +
            "supply `bridges.realtime` in the workflow configuration to broadcast to connected clients.",
          { bridge: "realtime", operation: "broadcast" },
        );
      }
      // Map the (channel, payload) surface onto the structural
      // (channel, event, payload) bridge with a default event name (18.1).
      await safeBroadcast(channel, DEFAULT_BROADCAST_EVENT, payload);
    },
  };

  return {
    realtime: realtimeContext,
    wired,
    async broadcastLifecycle(
      event: WorkflowLifecycleEvent,
      runId: string,
      extra?: Record<string, unknown>,
    ): Promise<void> {
      // Absence of a bridge means no broadcasts; the run proceeds unaffected
      // (Requirement 18.4).
      if (realtime === undefined) {
        return;
      }
      const payload = { ...extra, runId, event };
      await safeBroadcast(WORKFLOW_LIFECYCLE_CHANNEL, event, payload);
    },
  };
}
