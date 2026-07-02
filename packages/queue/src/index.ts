// src/index.ts
// @streetjs/queue — public typed surface (Req 1.5, 1.6, 13.1).
//
// Every exported symbol carries explicit TypeScript type declarations. The
// Redis driver (`RedisDriver` / `RedisDriverOptions`) is intentionally NOT
// re-exported here — it is available only via the `@streetjs/queue/redis`
// submodule so Memory-driver users pull in no extra runtime deps (Req 1.3).
//
// Core primitives (`HealthCheckRegistry`, `MetricsRegistry`, `RateLimitStore`,
// `Clock`) are consumed from the `streetjs` entry point (see facade.ts); this
// package adds no core changes and depends only on already-exported symbols
// (Req 1.5).

// ── Job definition, options, envelope, and execution context ──────────────────
export { Job } from './job.js';
export type {
  BackoffPolicy,
  JobOptions,
  JobHandler,
  JobExecutionContext,
  JobEnvelope,
  DeadLetterRecord,
  SerializedError,
} from './job.js';

// ── Queue facade ──────────────────────────────────────────────────────────────
export { createQueue } from './facade.js';
export type { Queue, QueueOptions, DeadLetterApi } from './facade.js';

// ── Scheduler (delayed promotion + cron) ──────────────────────────────────────
export { Scheduler, CronParseError } from './scheduler.js';
export type {
  SchedulerOptions,
  SchedulerLock,
  LockAcquisition,
  ScheduledJob,
} from './scheduler.js';

// ── Worker ────────────────────────────────────────────────────────────────────
export type { Worker, WorkerOptions, WorkerStatus } from './worker.js';

// ── Pluggable driver contract + default in-process driver ─────────────────────
export { MemoryDriver } from './drivers/memory.js';
export type { QueueDriver, Reservation, QueueStats } from './drivers/driver.js';

// ── Middleware pipeline ───────────────────────────────────────────────────────
export type { QueueMiddleware } from './middleware.js';

// ── Typed lifecycle events ────────────────────────────────────────────────────
export type { QueueEventMap } from './events.js';

// ── Plugin registration ───────────────────────────────────────────────────────
export { QueuePlugin } from './plugin.js';
