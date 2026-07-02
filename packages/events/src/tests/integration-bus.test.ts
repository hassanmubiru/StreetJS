// src/tests/integration-bus.test.ts
// Integration tests for the events <-> core EventBus fan-out bridge, exercised
// against the REAL core EventBus (in-process transport) imported from streetjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBus } from 'streetjs';

import { createEvents } from '../facade.js';
import { forwardToBus, forwardFromBus, FROM_BUS } from '../integrations/bus.js';

interface AppEvents {
  'order.shipped': { id: string };
  'order.cancelled': { id: string };
  'remote.thing': { value: number };
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

// ── Outbound: app event → bus ──────────────────────────────────────────────────

test('forwardToBus publishes matching app events onto the bus topic', async () => {
  const events = createEvents<AppEvents>();
  const bus = new EventBus();
  const seen: Array<{ topic: string; payload: unknown }> = [];
  bus.subscribe('order.shipped', async (env) => {
    seen.push({ topic: env.topic, payload: env.payload });
  });

  forwardToBus(events, bus, [{ appEvent: 'order.shipped' }]);
  await events.publish('order.shipped', { id: 'o1' });
  await tick();

  assert.deepEqual(seen, [{ topic: 'order.shipped', payload: { id: 'o1' } }]);
  await events.close();
});

test('forwardToBus supports a wildcard app event and derived topic/payload', async () => {
  const events = createEvents<AppEvents>();
  const bus = new EventBus();
  const topics: string[] = [];
  bus.subscribe('orders', async (env) => {
    topics.push(`${env.topic}:${(env.payload as { id: string }).id}`);
  });

  forwardToBus(events, bus, [
    { appEvent: 'order.*', topic: 'orders', map: (p) => ({ id: (p as { id: string }).id }) },
  ]);
  await events.publish('order.shipped', { id: 'o1' });
  await events.publish('order.cancelled', { id: 'o2' });
  await tick();

  assert.deepEqual(topics, ['orders:o1', 'orders:o2']);
  await events.close();
});

// ── Inbound: bus → app event ────────────────────────────────────────────────────

test('forwardFromBus republishes bus messages into the app event layer', async () => {
  const events = createEvents<AppEvents>();
  const bus = new EventBus();
  const received: Array<{ value: number; fromBus: unknown }> = [];
  events.on('remote.thing', (p, ctx) => {
    received.push({ value: p.value, fromBus: ctx.metadata[FROM_BUS] });
  });

  forwardFromBus(bus, events, [{ topic: 'remote.thing' }]);
  await bus.publish('remote.thing', { value: 42 });
  await events.flush();
  await tick();
  await events.flush();

  assert.equal(received.length, 1);
  assert.equal(received[0]!.value, 42);
  assert.equal(received[0]!.fromBus, true, 'inbound events are tagged with FROM_BUS');
  await events.close();
});

// ── Loop guard: wiring both directions does not loop ────────────────────────────

test('wiring forwardToBus + forwardFromBus on the same event does not create a loop', async () => {
  const events = createEvents<AppEvents>();
  const bus = new EventBus();
  let appDeliveries = 0;
  let busDeliveries = 0;

  events.on('order.shipped', () => {
    appDeliveries += 1;
  });
  bus.subscribe('order.shipped', async () => {
    busDeliveries += 1;
  });

  forwardToBus(events, bus, [{ appEvent: 'order.shipped' }]);
  forwardFromBus(bus, events, [{ topic: 'order.shipped' }]);

  // Publish once locally. Outbound forwards to the bus; the bus round-trips it
  // back inbound (tagged FROM_BUS); outbound then SKIPS the tagged event, so the
  // cascade terminates.
  await events.publish('order.shipped', { id: 'o1' });
  await tick();
  await events.flush();
  await tick();
  await events.flush();

  // Local publish (1) + one bus round-trip re-delivery (1) = 2 app deliveries.
  assert.equal(appDeliveries, 2, 'app delivered original + one round-trip, then stopped');
  // The bus saw exactly one publish (the original outbound forward).
  assert.equal(busDeliveries, 1, 'the bus saw exactly one publish; no loop');
  await events.close();
});

// ── Detach ──────────────────────────────────────────────────────────────────

test('the detach functions stop forwarding in both directions', async () => {
  const events = createEvents<AppEvents>();
  const bus = new EventBus();
  let busCount = 0;
  bus.subscribe('order.shipped', async () => {
    busCount += 1;
  });

  const detach = forwardToBus(events, bus, [{ appEvent: 'order.shipped' }]);
  await events.publish('order.shipped', { id: 'o1' });
  await tick();
  detach();
  await events.publish('order.shipped', { id: 'o2' }); // no longer forwarded
  await tick();

  assert.equal(busCount, 1);
  await events.close();
});
