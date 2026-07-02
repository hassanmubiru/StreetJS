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

  /** Emit a lifecycle event to all subscribers. */
  emit<K extends keyof QueueEventMap>(event: K, payload: QueueEventMap[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      (handler as QueueEventHandler<K>)(payload);
    }
  }
}
