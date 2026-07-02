// src/middleware.ts
// @streetjs/queue — the composable middleware pipeline (Req 10.1–10.4).
//
// Middleware wrap one job execution as a `(ctx, payload, next)` chain used for
// logging, metrics, tracing, authorization, and tenant isolation. This module
// owns the single source of truth for how that chain is composed: middleware
// run in registration order, each receiving the `JobExecutionContext`, the
// payload, and a `next` continuation, with the registered handler as the
// terminal step once every middleware has called `next` (Req 10.2, 10.3). A
// middleware that calls `next()` more than once is rejected.
//
// The worker composes its per-execution runner through {@link composeMiddleware}
// (see `worker.ts`), so the composition logic lives in exactly one place.

import type { JobExecutionContext, JobHandler } from './job.js';

/** Composable pipeline around one job execution. */
export type QueueMiddleware = (
  ctx: JobExecutionContext,
  payload: unknown,
  next: () => Promise<void>,
) => Promise<void>;

/**
 * A mutable view of the {@link JobExecutionContext}. The public context declares
 * `tenantId` (and every other field) `readonly`, but the object the worker
 * builds and threads through the pipeline is a single mutable instance so that
 * tenant-isolation middleware can assign `ctx.tenantId` and have it observed by
 * every subsequent middleware and the terminal handler (Req 10.4). Callers keep
 * the public readonly surface; only the worker/composer operate on this view.
 */
export type MutableContext = {
  -readonly [K in keyof JobExecutionContext]: JobExecutionContext[K];
};

/**
 * The composed runner for one job execution: it drives the whole middleware
 * chain and the terminal handler against a single context/payload. The worker
 * calls this once per reserved job.
 */
export type ComposedRunner = (
  ctx: JobExecutionContext,
  payload: unknown,
) => Promise<void>;

/**
 * Compose a middleware `chain` with a terminal `handler` into a single runner
 * (Req 10.1–10.3).
 *
 * The returned runner invokes the middleware in registration order — each
 * receiving the same `ctx`, the `payload`, and a `next` continuation — and runs
 * the `handler` as the terminal step once every middleware has called `next`.
 * Because the identical `ctx` reference is threaded through the whole chain, a
 * `tenantId` (or any other field) set by an earlier middleware is visible to
 * later middleware and to the handler for the remainder of the execution
 * (Req 10.4).
 *
 * Guard: calling `next()` more than once from a single middleware is a
 * programming error and rejects with a descriptive message rather than
 * re-running the downstream chain.
 */
export function composeMiddleware(
  chain: readonly QueueMiddleware[],
  handler: JobHandler<unknown>,
): ComposedRunner {
  return async (ctx: JobExecutionContext, payload: unknown): Promise<void> => {
    let lastIndex = -1;

    const invoke = async (index: number): Promise<void> => {
      if (index <= lastIndex) {
        throw new Error('next() called multiple times in a queue middleware.');
      }
      lastIndex = index;
      const middleware = chain[index];
      if (middleware) {
        await middleware(ctx, payload, () => invoke(index + 1));
      } else {
        await handler(payload, ctx);
      }
    };

    await invoke(0);
  };
}
