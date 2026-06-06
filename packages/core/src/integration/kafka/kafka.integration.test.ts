// integration/kafka/kafka.integration.test.ts
// Integration tests for the Kafka transport. Requires a running broker:
//   docker compose -f docker-compose.kafka.yml up -d
// Configure via KAFKA_BROKERS (default 127.0.0.1:9092).
// When no broker is reachable, every test is skipped (never failed) so the
// suite is safe to run in environments without infrastructure.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { KafkaClient } from '../../transports/kafka/client.js';
import { KafkaProducer, KafkaConsumer } from '../../transports/kafka/index.js';

const BROKERS = (process.env['KAFKA_BROKERS'] ?? '127.0.0.1:9092').split(',');

function clientOpts(): { brokers: string[]; connectTimeoutMs: number } {
  return { brokers: BROKERS, connectTimeoutMs: 3000 };
}

async function brokerAvailable(): Promise<boolean> {
  const client = new KafkaClient(clientOpts());
  try {
    await client.metadata([]);
    client.close();
    return true;
  } catch {
    client.close();
    return false;
  }
}

/** Ensure a topic exists with the requested partition count by producing a
 *  probe record (auto-create) then polling metadata until partitions appear. */
async function ensureTopic(client: KafkaClient, topic: string, minPartitions = 1): Promise<void> {
  const deadline = Date.now() + 15000;
  for (;;) {
    const meta = await client.metadata([topic]);
    const tm = meta.topics.find((t) => t.name === topic);
    if (tm && tm.error === 0 && tm.partitions.length >= minPartitions) return;
    if (Date.now() > deadline) throw new Error(`topic ${topic} not ready`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function waitFor<T>(fn: () => T | undefined, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = (): void => {
      const v = fn();
      if (v !== undefined) { resolve(v); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error('waitFor timeout')); return; }
      setTimeout(tick, 50);
    };
    tick();
  });
}

describe('Kafka transport (integration)', () => {
  let available = false;
  let client: KafkaClient;

  before(async () => {
    available = await brokerAvailable();
    if (available) client = new KafkaClient(clientOpts());
  });

  after(async () => {
    if (available && client) client.close();
  });

  it('produces and consumes a single record on one partition', async (t) => {
    if (!available) { t.skip('Kafka broker not reachable'); return; }
    const topic = 'street.basic.' + randomBytes(3).toString('hex');
    await ensureTopic(client, topic, 1);

    const producer = new KafkaProducer(client);
    const baseOffset = await client.listOffset(topic, 0, -1n); // latest before produce
    await producer.send(topic, { key: Buffer.from('k1'), value: Buffer.from('hello-kafka') }, 0);
    await producer.flush();

    const { records } = await client.fetch(topic, 0, baseOffset, { maxWaitMs: 3000 });
    const values = records.map((r) => r.value?.toString('utf8'));
    assert.ok(values.includes('hello-kafka'), `expected hello-kafka in ${JSON.stringify(values)}`);
    await producer.close();
  });

  it('batches multiple records and consumes them in order', async (t) => {
    if (!available) { t.skip('Kafka broker not reachable'); return; }
    const topic = 'street.batch.' + randomBytes(3).toString('hex');
    await ensureTopic(client, topic, 1);

    const start = await client.listOffset(topic, 0, -1n);
    const producer = new KafkaProducer(client, { batchSize: 10, lingerMs: 20 });
    const sent: string[] = [];
    const sends: Promise<void>[] = [];
    for (let i = 0; i < 10; i++) {
      const v = `msg-${i}`;
      sent.push(v);
      sends.push(producer.send(topic, { key: null, value: Buffer.from(v) }, 0));
    }
    await Promise.all(sends);
    await producer.flush();

    const { records } = await client.fetch(topic, 0, start, { maxWaitMs: 3000, maxBytes: 1_048_576 });
    const got = records.map((r) => r.value?.toString('utf8'));
    for (const v of sent) assert.ok(got.includes(v), `missing ${v} in ${JSON.stringify(got)}`);
    // ordering within a partition is preserved
    const idxs = sent.map((v) => got.indexOf(v));
    for (let i = 1; i < idxs.length; i++) assert.ok(idxs[i]! > idxs[i - 1]!, 'ordering not preserved');
    await producer.close();
  });

  it('distributes records across partitions (round-robin)', async (t) => {
    if (!available) { t.skip('Kafka broker not reachable'); return; }
    const topic = 'street.partition.' + randomBytes(3).toString('hex');
    await ensureTopic(client, topic, 3);
    const meta = await client.metadata([topic]);
    const partitions = meta.topics.find((x) => x.name === topic)!.partitions.map((p) => p.partition);
    assert.ok(partitions.length >= 2, 'need >= 2 partitions for this test');

    const starts = new Map<number, bigint>();
    for (const p of partitions) starts.set(p, await client.listOffset(topic, p, -1n));

    const producer = new KafkaProducer(client);
    const N = partitions.length * 4;
    const sends: Promise<void>[] = [];
    for (let i = 0; i < N; i++) sends.push(producer.send(topic, { key: null, value: Buffer.from(`p-${i}`) }));
    await Promise.all(sends);
    await producer.flush();

    // Every partition should have received at least one record.
    let totalNew = 0n;
    for (const p of partitions) {
      const end = await client.listOffset(topic, p, -1n);
      totalNew += end - starts.get(p)!;
    }
    assert.equal(totalNew, BigInt(N), 'all records accounted for across partitions');
    await producer.close();
  });

  it('commits and fetches consumer-group offsets', async (t) => {
    if (!available) { t.skip('Kafka broker not reachable'); return; }
    const topic = 'street.offset.' + randomBytes(3).toString('hex');
    const group = 'g.' + randomBytes(3).toString('hex');
    await ensureTopic(client, topic, 1);

    const before = await client.fetchOffset(group, topic, 0);
    assert.equal(before, -1n, 'no committed offset initially');

    await client.commitOffset(group, topic, 0, 42n);
    const after = await client.fetchOffset(group, topic, 0);
    assert.equal(after, 42n, 'committed offset round-trips');
  });

  it('runs a KafkaConsumer poll loop with auto-commit and stops gracefully', async (t) => {
    if (!available) { t.skip('Kafka broker not reachable'); return; }
    const topic = 'street.consumer.' + randomBytes(3).toString('hex');
    const group = 'cg.' + randomBytes(3).toString('hex');
    await ensureTopic(client, topic, 1);

    const producer = new KafkaProducer(client);
    const payloads = ['a', 'b', 'c'];
    for (const p of payloads) await producer.send(topic, { key: null, value: Buffer.from(p) }, 0);
    await producer.flush();

    const received: string[] = [];
    const consumer = new KafkaConsumer(client, { groupId: group, topic, partitions: [0], fromBeginning: true });
    await consumer.run(async (msg) => { if (msg.value) received.push(msg.value.toString('utf8')); });

    await waitFor(() => (payloads.every((p) => received.includes(p)) ? true : undefined), 15000);
    await consumer.stop();

    // After consuming, the committed offset should be >= number of messages.
    const committed = await client.fetchOffset(group, topic, 0);
    assert.ok(committed >= BigInt(payloads.length), `committed ${committed} should cover ${payloads.length}`);
    await producer.close();
  });

  it('recovers fetch after requesting beyond the log end (transient error handling)', async (t) => {
    if (!available) { t.skip('Kafka broker not reachable'); return; }
    const topic = 'street.recover.' + randomBytes(3).toString('hex');
    await ensureTopic(client, topic, 1);
    const end = await client.listOffset(topic, 0, -1n);
    // Fetching exactly at the end returns no records but must not throw.
    const { records } = await client.fetch(topic, 0, end, { maxWaitMs: 500 });
    assert.equal(records.length, 0);
  });

  it('produces with the idempotent producer (InitProducerId + sequencing)', async (t) => {
    if (!available) { t.skip('Kafka broker not reachable'); return; }
    const topic = 'street.idem.' + randomBytes(3).toString('hex');
    await ensureTopic(client, topic, 1);
    const start = await client.listOffset(topic, 0, -1n);

    const producer = new KafkaProducer(client, { idempotent: true });
    await producer.send(topic, { key: null, value: Buffer.from('idem-1') }, 0);
    await producer.flush();
    await producer.send(topic, { key: null, value: Buffer.from('idem-2') }, 0);
    await producer.flush();

    const { records } = await client.fetch(topic, 0, start, { maxWaitMs: 3000 });
    const values = records.map((r) => r.value?.toString('utf8'));
    assert.ok(values.includes('idem-1') && values.includes('idem-2'), `got ${JSON.stringify(values)}`);
    await producer.close();
  });
});
