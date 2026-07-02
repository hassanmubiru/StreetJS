// src/tests/type-surface.test.ts
// Compile-time type-error assertion test for the @streetjs/queue public
// surface (Task 1.2). Validates Requirements 1.5 and 1.6:
//   - Req 1.6: every exported symbol carries explicit TypeScript type
//     declarations (typed job payloads, typed handlers, a typed event map).
//   - Req 1.5: importing a public symbol with an incorrect argument type
//     surfaces a TypeScript compile-time type error.
//
// Every `@ts-expect-error` below asserts that a wrong-typed usage of a public
// symbol is REJECTED by tsc. This is self-checking: if such a usage ever became
// valid, tsc would report an unused '@ts-expect-error' directive (TS2578) and
// the build — and therefore this test — would fail. The correctly-typed usages
// carry no directive and must compile cleanly. A passing `tsc` build is the
// proof that the expected type errors were correctly expected.
//
// These checks are purely static: the function hosting them is never invoked at
// runtime (the ambient fixtures below have no runtime binding). The runtime
// `node:test` case only confirms the file compiled and loaded.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createQueue, Job, MemoryDriver, QueuePlugin } from '../index.js';
import type {
  Queue,
  QueueDriver,
  QueueMiddleware,
  JobHandler,
  JobExecutionContext,
  JobEnvelope,
  DeadLetterRecord,
  DeadLetterApi,
  SerializedError,
  BackoffPolicy,
  Reservation,
  QueueStats,
  Worker,
  WorkerStatus,
  WorkerOptions,
} from '../index.js';

/** A strongly-typed job whose payload shape is fixed by the subclass. */
interface EmailPayload {
  to: string;
  subject: string;
}
class EmailJob extends Job<EmailPayload> {
  readonly type = 'email.send';
}

// Ambient, type-only fixtures — these emit no runtime binding and the hosting
// function is never called, so they exist purely to type-check the surface.
declare const queue: Queue;
declare const driver: QueueDriver;
declare const backoff: BackoffPolicy;
declare const envelope: JobEnvelope;
declare const record: DeadLetterRecord;
declare const err: SerializedError;
declare const stats: QueueStats;
declare const reservation: Reservation;
declare const worker: Worker;
declare const workerStatus: WorkerStatus;
declare const workerOptions: WorkerOptions;
declare const dlq: DeadLetterApi;
declare const mw: QueueMiddleware;
declare const handler: JobHandler<EmailPayload>;
declare const ctx: JobExecutionContext;

/**
 * Hosts the static type assertions. Exported so `noUnusedLocals` treats it as
 * used; it is never actually called (all assertions are compile-time only).
 */
export function __publicSurfaceTypeAssertions(): void {
  // ── Every exported type is importable and carries declarations (Req 1.6) ────
  void backoff.strategy;
  void envelope.id;
  void record.error;
  void err.message;
  void stats.ready;
  void reservation.token;
  void worker.status;
  void workerStatus.running;
  void workerOptions.concurrency;
  void dlq.list;
  void mw;
  void ctx.id;

  // ── createQueue(options): QueueOptions is typed (Req 1.5, 1.6) ──────────────
  // Correctly typed options.
  const q: Queue = createQueue({ defaultQueue: 'default' });
  void q;
  // @ts-expect-error - defaultQueue must be a string, not a number
  createQueue({ defaultQueue: 123 });
  // @ts-expect-error - `concurrency` is not a QueueOptions field
  createQueue({ concurrency: 4 });

  // ── Typed job payloads: Job<TPayload> constructor rejects a bad payload ─────
  // Correctly typed job instance.
  new EmailJob({ to: 'a@b.com', subject: 'hi' });
  // @ts-expect-error - `to` must be a string; payload must match EmailPayload
  new EmailJob({ to: 123, subject: 'hi' });
  // @ts-expect-error - `subject` is a required field of EmailPayload
  new EmailJob({ to: 'a@b.com' });

  // ── dispatch(job, options): requires a Job, and JobOptions is typed (Req 2.1)
  // Correctly typed dispatch with typed options.
  void queue.dispatch(new EmailJob({ to: 'a@b.com', subject: 'hi' }), {
    priority: 10,
    queue: 'emails',
  });
  // @ts-expect-error - dispatch requires a Job instance, not a bare string
  void queue.dispatch('email.send');
  // @ts-expect-error - priority must be a number, not a string
  void queue.dispatch(new EmailJob({ to: 'a@b.com', subject: 'hi' }), { priority: 'high' });

  // ── register(type, handler): type is a string, handler is typed (Req 2.3) ───
  // Correctly typed handler receives the typed payload and context.
  queue.register<EmailPayload>('email.send', (payload, context) => {
    void payload.to;
    void context.id;
  });
  // @ts-expect-error - the job type must be a string, not a number
  queue.register(123, () => {});

  // ── on(event, handler): the QueueEventMap is a typed event map (Req 1.6) ────
  // Correctly typed: `job.completed` carries a numeric `durationMs`.
  queue.on('job.completed', (e) => {
    const ms: number = e.durationMs;
    void ms;
  });
  queue.on('job.started', (e) => {
    // @ts-expect-error - `job.started` has no `durationMs` field
    const ms: number = e.durationMs;
    void ms;
  });
  // @ts-expect-error - 'job.nonexistent' is not a key of QueueEventMap
  queue.on('job.nonexistent', () => {});

  // ── use(middleware): middleware must match the QueueMiddleware shape ─────────
  // Correctly typed middleware.
  queue.use(async (context, _payload, next) => {
    void context.id;
    await next();
  });
  // @ts-expect-error - a number is not a QueueMiddleware
  queue.use(42);

  // ── QueueDriver.reserve(queues, visibilityMs, now): typed args (Req 13.1) ────
  const d: QueueDriver = new MemoryDriver();
  // Correctly typed reservation call.
  void d.reserve(['default'], 30_000, Date.now());
  // @ts-expect-error - `queues` must be a string[], not a single string
  void driver.reserve('default', 30_000, Date.now());

  // ── QueuePlugin(options): constructor options are typed (Req 1.4, 1.5) ──────
  // Correctly typed construction (options optional).
  new QueuePlugin();
  new QueuePlugin({ defaultQueue: 'emails' });
  // @ts-expect-error - defaultQueue must be a string, not a number
  new QueuePlugin({ defaultQueue: 123 });

  // Reference the typed handler fixture in a matching position.
  queue.register<EmailPayload>('email.send', handler);
}

test('public surface: wrong-typed usages are rejected at compile time', () => {
  // If this file compiled, every `@ts-expect-error` above matched a real type
  // error and every correctly-typed usage type-checked. Confirm the guard loaded.
  assert.equal(typeof __publicSurfaceTypeAssertions, 'function');
});
