// packages/plugin-nats/src/tests/nats.integration.test.ts
// Live integration tests for the NATS plugin's wire-protocol client
// (`NatsClient`) against a real NATS server.
//
// Configure via NATS_HOST / NATS_PORT (defaults 127.0.0.1:4222).
// When no broker is reachable, every test is skipped (never failed) so the
// suite is honest about coverage rather than fabricating a pass. This
// mirrors the gating pattern used by the core RabbitMQ and Kafka integration
// tests (`packages/core/src/integration/{rabbitmq,kafka}/*.integration.test.ts`).
//
// Requirements: 27.2 (live broker integration coverage for message transports).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { NatsClient } from '../index.js';

const HOST = process.env['NATS_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['NATS_PORT'] ?? 4222);

/** Poll `predicate` until it is truthy or `timeoutMs` elapses. Returns success. */
function waitFor(predicate: () => boolean, timeoutMs = 5000, stepMs = 25): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const tick = (): void => {
      if (predicate()) { resolve(true); return; }
      if (Date.now() >= deadline) { resolve(false); return; }
      setTimeout(tick, stepMs);
    };
    tick();
  });
}

async function brokerAvailable(): Promise<boolean> {
  const probe = new NatsClient({ host: HOST, port: PORT, timeoutMs: 2000 });
  try {
    await probe.connect();
    await probe.close();
    return true;
  } catch {
    return false;
  }
}

describe('NATS plugin transport (integration)', () => {
  let available = false;
  let client: NatsClient;

  before(async () => {
    available = await brokerAvailable();
    if (available) {
      client = new NatsClient({ host: HOST, port: PORT, timeoutMs: 5000 });
      await client.connect();
    } else {
      console.warn(
        `[nats-integration] BLOCKED: real NATS server unreachable at ${HOST}:${PORT}. ` +
        'These integration tests require a real NATS server — set NATS_HOST/NATS_PORT ' +
        'or start the docker-compose NATS service, then re-run. Skipping without fabricating results.',
      );
    }
  });

  after(async () => {
    if (available && client) await client.close();
  });

  it('publishes and delivers a message to a live subscriber', async (t) => {
    if (!available) { t.skip('NATS server not reachable'); return; }
    const subject = 'street.basic.' + randomBytes(3).toString('hex');
    const received: string[] = [];
    client.subscribe(subject, (msg) => { received.push(msg.data.toString('utf8')); });
    await client.flush(); // ensure SUB reached the server before publishing

    client.publish(subject, 'hello-nats');
    const ok = await waitFor(() => received.length >= 1);
    assert.ok(ok, 'expected the subscriber to receive the published message');
    assert.equal(received[0], 'hello-nats');
  });

  it('delivers a reply-to message back to the requester subject', async (t) => {
    if (!available) { t.skip('NATS server not reachable'); return; }
    const subject = 'street.rpc.' + randomBytes(3).toString('hex');
    const replySubject = 'street.reply.' + randomBytes(3).toString('hex');
    const replies: string[] = [];

    client.subscribe(replySubject, (msg) => { replies.push(msg.data.toString('utf8')); });
    client.subscribe(subject, (msg) => {
      if (msg.reply) client.publish(msg.reply, 'pong');
    });
    await client.flush();

    client.publish(subject, 'ping', replySubject);
    const ok = await waitFor(() => replies.length >= 1);
    assert.ok(ok, 'expected a reply on the reply-to subject');
    assert.equal(replies[0], 'pong');
  });

  it('stops delivering after unsubscribe', async (t) => {
    if (!available) { t.skip('NATS server not reachable'); return; }
    const subject = 'street.unsub.' + randomBytes(3).toString('hex');
    let count = 0;
    const sid = client.subscribe(subject, () => { count++; });
    await client.flush();

    client.publish(subject, 'one');
    assert.ok(await waitFor(() => count >= 1), 'expected the first message to be delivered');

    client.unsubscribe(sid);
    await client.flush();

    client.publish(subject, 'two');
    // Give any (unexpected) delivery a chance to arrive, then assert it did not.
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(count, 1, 'no further messages should be delivered after unsubscribe');
  });

  it('supports queue-group delivery: exactly one member of the group receives each message', async (t) => {
    if (!available) { t.skip('NATS server not reachable'); return; }
    const subject = 'street.queue.' + randomBytes(3).toString('hex');
    const queue = 'workers';
    const a = new NatsClient({ host: HOST, port: PORT, timeoutMs: 5000 });
    const b = new NatsClient({ host: HOST, port: PORT, timeoutMs: 5000 });
    await a.connect();
    await b.connect();
    try {
      let aCount = 0, bCount = 0;
      a.subscribe(subject, () => { aCount++; }, queue);
      b.subscribe(subject, () => { bCount++; }, queue);
      await a.flush();
      await b.flush();

      const N = 10;
      for (let i = 0; i < N; i++) client.publish(subject, `m-${i}`);
      await client.flush();

      const ok = await waitFor(() => aCount + bCount >= N);
      assert.ok(ok, `expected ${N} total deliveries across the queue group, got ${aCount + bCount}`);
      assert.equal(aCount + bCount, N, 'every message delivered exactly once across the group');
    } finally {
      await a.close();
      await b.close();
    }
  });
});
