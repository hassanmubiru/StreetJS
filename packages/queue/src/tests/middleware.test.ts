// src/tests/middleware.test.ts
// Task 10.2 — unit tests for the middleware pipeline: registration-order
// execution with the handler as the terminal step, and tenant propagation of a
// `tenantId` set by an earlier middleware through the shared context for the
// rest of the execution.
// (Req 10.2, 10.3, 10.4)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMiddleware, type QueueMiddleware } from '../middleware.js';
import type { JobExecutionContext, JobHandler } from '../job.js';
import { createQueue } from '../facade.js';
import { Job } from '../job.js';

/** Build a minimal execution context for a direct composer test. */
function makeContext(overrides: Partial<JobExecutionContext> = {}): JobExecutionContext {
  return {
    id: 'job-1',
    type: 'demo',
    queue: 'default',
    attempt: 1,
    maxAttempts: 1,
    enqueuedAt: 0,
    tenantId: undefined,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** Await until `predicate` holds or the deadline passes. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// --- Direct composeMiddleware tests (deterministic, no worker/timers) ---------

test('middleware run in registration order with the handler as the terminal step (Req 10.2, 10.3)', async () => {
  const order: string[] = [];

  const mw = (label: string): QueueMiddleware => async (_ctx, _payload, next) => {
    order.push(`${label}-before`);
    await next();
    order.push(`${label}-after`);
  };

  let handlerRuns = 0;
  const handler: JobHandler<unknown> = async () => {
    handlerRuns += 1;
    order.push('handler');
  };

  const run = composeMiddleware([mw('mw1'), mw('mw2'), mw('mw3')], handler);
  await run(makeContext(), { any: 'payload' });

  // Onion ordering: before-hooks in registration order, the handler as the
  // terminal step, then after-hooks unwind in reverse registration order.
  assert.deepEqual(order, [
    'mw1-before',
    'mw2-before',
    'mw3-before',
    'handler',
    'mw3-after',
    'mw2-after',
    'mw1-after',
  ]);
  // The handler is the terminal step and runs exactly once.
  assert.equal(handlerRuns, 1);
});

test('with no middleware the handler is invoked directly as the terminal step (Req 10.3)', async () => {
  const seen: unknown[] = [];
  const handler: JobHandler<unknown> = async (payload) => {
    seen.push(payload);
  };

  const run = composeMiddleware([], handler);
  await run(makeContext(), { n: 42 });

  assert.deepEqual(seen, [{ n: 42 }]);
});

test('a tenantId set by middleware is visible to later middleware and the handler (Req 10.4)', async () => {
  const observed: Array<string | undefined> = [];

  // Tenant-isolation middleware assigns tenantId on the shared (mutable) context.
  // The public JobExecutionContext declares tenantId readonly, so we cast to
  // assign — mirroring how the worker threads a single mutable context object.
  const setTenant: QueueMiddleware = async (ctx, _payload, next) => {
    (ctx as { tenantId?: string }).tenantId = 'acme';
    await next();
  };

  // A later middleware reads the tenant the earlier middleware set.
  const readTenantMw: QueueMiddleware = async (ctx, _payload, next) => {
    observed.push(ctx.tenantId);
    await next();
  };

  let handlerTenant: string | undefined = 'unset';
  const handler: JobHandler<unknown> = async (_payload, ctx) => {
    handlerTenant = ctx.tenantId;
  };

  const ctx = makeContext();
  const run = composeMiddleware([setTenant, readTenantMw], handler);
  await run(ctx, {});

  // The later middleware and the handler both observe the tenant, and the shared
  // context retains it for the rest of the execution.
  assert.deepEqual(observed, ['acme']);
  assert.equal(handlerTenant, 'acme');
  assert.equal(ctx.tenantId, 'acme');
});

test('calling next() more than once from a middleware is rejected (Req 10.3)', async () => {
  const doubleNext: QueueMiddleware = async (_ctx, _payload, next) => {
    await next();
    await next();
  };
  const handler: JobHandler<unknown> = async () => {};

  const run = composeMiddleware([doubleNext], handler);
  await assert.rejects(() => run(makeContext(), {}), /next\(\) called multiple times/);
});

// --- Real-worker smoke test (middleware executed through the worker path) ------

class MiddlewareJob extends Job<{ note: string }> {
  readonly type = 'mw-demo';
  constructor(note: string) {
    super({ note });
  }
}

test('the worker executes handlers through the composed pipeline in registration order with tenant propagation (Req 10.2, 10.3, 10.4)', async () => {
  const queue = createQueue();
  const order: string[] = [];
  let handlerTenant: string | undefined = 'unset';
  let laterMwTenant: string | undefined = 'unset';

  queue.use(async (_ctx, _payload, next) => {
    order.push('outer-before');
    await next();
    order.push('outer-after');
  });

  // Tenant-isolation middleware sets tenantId for the rest of the execution.
  queue.use(async (ctx, _payload, next) => {
    (ctx as { tenantId?: string }).tenantId = 'acme';
    order.push('tenant-before');
    await next();
    order.push('tenant-after');
  });

  // A later middleware observes the tenant set upstream.
  queue.use(async (ctx, _payload, next) => {
    laterMwTenant = ctx.tenantId;
    order.push('inner-before');
    await next();
    order.push('inner-after');
  });

  queue.register<{ note: string }>('mw-demo', (_payload, ctx) => {
    order.push('handler');
    handlerTenant = ctx.tenantId;
  });

  await queue.dispatch(new MiddlewareJob('hello'));

  const worker = queue.work({ pollIntervalMs: 10 });
  worker.start();

  await waitFor(() => order.includes('handler'));
  await queue.close();

  assert.deepEqual(order, [
    'outer-before',
    'tenant-before',
    'inner-before',
    'handler',
    'inner-after',
    'tenant-after',
    'outer-after',
  ]);
  // The handler is the terminal step and both the later middleware and the
  // handler observed the tenant set by the tenant-isolation middleware.
  assert.equal(laterMwTenant, 'acme');
  assert.equal(handlerTenant, 'acme');
});
