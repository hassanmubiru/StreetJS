// src/tests/integration-queue.test.ts
// Integration tests for the queue → events bridge. Uses a structural fake queue
// (no @streetjs/queue dependency) to prove queue lifecycle events publish the
// mapped application events.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEvents } from '../facade.js';
import { bridgeQueueEvents, type QueueLike } from '../integrations/queue.js';

interface AppEvents {
  'report.generated': { jobId: string };
  'job.failed.alert': { jobId: string };
}

/** A structural fake queue that records handlers and can fire events. */
function fakeQueue(): QueueLike & { fire(event: string, payload: unknown): void } {
  const handlers = new Map<string, Array<(p: unknown) => void>>();
  return {
    on(event, handler) {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return () => {
        const l = handlers.get(event);
        if (l) handlers.set(event, l.filter((h) => h !== handler));
      };
    },
    fire(event, payload) {
      for (const h of handlers.get(event) ?? []) h(payload);
    },
  };
}

test('a queue lifecycle event publishes the mapped application event', async () => {
  const queue = fakeQueue();
  const events = createEvents<AppEvents>();
  const received: Array<{ jobId: string }> = [];
  events.on('report.generated', (p) => {
    received.push(p);
  });

  bridgeQueueEvents(queue, events, [
    {
      queueEvent: 'job.completed',
      appEvent: 'report.generated',
      map: (e) => ({ jobId: (e as { ctx: { id: string } }).ctx.id }),
    },
  ]);

  queue.fire('job.completed', { ctx: { id: 'job-1' } });
  await events.close(); // drains the fire-and-forget publish

  assert.deepEqual(received, [{ jobId: 'job-1' }]);
});

test('awaitPublish uses the awaited publish path; default is fire-and-forget', async () => {
  const queue = fakeQueue();
  const events = createEvents<AppEvents>();
  const received: string[] = [];
  events.on('job.failed.alert', (p) => {
    received.push(p.jobId);
  });

  bridgeQueueEvents(queue, events, [
    {
      queueEvent: 'job.failed',
      appEvent: 'job.failed.alert',
      map: (e) => ({ jobId: (e as { ctx: { id: string } }).ctx.id }),
      awaitPublish: true,
    },
  ]);

  queue.fire('job.failed', { ctx: { id: 'job-9' } });
  await events.close();
  assert.deepEqual(received, ['job-9']);
});

test('the raw queue payload is published when no map is provided', async () => {
  const queue = fakeQueue();
  const events = createEvents();
  let seen: unknown;
  events.on('report.generated', (p) => {
    seen = p;
  });

  bridgeQueueEvents(queue, events, [{ queueEvent: 'x', appEvent: 'report.generated' }]);
  queue.fire('x', { raw: true });
  await events.close();
  assert.deepEqual(seen, { raw: true });
});

test('the returned detach unsubscribes bridged queue handlers', async () => {
  const queue = fakeQueue();
  const events = createEvents<AppEvents>();
  let count = 0;
  events.on('report.generated', () => {
    count += 1;
  });

  const detach = bridgeQueueEvents(queue, events, [
    { queueEvent: 'job.completed', appEvent: 'report.generated', map: () => ({ jobId: 'x' }) },
  ]);

  queue.fire('job.completed', {});
  detach();
  queue.fire('job.completed', {}); // no longer bridged
  await events.close();
  assert.equal(count, 1);
});
