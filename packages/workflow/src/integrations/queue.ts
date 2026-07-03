/**
 * @streetjs/workflow — Queue bridge (Pillar 2).
 *
 * This module wires the workflow engine to `@streetjs/queue` through the
 * purely STRUCTURAL {@link QueueLike} contract defined in `../types.js`. It
 * imports no pillar package: any object exposing a `dispatch(job, payload)`
 * method (the `@streetjs/queue` facade does) satisfies the shape structurally,
 * so the base package keeps its single `streetjs` runtime dependency and there
 * is neither a hard dependency nor a circular dependency on `@streetjs/queue`
 * (Requirement 16.3).
 *
 * {@link bridgeWorkflowQueue} produces the `ctx.queue` ({@link QueueContext})
 * surface handed to a Workflow_Function and a `runActivity` helper the Activity
 * Executor uses to run `viaQueue` activities. Two guarantees follow the
 * requirements:
 *
 * - When a bridge is wired, `ctx.queue.dispatch` dispatches a background job and
 *   returns the dispatched jobId (Requirement 16.1); a `viaQueue` activity runs
 *   through `@streetjs/queue` and produces an observationally equivalent
 *   recorded result to a direct run (Requirements 16.2, 16.5).
 * - When no bridge is wired, runs that never touch `ctx.queue` proceed unchanged
 *   (Requirement 16.4); a `ctx.queue.dispatch` call with no wired bridge yields a
 *   descriptive {@link WorkflowConfigError}.
 *
 * _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5_
 */

import { WorkflowConfigError } from "./errors.js";
import type { Activity, QueueContext, QueueLike } from "./types.js";

/**
 * The queue surface the bridge exposes to the rest of the engine.
 *
 * `queue` is the journaled `ctx.queue` surface passed to a Workflow_Function.
 * `runActivity` is the Executor-facing helper that runs an activity either
 * through the queue (when the activity opts in via `viaQueue` and the wired
 * bridge supports `execute`) or directly, always yielding an observationally
 * equivalent result (Requirements 16.2, 16.5). `wired` reflects whether a
 * `QueueLike` bridge was supplied in configuration.
 */
export interface WorkflowQueueBridge {
  /** The `ctx.queue` surface (Requirement 16.1). */
  readonly queue: QueueContext;
  /** Whether a structural `QueueLike` bridge was supplied. */
  readonly wired: boolean;
  /**
   * Run a single activity attempt, routing through `@streetjs/queue` when the
   * activity opts into queue execution and the wired bridge supports it, and
   * otherwise running it directly. The recorded result is observationally
   * equivalent either way (Requirements 16.2, 16.5).
   */
  runActivity<Out>(
    activity: Activity<Out>,
    options?: { readonly viaQueue?: boolean; readonly signal?: AbortSignal },
  ): Promise<Out>;
}

/**
 * Build the workflow Queue bridge from an optional structural {@link QueueLike}.
 *
 * Passing `undefined` (no bridge configured) returns a surface whose
 * `ctx.queue.dispatch` throws a descriptive {@link WorkflowConfigError} while
 * leaving `runActivity` fully functional via direct execution, so a
 * Workflow_Run that never calls `ctx.queue` runs unchanged (Requirement 16.4).
 *
 * @param queue - A live `@streetjs/queue` instance or any object matching the
 *   {@link QueueLike} shape; omit to run without a queue bridge.
 */
export function bridgeWorkflowQueue(queue?: QueueLike): WorkflowQueueBridge {
  const wired = queue !== undefined;

  const queueContext: QueueContext = {
    async dispatch(job: string, payload: unknown): Promise<string> {
      if (queue === undefined) {
        throw new WorkflowConfigError(
          `ctx.queue.dispatch("${job}") was called but no QueueLike bridge is wired; ` +
            "supply `bridges.queue` in the workflow configuration to dispatch background jobs.",
          { bridge: "queue", operation: "dispatch" },
        );
      }
      // The bridge returns the dispatched jobId to the Workflow_Function (16.1).
      return queue.dispatch(job, payload);
    },
  };

  return {
    queue: queueContext,
    wired,
    async runActivity<Out>(
      activity: Activity<Out>,
      options?: { readonly viaQueue?: boolean; readonly signal?: AbortSignal },
    ): Promise<Out> {
      // Route through the queue only when the activity opts in AND the wired
      // bridge supports optional execution; otherwise run directly. Both paths
      // resolve to the same observable result (Requirements 16.2, 16.5).
      if (options?.viaQueue === true && queue?.execute !== undefined) {
        return queue.execute<Out>((signal) => Promise.resolve(activity(signal)));
      }
      const signal = options?.signal ?? new AbortController().signal;
      return activity(signal);
    },
  };
}
