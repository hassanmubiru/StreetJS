// src/tests/integration-realtime.test.ts
// Integration tests for the events → realtime bridge. Uses a structural fake
// realtime (no @streetjs/realtime dependency) to prove application events are
// broadcast to the resolved room with the right message shape.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createEvents } from '../facade.js';
import {
  bridgeRealtimeEvents,
  type RealtimeLike,
  type RealtimeBroadcast,
} from '../integrations/realtime.js';

interface AppEvents {
  'report.generated': { id: string; url: string };
  'order.shipped': { id: string };
  'order.cancelled': { id: string };
}

interface Recorded {
  room: string;
  message: RealtimeBroadcast;
}

/** A structural fake realtime that records every broadcast per room. */
function fakeRealtime(): RealtimeLike & { recorded: Recorded[] } {
  const recorded: Recorded[] = [];
  return {
    recorded,
    room(name) {
      return {
        broadcast(message) {
          recorded.push({ room: name, message });
          return Promise.resolve();
        },
      };
    },
  };
}

test('an application event is broadcast to a static room with type = event name by default', async () => {
  const events = createEvents<AppEvents>();
  const realtime = fakeRealtime();
  bridgeRealtimeEvents(events, realtime, [{ appEvent: 'report.generated', room: 'reports' }]);

  await events.publish('report.generated', { id: 'r1', url: '/r/1' });

  assert.equal(realtime.recorded.length, 1);
  assert.deepEqual(realtime.recorded[0], {
    room: 'reports',
    message: { type: 'report.generated', payload: { id: 'r1', url: '/r/1' } },
  });
  await events.close();
});

test('the destination room and message type can be derived from payload/context', async () => {
  const events = createEvents<AppEvents>();
  const realtime = fakeRealtime();
  bridgeRealtimeEvents(events, realtime, [
    {
      appEvent: 'order.shipped',
      room: (payload) => `orders:${(payload as { id: string }).id}`,
      type: () => 'shipment',
      map: (payload) => ({ order: (payload as { id: string }).id }),
    },
  ]);

  await events.publish('order.shipped', { id: 'o42' });

  assert.deepEqual(realtime.recorded[0], {
    room: 'orders:o42',
    message: { type: 'shipment', payload: { order: 'o42' } },
  });
  await events.close();
});

test('a wildcard bridge broadcasts every matching event with its concrete type', async () => {
  const events = createEvents<AppEvents>();
  const realtime = fakeRealtime();
  bridgeRealtimeEvents(events, realtime, [{ appEvent: 'order.*', room: 'orders' }]);

  await events.publish('order.shipped', { id: 'o1' });
  await events.publish('order.cancelled', { id: 'o2' });

  assert.deepEqual(
    realtime.recorded.map((r) => r.message.type),
    ['order.shipped', 'order.cancelled'],
  );
  await events.close();
});

test('the returned detach unsubscribes the bridge listeners', async () => {
  const events = createEvents<AppEvents>();
  const realtime = fakeRealtime();
  const detach = bridgeRealtimeEvents(events, realtime, [
    { appEvent: 'report.generated', room: 'reports' },
  ]);

  await events.publish('report.generated', { id: 'r1', url: '/r/1' });
  detach();
  await events.publish('report.generated', { id: 'r2', url: '/r/2' }); // no longer bridged

  assert.equal(realtime.recorded.length, 1);
  await events.close();
});
