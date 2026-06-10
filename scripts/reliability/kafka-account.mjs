#!/usr/bin/env node
// scripts/reliability/kafka-account.mjs
// Lost-message accounting probe for the Kafka chaos / cold-start harness
// (Requirement 9.8, Property 25).
//
// Produces N records to a fresh topic, then runs a committing consumer and
// counts how many produced messages were delivered to a COMMITTED consumer
// (committed offset). A "lost message" is a produced message that is never
// delivered to a committed consumer, so:
//
//     lostCount = produced - deliveredToCommitted
//     passed    = (lostCount === 0)
//
// The exact accounting arithmetic lives in core (accountLostMessages) so it is
// the same logic the offline property test (Property 25) validates. This probe
// only gathers the two real tallies from a live broker, then defers to core.
//
// Emits a single JSON line on stdout, e.g.:
//   {"produced":50,"deliveredToCommitted":50,"lostCount":0,"passed":true}
//
// Usage:
//   COUNT=50 KAFKA_BROKERS=127.0.0.1:9092 node scripts/reliability/kafka-account.mjs
//
// Exit code: 0 when passed (0 lost), 1 otherwise (or on probe failure).

import { randomBytes } from 'node:crypto';
import {
  KafkaClient,
  KafkaProducer,
  KafkaConsumer,
  accountLostMessages,
} from '../../packages/core/dist/src/index.js';

const BROKERS = (process.env.KAFKA_BROKERS ?? '127.0.0.1:9092').split(',');
const COUNT = Math.max(0, Number.parseInt(process.env.COUNT ?? '50', 10) || 0);
const TIMEOUT_MS = Number.parseInt(process.env.ACCOUNT_TIMEOUT_MS ?? '30000', 10) || 30000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const topic = 'street.account.' + randomBytes(4).toString('hex');
  const group = 'acct.' + randomBytes(4).toString('hex');
  const client = new KafkaClient({ brokers: BROKERS, connectTimeoutMs: 5000 });

  // Topic + leader readiness (cold-start safe).
  await client.metadata([topic]);
  await client.awaitTopicReady(topic, 1, 15000);

  // Produce COUNT messages on partition 0.
  const producer = new KafkaProducer(client, { batchSize: 100, lingerMs: 10 });
  const sends = [];
  for (let i = 0; i < COUNT; i++) {
    sends.push(producer.send(topic, { key: null, value: Buffer.from(`acct-${i}`) }, 0));
  }
  await Promise.all(sends);
  await producer.flush();
  const produced = COUNT;

  // Consume + auto-commit until the committed offset covers everything or we
  // hit the deadline. deliveredToCommitted is read from the committed offset
  // (a message only counts once it has been delivered AND committed).
  const consumer = new KafkaConsumer(client, {
    groupId: group,
    topic,
    partitions: [0],
    fromBeginning: true,
    autoCommit: true,
  });
  await consumer.run(async () => { /* delivery is reflected by the committed offset */ });

  const deadline = Date.now() + TIMEOUT_MS;
  let committed = 0n;
  while (Date.now() < deadline) {
    const off = await client.fetchOffset(group, topic, 0);
    committed = off < 0n ? 0n : off;
    if (Number(committed) >= produced) break;
    await delay(200);
  }
  await consumer.stop();
  await producer.close();
  client.close();

  const deliveredToCommitted = Math.min(produced, Number(committed));
  const account = accountLostMessages(produced, deliveredToCommitted);
  process.stdout.write(JSON.stringify(account) + '\n');
  process.exit(account.passed ? 0 : 1);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ error: String(err?.message ?? err) }) + '\n');
  process.exit(1);
});
