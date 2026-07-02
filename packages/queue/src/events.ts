// src/events.ts
// @streetjs/queue — typed lifecycle event map and a minimal typed emitter
// (Req 1.6, 11.1–11.5).
//
// Every event carries the execution context. The worker/retry transitions that
// emit these events are wired in task 11.1; this module provides the typed map
// and a small emitter the facade owns.

import type { JobExecutionContext, SerializedError } from './job.js';

/** Typed lifecycle event map. Every event carries the execution context. */
export interface QueueEventMap {
  'job.started': { ctx: JobExecutionContext };
  'job.completed': { ctx: JobExecutionContext; durationMs: number };
  /** Terminal event emitted when a job is moved to the dead-letter queue. */
  'job.failed': { ctx: JobExecutionContext; error: SerializedError };
  'job.retry': {
    ctx: JobExecutionContext;
    error: SerializedError;
    nextRunAt: number;
    nextAttempt: number;
  };
  'job.timeout': { ctx: JobExecutionContext; timeoutMs: number };
}

/** A typed handler for a single lifecycle event. */
export type QueueEventHandler<K extends keyof QueueEventMap> = (e: QueueEventMap[K]) => void;

/** A small strongly-typed event emitter over {@link QueueEventMap}. */
export class QueueEventEmitter {
  private readonly handlers = new Map<keyof QueueEventMap, Set<(e: unknown) => void>>();

  /** Subscribe to a lifecycle event. */
  on<K extends keyof QueueEventMap>(event: K, handler: QueueEventHandler<K>): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as (e: unknown) => void);
  }

  /** Unsubscribe a previously registered handler. A no-op when it was never registered. */
  off<K extends keyof QueueEventMap>(event: K, handler: QueueEventHandler<K>): void {
    const set = this.handlers.get(event);
    if (!set) return;
    set.delete(handler as (e: unknown) => void);
    if (set.size === 0) {
      this.handlers.delete(event);
    }
  }

  /**
   * Emit a lifecycle event to all subscribers.
   *
   * Observability must never destabilize processing (Req 11.x): a subscriber
   * that throws MUST NOT prevent the remaining subscribers from receiving the
   * event, nor propagate back into the worker/retry transitions that emit it
   * (e.g. a throwing `job.completed` handler must not be mistaken for a job
   * failure). Each handler is therefore invoked in isolation and any thrown
   * value is swallowed. Handlers are copied before iteration so a subscriber
   * that mutates the subscription set during dispatch cannot corrupt the loop.
   */
  emit<K extends keyof QueueEventMap>(event: K, payload: QueueEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        (handler as QueueEventHandler<K>)(payload);
      } catch {
        // A misbehaving subscriber must not break event delivery or the worker
        // loop. Intentionally swallow; lifecycle events are best-effort.
      }
    }
  }
}
