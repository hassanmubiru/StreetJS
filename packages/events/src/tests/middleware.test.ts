// src/tests/middleware.test.ts
// Unit tests for the middleware pipeline: registration-order execution around
// delivery, tenant/metadata propagation to listeners, publisher-visible veto
// (a throwing middleware rejects publish, unlike an isolated listener error),
// and the next()-called-twice guard. Also covers composePipeline directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEvents } from '../facade.js';
import { composePipeline, type EventMiddleware } from '../middleware.js';
import type { EventContext } from '../event.js';

interface AppEvents {
  'user.created': { id: string };
}

// ── composePipeline (direct) ────────────────────────────────────────────────────

test('composePipeline runs middleware in order with the terminal delivery last', async () => {
  const order: string[] = [];
  const mw = (label: string): EventMiddleware => async (_ctx, _payload, next) => {
    order.push(`${label}-before`);
    await next();
    order.push(`${label}-after`);
  };
  const runner = composePipeline([mw('a'), mw('b')], async () => {
    order.push('deliver');
  });

  const ctx: EventContext = { event: 'x', id: 'i', timestamp: 0, metadata: {} };
  await runner(ctx, undefined);
  assert.deepEqual(order, ['a-before', 'b-before', 'deliver', 'b-after', 'a-after']);
});

test('composePipeline rejects when a middleware calls next() twice', async () => {
  const bad: EventMiddleware = async (_c, _p, next) => {
    await next();
    await next();
  };
  const runner = composePipeline([bad], async () => {});
  const ctx: EventContext = { event: 'x', id: 'i', timestamp: 0, metadata: {} };
  await assert.rejects(() => runner(ctx, undefined), /next\(\) called multiple times/);
});

// ── Facade integration ───────────────────────────────────────────────────────

test('facade runs middleware in registration order around listener delivery', async () => {
  const events = createEvents<AppEvents>();
  const order: string[] = [];
  events.use(async (_c, _p, next) => {
    order.push('outer-before');
    await next();
    order.push('outer-after');
  });
  events.use(async (_c, _p, next) => {
    order.push('inner-before');
    await next();
    order.push('inner-after');
  });
  events.on('user.created', () => {
    order.push('listener');
  });

  await events.publish('user.created', { id: 'u' });
  assert.deepEqual(order, [
    'outer-before',
    'inner-before',
    'listener',
    'inner-after',
    'outer-after',
  ]);
  await events.close();
});

test('tenant-context middleware propagates tenantId to listeners via ctx', async () => {
  const events = createEvents<AppEvents>();
  events.use(async (ctx, _p, next) => {
    (ctx as { tenantId?: string }).tenantId = 'acme';
    ctx.metadata['tenantId'] = 'acme';
    await next();
  });
  let seenTenant: string | undefined;
  events.on('user.created', (_p, ctx) => {
    seenTenant = ctx.tenantId;
  });

  await events.publish('user.created', { id: 'u' });
  assert.equal(seenTenant, 'acme');
  await events.close();
});

test('a middleware that vetoes delivery (throws) rejects publish and skips listeners', async () => {
  const events = createEvents<AppEvents>();
  let delivered = false;
  events.use(async () => {
    // Authorization-style veto: never calls next(), throws instead.
    throw new Error('forbidden');
  });
  events.on('user.created', () => {
    delivered = true;
  });

  await assert.rejects(() => events.publish('user.created', { id: 'u' }), /forbidden/);
  assert.equal(delivered, false, 'listeners must not run when middleware vetoes');
  await events.close();
});

test('a middleware that does not call next() blocks delivery without error', async () => {
  const events = createEvents<AppEvents>();
  let delivered = false;
  events.use(async () => {
    // Silently drop the event (e.g. a filter): resolve without calling next().
  });
  events.on('user.created', () => {
    delivered = true;
  });

  await events.publish('user.created', { id: 'u' }); // resolves
  assert.equal(delivered, false);
  await events.close();
});
