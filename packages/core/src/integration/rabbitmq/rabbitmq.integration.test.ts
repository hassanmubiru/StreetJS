// integration/rabbitmq/rabbitmq.integration.test.ts
// Integration tests for the RabbitMQ transport. Requires a running broker:
//   docker compose -f docker-compose.rabbitmq.yml up -d
// Configure via RABBITMQ_HOST / RABBITMQ_PORT (defaults 127.0.0.1:5672).
// When no broker is reachable, every test is skipped (never failed) so the
// suite is safe to run in environments without infrastructure.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  AmqpConnection, RabbitMqConnectionManager, RabbitMqPublisher, RabbitMqConsumer,
} from '../../transports/rabbitmq/index.js';

const HOST = process.env['RABBITMQ_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['RABBITMQ_PORT'] ?? 5672);

async function brokerAvailable(): Promise<boolean> {
  const conn = new AmqpConnection({ host: HOST, port: PORT, connectTimeoutMs: 2000 });
  try { await conn.connect(); await conn.close(); return true; }
  catch { return false; }
}

function waitFor<T>(fn: () => T | undefined, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      const v = fn();
      if (v !== undefined) { resolve(v); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error('waitFor timeout')); return; }
      setTimeout(tick, 25);
    };
    tick();
  });
}

describe('RabbitMQ transport (integration)', () => {
  let available = false;
  const exchange = 'street.test.' + randomBytes(3).toString('hex');
  let manager: RabbitMqConnectionManager;

  before(async () => {
    available = await brokerAvailable();
    if (available) manager = new RabbitMqConnectionManager({ host: HOST, port: PORT, exchange });
  });

  after(async () => {
    if (available && manager) await manager.close();
  });

  it('publishes (with confirms) and consumes a message', async (t) => {
    if (!available) { t.skip('RabbitMQ broker not reachable'); return; }
    const queue = 'q.basic.' + randomBytes(3).toString('hex');
    const rk = 'evt.created';
    const received: string[] = [];
    const consumer = new RabbitMqConsumer(manager, exchange, { queue, routingKeys: [rk] });
    await consumer.consume(async (msg) => { received.push(msg.body.toString('utf8')); });

    const publisher = new RabbitMqPublisher(manager, exchange);
    await publisher.publish(rk, JSON.stringify({ hello: 'world' }));

    const first = await waitFor(() => (received.length > 0 ? received[0] : undefined));
    assert.match(first, /world/);
  });

  it('retries a failing handler and routes to the DLQ after nack', async (t) => {
    if (!available) { t.skip('RabbitMQ broker not reachable'); return; }
    const queue = 'q.dlq.' + randomBytes(3).toString('hex');
    const dlx = exchange + '.dlx';
    const dlq = queue + '.dead';
    const rk = 'evt.fail';

    // Set up a dead-letter queue bound to the DLX fanout exchange.
    const conn = await manager.get();
    await conn.declareExchange(dlx, 'fanout', { durable: true });
    await conn.declareQueue(dlq, { durable: true });
    await conn.bindQueue(dlq, dlx, '');

    const deadReceived: string[] = [];
    // Consume from the dead-letter queue directly to observe dead-lettered messages.
    await (await manager.get()).consume(dlq, (m) => { deadReceived.push(m.body.toString('utf8')); });

    const consumer = new RabbitMqConsumer(manager, exchange, { queue, routingKeys: [rk], deadLetterExchange: dlx });
    await consumer.consume(async () => { throw new Error('always fails'); });

    const publisher = new RabbitMqPublisher(manager, exchange);
    await publisher.publish(rk, 'will-be-dead-lettered');

    const dead = await waitFor(() => (deadReceived.length > 0 ? deadReceived[0] : undefined), 8000);
    assert.equal(dead, 'will-be-dead-lettered');
  });

  it('reconnects after the connection drops and resumes consuming', async (t) => {
    if (!available) { t.skip('RabbitMQ broker not reachable'); return; }
    const queue = 'q.recon.' + randomBytes(3).toString('hex');
    const rk = 'evt.recon';
    const received: string[] = [];
    const consumer = new RabbitMqConsumer(manager, exchange, { queue, routingKeys: [rk] });
    await consumer.consume(async (msg) => { received.push(msg.body.toString('utf8')); });

    // Force an abrupt disconnect (network drop); the manager reconnects and
    // re-establishes the consumer.
    const conn = await manager.get();
    conn.simulateDrop();
    await new Promise((r) => setTimeout(r, 800));

    const publisher = new RabbitMqPublisher(manager, exchange);
    await publisher.publish(rk, 'after-reconnect');
    const got = await waitFor(() => received.find((m) => m === 'after-reconnect'), 8000);
    assert.equal(got, 'after-reconnect');
  });
});
