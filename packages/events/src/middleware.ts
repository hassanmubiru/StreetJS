// src/middleware.ts
// @streetjs/events — the composable middleware pipeline that wraps the dispatch
// of a single published event (delivery to all its listeners).
//
// Middleware run ONCE per published event, in registration order, around
// delivery — the natural home for logging, metrics, tracing, tenant context,
// authorization, and audit. A middleware that does not call `next()` (or throws)
// vetoes delivery: unlike a listener failure (which is isolated), a middleware
// error propagates to the publisher, so middleware is the place for policy that
// should be able to block an event.

import type { Awaitable, EventContext } from './event.js';

/**
 * A composable pipeline step wrapping one event's dispatch. Receives the event
 * context, the (untyped) payload, and a `next` continuation that triggers the
 * remaining middleware and, finally, delivery to listeners. Enrich `ctx.metadata`
 * / `ctx.tenantId` to propagate context to later middleware and every listener.
 */
export type EventMiddleware = (
  ctx: EventContext,
  payload: unknown,
  next: () => Promise<void>,
) => Awaitable<void>;

/** The composed terminal delivery step (deliver the event to all listeners). */
export type DeliveryStep = (ctx: EventContext, payload: unknown) => Promise<void>;

/** A runner that executes the full middleware chain and terminal delivery. */
export type PipelineRunner = (ctx: EventContext, payload: unknown) => Promise<void>;

/**
 * Compose a middleware `chain` into a single runner whose terminal step is
 * `deliver`. Middleware run in registration order; each must call `next()` at
 * most once (calling it twice is a programming error and rejects). When every
 * middleware calls `next()`, `deliver` runs as the terminal step.
 */
export function composePipeline(
  chain: readonly EventMiddleware[],
  deliver: DeliveryStep,
): PipelineRunner {
  return (ctx: EventContext, payload: unknown): Promise<void> => {
    let lastIndex = -1;

    const invoke = async (index: number): Promise<void> => {
      if (index <= lastIndex) {
        throw new Error('next() called multiple times in an event middleware.');
      }
      lastIndex = index;

      const middleware = chain[index];
      if (middleware) {
        await middleware(ctx, payload, () => invoke(index + 1));
      } else {
        await deliver(ctx, payload);
      }
    };

    return invoke(0);
  };
}
