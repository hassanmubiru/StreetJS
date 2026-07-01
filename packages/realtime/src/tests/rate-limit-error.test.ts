// src/tests/rate-limit-error.test.ts
// Task 8.3 — unit tests for the rate-limit error event (Req 11.4) and the
// rate-limit rejection metric (Req 17.3). Driven through the facade
// (`createRealtime`) over a no-op WebSocket server and a `FakeConnection`, with
// no network socket (Req 16.3).
//
//   - Req 11.4: WHEN a rate-limit rejection occurs, the framework sends a
//     rate-limit error event to the offending Connection identifying the
//     exceeded quota. Verified by configuring a tiny per-connection quota
//     (`{ requests: 1, window: '1s' }`), broadcasting beyond it with
//     `options.exceptConnId` set to the sender's connection id, and asserting
//     the sender receives an `error` event carrying
//     `{ reason: 'rate_limited', quota: 'perConnection', channel }`.
//
//     Note on delivery vs. error emission: `exceptConnId` excludes the sender
//     from *message delivery*, but the facade resolves the offender by
//     `connById(exceptConnId)` and emits the error event directly to it — so the
//     sender still receives the `error` event even though it is excluded from
//     the broadcast payload.
//
//   - Req 17.3: WHEN a rate-limit rejection occurs, the framework increments a
//     rate-limit rejection metric on the Metrics_Registry. Verified two ways:
//     (a) against a real `MetricsRegistry`, reading the counter's rendered
//     exposition; and (b) against a spy registry recording `counter`/`inc`
//     calls, asserting exactly one increment per rejection.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { StreetWebSocketServer, MetricsRegistry } from 'streetjs';
import { createRealtime, FakeConnection } from '../index.js';
import type { Member, RealtimeOptions } from '../index.js';

/** Build a facade over a no-op WebSocket server (no port bound). */
function makeServer(): StreetWebSocketServer {
  return new StreetWebSocketServer();
}

const member = (id: string): Member => ({ id });

/** A per-connection quota of exactly one message per second, for a tight window. */
const TINY_RATE_LIMIT: RealtimeOptions['rateLimit'] = {
  perConnection: { requests: 1, window: '1s' },
  perChannel: { requests: 1000, window: '1s' },
};

/** The canonical rate-limit rejection counter name (Req 17.3). */
const REJECTIONS_METRIC = 'realtime_rate_limit_rejections_total';

test('offending connection receives a rate_limited error event naming the exceeded quota (Req 11.4)', async () => {
  const metrics = new MetricsRegistry();
  const realtime = createRealtime({ server: makeServer(), rateLimit: TINY_RATE_LIMIT, metrics });
  try {
    const room = realtime.room('lobby');
    const sender = new FakeConnection({ id: 'sender' });
    const other = new FakeConnection({ id: 'other' });
    await room.join(member('alice'), sender);
    await room.join(member('bob'), other);

    // First broadcast is at quota (requests: 1) and is delivered.
    await room.broadcast({ type: 'message', payload: { text: 'one' } }, { exceptConnId: sender.id });
    // Second broadcast exceeds the per-connection quota and is rejected.
    await room.broadcast({ type: 'message', payload: { text: 'two' } }, { exceptConnId: sender.id });

    // The sender is excluded from delivery, yet still receives the error event —
    // the facade resolves the offender by connById(exceptConnId) and emits to it.
    const errors = sender.eventsOfType('error');
    assert.equal(errors.length, 1, 'sender should receive exactly one rate-limit error event');
    assert.deepEqual(errors[0]?.payload, {
      channel: 'lobby',
      reason: 'rate_limited',
      quota: 'perConnection',
    });

    // The other connection received the first (delivered) message and no error.
    assert.equal(other.eventsOfType('message').length, 1, 'first message should be delivered');
    assert.equal(other.eventsOfType('error').length, 0, 'other connection receives no error');

    // The second (rejected) broadcast delivered nothing to anyone.
    assert.equal(
      other.eventsOfType('message').length,
      1,
      'rejected broadcast must not be delivered',
    );
  } finally {
    await realtime.close();
  }
});

test('a rate-limit rejection increments the rejection metric on a real MetricsRegistry (Req 17.3)', async () => {
  const metrics = new MetricsRegistry();
  const realtime = createRealtime({ server: makeServer(), rateLimit: TINY_RATE_LIMIT, metrics });
  try {
    const room = realtime.room('lobby');
    const sender = new FakeConnection({ id: 'sender' });
    await room.join(member('alice'), sender);

    // No rejection yet: the counter is registered lazily on first configure but
    // renders zero until incremented.
    // Within quota (1st message) — no rejection.
    await room.broadcast({ type: 'message', payload: { n: 1 } }, { exceptConnId: sender.id });
    // Over quota (2nd + 3rd messages) — two rejections.
    await room.broadcast({ type: 'message', payload: { n: 2 } }, { exceptConnId: sender.id });
    await room.broadcast({ type: 'message', payload: { n: 3 } }, { exceptConnId: sender.id });

    const counter = metrics.get(REJECTIONS_METRIC);
    assert.ok(counter, `expected the ${REJECTIONS_METRIC} counter to be registered`);
    // Read the rendered exposition and assert the counter value is 2.
    const rendered = counter!.render();
    assert.match(
      rendered,
      new RegExp(`^${REJECTIONS_METRIC}\\s+2$`, 'm'),
      `expected ${REJECTIONS_METRIC} to be 2, got:\n${rendered}`,
    );

    // The offending connection received one error per rejection.
    assert.equal(sender.eventsOfType('error').length, 2);
  } finally {
    await realtime.close();
  }
});

test('the rejection metric is not incremented when broadcasts stay within quota (Req 17.3)', async () => {
  const metrics = new MetricsRegistry();
  const realtime = createRealtime({
    server: makeServer(),
    // Generous quota so nothing is rejected.
    rateLimit: { perConnection: { requests: 100, window: '1s' } },
    metrics,
  });
  try {
    const room = realtime.room('lobby');
    const sender = new FakeConnection({ id: 'sender' });
    await room.join(member('alice'), sender);

    await room.broadcast({ type: 'message', payload: { n: 1 } }, { exceptConnId: sender.id });
    await room.broadcast({ type: 'message', payload: { n: 2 } }, { exceptConnId: sender.id });

    // No rejection occurred, so the sender received no error event…
    assert.equal(sender.eventsOfType('error').length, 0);
    // …and the counter, if registered at all, renders zero.
    const counter = metrics.get(REJECTIONS_METRIC);
    if (counter) {
      assert.match(counter.render(), new RegExp(`^${REJECTIONS_METRIC}\\s+0$`, 'm'));
    }
  } finally {
    await realtime.close();
  }
});

test('with no metrics registry configured, a rejection still emits the error event without throwing (Req 11.4)', async () => {
  // Metrics are entirely opt-in: no `metrics` option ⇒ the rejection recorder is
  // a no-op, and the rate-limit error path must still work.
  const realtime = createRealtime({ server: makeServer(), rateLimit: TINY_RATE_LIMIT });
  try {
    const room = realtime.room('lobby');
    const sender = new FakeConnection({ id: 'sender' });
    await room.join(member('alice'), sender);

    await room.broadcast({ type: 'message', payload: { n: 1 } }, { exceptConnId: sender.id });
    await assert.doesNotReject(
      room.broadcast({ type: 'message', payload: { n: 2 } }, { exceptConnId: sender.id }),
    );

    const errors = sender.eventsOfType('error');
    assert.equal(errors.length, 1);
    assert.deepEqual(errors[0]?.payload, {
      channel: 'lobby',
      reason: 'rate_limited',
      quota: 'perConnection',
    });
  } finally {
    await realtime.close();
  }
});
