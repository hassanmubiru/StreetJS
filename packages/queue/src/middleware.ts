// src/middleware.ts
// @streetjs/queue — the composable middleware pipeline type (Req 10.1–10.4).
//
// Middleware wrap one job execution as a `(ctx, payload, next)` chain used for
// logging, metrics, tracing, authorization, and tenant isolation. The composer
// and its wiring into the worker land in task 10.1.

import type { JobExecutionContext } from './job.js';

/** Composable pipeline around one job execution. */
export type QueueMiddleware = (
  ctx: JobExecutionContext,
  payload: unknown,
  next: () => Promise<void>,
) => Promise<void>;
