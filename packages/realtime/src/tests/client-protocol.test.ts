import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StreetWebSocketServer } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';

class ProtocolConnection extends FakeConnection {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, handler: (payload: unknown) => void): this {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return this;
  }

  receive(event: string, payload: unknown): void {
    for (const handler of this.listeners.get(event) ?? []) handler(payload);
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

test('bound event connections support subscribe, publish, and channel-aware broadcasts', async () => {
  const realtime = createRealtime({ server: new StreetWebSocketServer() });
  const alice = new ProtocolConnection({ id: 'alice-conn' });
  const bob = new ProtocolConnection({ id: 'bob-conn' });

  try {
    realtime.bind(alice, { id: 'alice' });
    realtime.bind(bob, { id: 'bob' });
    alice.receive('subscribe', { channel: 'match:1' });
    bob.receive('subscribe', { channel: 'match:1' });
    await settle();

    assert.equal(alice.eventsOfType('subscribed').length, 1);
    assert.equal(bob.eventsOfType('subscribed').length, 1);

    await realtime.room('match:1').broadcast({ type: 'state', payload: { turn: 1 } });
    const aliceState = alice.eventsOfType('realtime').find((event) => (
      (event.payload as { type?: string }).type === 'state'
    ));
    assert.deepEqual(aliceState?.payload, {
      channel: 'match:1',
      type: 'state',
      data: { turn: 1 },
    });

    alice.receive('publish', { channel: 'match:1', data: { move: 'e4' } });
    await settle();
    const bobMessage = bob.eventsOfType('realtime').find((event) => (
      (event.payload as { type?: string }).type === 'message'
    ));
    assert.deepEqual(bobMessage?.payload, {
      channel: 'match:1',
      type: 'message',
      data: { move: 'e4' },
    });
  } finally {
    await realtime.close();
  }
});

test('the client protocol rejects publishing before subscribing', async () => {
  const realtime = createRealtime({ server: new StreetWebSocketServer() });
  const conn = new ProtocolConnection({ id: 'conn' });
  try {
    realtime.bind(conn, { id: 'member' });
    conn.receive('publish', { channel: 'match:1', data: { move: 'e4' } });
    await settle();
    assert.deepEqual(conn.eventsOfType('error')[0]?.payload, {
      channel: 'match:1',
      action: 'publish',
      reason: 'subscribe to the channel before publishing',
    });
  } finally {
    await realtime.close();
  }
});

test('the client protocol preserves action order for an immediate publish after subscribe', async () => {
  const realtime = createRealtime({ server: new StreetWebSocketServer() });
  const sender = new ProtocolConnection({ id: 'sender-conn' });
  const receiver = new ProtocolConnection({ id: 'receiver-conn' });
  try {
    realtime.bind(sender, { id: 'sender' });
    realtime.bind(receiver, { id: 'receiver' });

    sender.receive('subscribe', { channel: 'match:2' });
    receiver.receive('subscribe', { channel: 'match:2' });
    sender.receive('publish', { channel: 'match:2', data: { move: 'e4' } });
    await settle();
    await settle();

    assert.equal(sender.eventsOfType('error').length, 0);
    assert.deepEqual(receiver.eventsOfType('realtime').at(-1)?.payload, {
      channel: 'match:2',
      type: 'message',
      data: { move: 'e4' },
    });
  } finally {
    await realtime.close();
  }
});
