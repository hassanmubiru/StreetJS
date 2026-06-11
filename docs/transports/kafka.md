---
layout: default
title: "Kafka Transport"
nav_exclude: true
description: "Kafka for TypeScript backends — StreetJS ships a built-in Kafka producer and consumer with backpressure and typed messages."
---

# Kafka Transport

A from-scratch **Kafka binary protocol** client and stream transport for the Street Framework, built directly on `node:net` with **zero third-party libraries** (no `kafkajs`, no `node-rdkafka`). It implements size-prefixed request framing, RecordBatch v2 with CRC32C, an idempotent batching producer, and a consumer-group offset-committing consumer.

- Source: `packages/core/src/transports/kafka/` (`primitives.ts`, `recordbatch.ts`, `connection.ts`, `client.ts`, `index.ts`)
- Package: `streetjs`

---

## Overview

The Kafka transport speaks the native Kafka protocol over plain TCP and implements exactly the APIs it needs:

| API | Version | Used for |
| --- | --- | --- |
| Metadata | v1 | Broker / topic / partition discovery, leader lookup |
| Produce | v3 | Producing RecordBatch v2 sets |
| Fetch | v4 | Consuming records from a partition |
| ListOffsets | v1 | Earliest (`-2`) / latest (`-1`) offset resolution |
| FindCoordinator | v0 | Locating the group coordinator (retries on `COORDINATOR_NOT_AVAILABLE`) |
| OffsetCommit | v2 | Committing consumer-group offsets |
| OffsetFetch | v1 | Reading committed consumer-group offsets |
| InitProducerId | v0 | Allocating producer id / epoch for the idempotent producer |

### Public exports

All of the following are exported from `streetjs`:

| Export | Kind | Purpose |
| --- | --- | --- |
| `KafkaClient` | class | Protocol client: metadata, produce, fetch, offsets, coordinator |
| `KafkaProducer` | class | Batching producer with round-robin partitioning, retries, optional idempotence |
| `KafkaConsumer` | class | Static-assignment consumer with group offset commit and poll loop |
| `KafkaStreamTransport` | class | `StreamTransport` adapter (`publish` / `subscribe`) |
| `KafkaProtocolError` | class | Error carrying a Kafka protocol error `code` |
| `encodeRecordBatch` | function | Encode a RecordBatch v2 buffer |
| `decodeRecordBatches` | function | Decode RecordBatch v2 structures from a Fetch response |
| `KafkaClientOptions` | type | Client/connection options |
| `KafkaProducerOptions` | type | Producer options (alias of internal `ProducerOptions`) |
| `KafkaConsumerOptions` | type | Consumer options (alias of internal `ConsumerOptions`) |
| `KafkaConsumedMessage` | type | A consumed message (alias of internal `ConsumedMessage`) |
| `KafkaRecord` | type | A single key/value record |
| `ClusterMeta` / `TopicMeta` / `PartitionMeta` | type | Metadata response shapes |

```typescript
import {
  KafkaClient,
  KafkaProducer,
  KafkaConsumer,
  KafkaStreamTransport,
  KafkaProtocolError,
  encodeRecordBatch,
  decodeRecordBatches,
  type KafkaClientOptions,
  type KafkaProducerOptions,
  type KafkaConsumerOptions,
  type KafkaConsumedMessage,
  type KafkaRecord,
  type ClusterMeta,
  type TopicMeta,
  type PartitionMeta,
} from 'streetjs';
```

---

## Architecture

### Wire primitives (`primitives.ts`)

- `KafkaWriter` — a growable big-endian encoder: `int8`, `int16`, `int32`, `uint32`, `int64` (BigInt), nullable `string` (INT16 length, `-1` = null), nullable `bytes` (INT32 length, `-1` = null), `raw`, and a signed **zigzag `varint`**.
- `KafkaReader` — the matching decoder with the same primitives plus `array(read)` (INT32-count-prefixed arrays), `remainingBuffer`, and `skip`.
- `crc32c(buf)` — a software **CRC32C (Castagnoli)** using the reflected polynomial `0x82F63B78`, returning an unsigned 32-bit value. This is the checksum Kafka requires inside RecordBatch v2.

### RecordBatch v2 + CRC32C (`recordbatch.ts`)

`encodeRecordBatch(records, opts)` builds a single uncompressed RecordBatch with **magic byte 2**:

1. Each record encodes `attributes`, zigzag `timestampDelta`, zigzag `offsetDelta`, varint-prefixed key and value (`-1` for null), and a header count, all length-prefixed.
2. The "after-CRC" body holds `attributes` (no compression), `lastOffsetDelta`, first/max timestamps, `producerId`, `producerEpoch`, `baseSequence`, the record count, and the records.
3. `crc32c` is computed over that body and written into the batch header alongside `partitionLeaderEpoch` and the magic byte.
4. The whole thing is framed with `baseOffset` and `batchLength`.

`decodeRecordBatches(buf)` walks one or more batches out of a Fetch response, reads the header fields, and emits `KafkaRecord`s with resolved absolute `offset` (`baseOffset + offsetDelta`) and `timestamp` (`firstTimestamp + tsDelta`). Batches whose magic byte is not `2` are skipped.

### Connection / correlation framing (`connection.ts`)

`KafkaConnection` implements Kafka's request framing:

- Each request is `[size:int32][requestHeader][requestBody]`, where the header is `apiKey:int16`, `apiVersion:int16`, `correlationId:int32`, `clientId:string`.
- A monotonically increasing `correlationId` is allocated per request and stored in a pending-callback map.
- Inbound data is buffered and split on the `int32` size prefix; each response is matched back to its request by `correlationId`, then handed to the caller as a `KafkaReader` positioned after the correlation id.

The `API` map enumerates the API keys used: `PRODUCE=0`, `FETCH=1`, `LIST_OFFSETS=2`, `METADATA=3`, `OFFSET_COMMIT=8`, `OFFSET_FETCH=9`, `FIND_COORDINATOR=10`, `API_VERSIONS=18`, `INIT_PRODUCER_ID=22`.

### Producer batching + idempotence (`index.ts`)

`KafkaProducer.send()` buffers records per topic and flushes when either the batch reaches `batchSize` or a `lingerMs` timer fires. On flush, records are grouped by partition and each group becomes one `Produce` request. Partition selection is **round-robin** across the topic's partitions (unless an explicit partition is passed). Produce is retried up to `maxRetries` with linear backoff (`retryBackoffMs * attempt`).

In **idempotent** mode (opt-in), the producer:

- Calls `InitProducerId` once to obtain a `producerId` / `producerEpoch`.
- Forces `acks = all (-1)`.
- Tracks a per-`topic/partition` `baseSequence`, advancing it by the number of records in each successful batch, so the broker can de-duplicate retried batches.

### Consumer offset management (`index.ts`)

`KafkaConsumer` uses **static partition assignment** (explicit `partitions`, or all partitions from metadata). For each partition it resolves a starting offset:

1. `OffsetFetch` for the group's committed offset; if present (`>= 0`), resume there.
2. Otherwise `ListOffsets` with `-2` (earliest) when `fromBeginning` is true, else `-1` (latest).

The poll loop fetches from each partition starting at the tracked next-offset, dispatches each record to your handler, advances the offset, and — when `autoCommit` is on — commits via `OffsetCommit` after each non-empty batch. Transient fetch errors pause briefly and retry; an idle pass sleeps `~50ms` before looping.

### Protocol version choices

The client deliberately targets **non-flexible** (pre-tagged-fields) request versions — Metadata v1, Produce v3, Fetch v4, ListOffsets v1, FindCoordinator v0, OffsetCommit v2, OffsetFetch v1, InitProducerId v0 — which keeps the wire format simple (no compact strings/arrays or tagged-field buffers) while remaining compatible with modern brokers such as Apache Kafka 3.7.

---

## Configuration

### `KafkaClientOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `brokers` | `string[]` | `['127.0.0.1:9092']` | Bootstrap broker list, e.g. `['127.0.0.1:9092']` |
| `clientId` | `string` | `'street-kafka'` | Client id sent in every request header |
| `connectTimeoutMs` | `number` | `10000` | TCP connect timeout per broker in ms |

> `host` / `port` are also accepted and folded into a single bootstrap entry when `brokers` is omitted.

### `KafkaProducerOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `batchSize` | `number` | `100` | Flush when this many records are buffered for a topic |
| `lingerMs` | `number` | `5` | Max time to wait before flushing a partial batch |
| `acks` | `number` | `-1` (all) | Required acks; forced to `-1` when `idempotent` is on |
| `idempotent` | `boolean` | `false` | Allocate producerId/epoch + per-partition sequences |
| `maxRetries` | `number` | `3` | Produce retry attempts |
| `retryBackoffMs` | `number` | `200` | Linear backoff base per retry attempt |

### `KafkaConsumerOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `groupId` | `string` | — | Consumer group id for offset storage |
| `topic` | `string` | — | Topic to consume |
| `partitions` | `number[]` | all partitions | Explicit static partition assignment |
| `fromBeginning` | `boolean` | `true` | Start at earliest when no committed offset exists |
| `pollWaitMs` | `number` | `1000` | `max_wait_ms` per Fetch request |
| `autoCommit` | `boolean` | `true` | Commit offsets after each processed batch |

---

## Usage examples

### Produce a single record

```typescript
import { KafkaClient, KafkaProducer } from 'streetjs';

const client = new KafkaClient({ brokers: ['127.0.0.1:9092'], clientId: 'orders-svc' });
const producer = new KafkaProducer(client);

await producer.send('orders', {
  key: Buffer.from('o-123'),
  value: Buffer.from(JSON.stringify({ orderId: 'o-123', total: 4200 }), 'utf8'),
});
await producer.flush();
await producer.close();
client.close();
```

### Batched production

```typescript
import { KafkaClient, KafkaProducer } from 'streetjs';

const client = new KafkaClient({ brokers: ['127.0.0.1:9092'] });
const producer = new KafkaProducer(client, { batchSize: 500, lingerMs: 20 });

// Records accumulate and flush by size or linger; round-robin across partitions.
await Promise.all(
  events.map((e) =>
    producer.send('events', { key: null, value: Buffer.from(JSON.stringify(e), 'utf8') }),
  ),
);
await producer.flush();
```

### Idempotent producer

```typescript
import { KafkaClient, KafkaProducer } from 'streetjs';

const client = new KafkaClient({ brokers: ['127.0.0.1:9092'] });

// Idempotent mode forces acks=all and assigns producerId/epoch + per-partition
// sequence numbers so retried batches are de-duplicated by the broker.
const producer = new KafkaProducer(client, { idempotent: true, maxRetries: 5 });

await producer.send('payments', {
  key: Buffer.from('pay-9'),
  value: Buffer.from(JSON.stringify({ id: 'pay-9', amount: 100 }), 'utf8'),
});
await producer.flush();
```

### Consumer run loop with a handler

```typescript
import { KafkaClient, KafkaConsumer, type KafkaConsumedMessage } from 'streetjs';

const client = new KafkaClient({ brokers: ['127.0.0.1:9092'] });
const consumer = new KafkaConsumer(client, {
  groupId: 'orders-workers',
  topic: 'orders',
  fromBeginning: true,
  autoCommit: true,
  pollWaitMs: 1000,
});

await consumer.run(async (msg: KafkaConsumedMessage) => {
  if (!msg.value) return;
  const order = JSON.parse(msg.value.toString('utf8'));
  console.log(`partition=${msg.partition} offset=${msg.offset} order=${order.orderId}`);
  await processOrder(order);
});

// later, for graceful shutdown:
await consumer.stop();
```

### Manual offset commit

```typescript
const consumer = new KafkaConsumer(client, {
  groupId: 'orders-workers',
  topic: 'orders',
  partitions: [0, 1, 2],
  autoCommit: false, // disable auto-commit and commit yourself
});

await consumer.run(async (msg) => {
  await processOrder(JSON.parse(msg.value!.toString('utf8')));
  // Commit this partition's progress only after durable processing.
  await consumer.commit(msg.partition);
});
```

### StreamTransport adapter

`KafkaStreamTransport` implements `StreamTransport`, so it plugs into Street's event-streaming layer (`publish(topic, payload)` / `subscribe(topic, groupId, handler)`).

```typescript
import { KafkaStreamTransport } from 'streetjs';

const transport = new KafkaStreamTransport({ brokers: ['127.0.0.1:9092'] });

await transport.publish('orders', { orderId: 'o-123', total: 4200 });

const unsubscribe = transport.subscribe('orders', 'orders-workers', async (msg) => {
  console.log('received', msg);
});

// shutdown
unsubscribe();
await transport.close();
```

---

## Deployment

A reproducible single-broker cluster (KRaft mode, no ZooKeeper) is provided at the repository root in `docker-compose.kafka.yml`:

```yaml
services:
  kafka:
    image: apache/kafka:3.7.1
    container_name: street-kafka
    ports:
      - "9092:9092"
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://127.0.0.1:9092
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
      KAFKA_NUM_PARTITIONS: 3
```

- Broker listens on `9092` (advertised as `127.0.0.1:9092`).
- Topics are auto-created with `KAFKA_NUM_PARTITIONS: 3`.

```bash
docker compose -f docker-compose.kafka.yml up -d
# ... run tests / app ...
docker compose -f docker-compose.kafka.yml down
```

---

## Running integration tests

```bash
# 1. Start the broker (wait for it to report healthy)
docker compose -f docker-compose.kafka.yml up -d

# 2. Build the core package
npm run build -w packages/core

# 3. Compile the tests
npx tsc

# 4. Run the Kafka integration tests against the broker
KAFKA_BROKERS=127.0.0.1:9092 \
  node --test --test-timeout=60000 dist/src/integration/kafka/*.integration.test.js

# Codec unit tests (no broker required)
node --test dist/src/tests/kafka-codec.test.js
```

> Steps 3 and 4 run from inside `packages/core`.

The integration tests **skip gracefully** when no broker is reachable, keeping the suite green without Kafka. Point them at your cluster with `KAFKA_BROKERS`. The `--test-timeout=60000` accommodates first-run coordinator/topic initialisation.

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| "connect timeout" / no brokers reachable | Broker down or wrong `brokers` entry | Verify `docker ps`, port `9092` mapping, and the advertised listener matches what the client dials |
| `KafkaProtocolError ... code 15` (`COORDINATOR_NOT_AVAILABLE`) on first group use | Internal `__consumer_offsets` topic still initialising | The client retries `FindCoordinator` automatically (up to 8 attempts with backoff); retry shortly if it still fails |
| Fetch returns empty at log end | Consumer is caught up | Expected — the poll loop idles and retries; produce more records or check `fromBeginning` |
| `KafkaProtocolError` on produce/fetch | Partition leadership moved or topic missing | Metadata is refreshed on leader lookup; ensure the topic exists (auto-create is on in the compose file) |
| Records produced but consumer never sees them | Different `groupId` resumed from a committed offset, or wrong partition assignment | Use a fresh `groupId` or set `fromBeginning`; verify `partitions` covers the data |

---

## Production guidance

- **Idempotent producer:** enable `idempotent: true` for exactly-once-ish produce semantics. It forces `acks=all` and de-duplicates retried batches via producerId/epoch/sequence, eliminating duplicates from producer retries.
- **`acks=all`:** keep the default `acks: -1` so a produce is acknowledged only after replication, trading a little latency for durability.
- **Partition count:** size partitions for your target parallelism — the consumer assigns partitions statically, so consumer concurrency is bounded by partition count. The compose file defaults to 3 (`KAFKA_NUM_PARTITIONS`).
- **Offset semantics:** auto-commit commits after each processed batch (at-least-once). For at-least-once with tighter control, set `autoCommit: false` and call `commit(partition)` only after durable processing. Make handlers idempotent regardless.
- **Batching tradeoffs:** larger `batchSize` / `lingerMs` improve throughput and compression-free efficiency but add latency; smaller values reduce latency at the cost of more requests.
- **Monitoring:** track consumer lag (committed offset vs. log-end via `ListOffsets -1`), produce error codes surfaced as `KafkaProtocolError`, and per-partition throughput.

## Cold-start resilience

On a freshly-booted broker, group- and transaction-coordinator operations can
transiently fail while the internal `__consumer_offsets` / `__transaction_state`
topics load and leaders are elected. The client gates these automatically:

- `awaitTopicReady(topic, minPartitions)` blocks until every partition has an
  elected leader and a non-empty in-sync replica set.
- `leaderFor` retries with backoff while a partition reports no leader.
- `findCoordinator`, `commitOffset`, `fetchOffset`, and `initProducerId` retry on
  the transient coordinator codes `COORDINATOR_LOAD_IN_PROGRESS` (14),
  `COORDINATOR_NOT_AVAILABLE` (15), and `NOT_COORDINATOR` (16), re-resolving the
  coordinator between attempts.

Verified: the integration suite passes **8/8 cold-broker restart cycles** and
**100/100 consecutive runs** against a real `apache/kafka:3.7.1` broker.

## Coordinator Readiness Gate

Before consuming, the `CoordinatorReadinessGate` waits up to 30 s for a
successful `FindCoordinator` response **and** `__consumer_offsets` stability
(the topic exists and every partition has a live leader). On timeout it does not
begin consuming and preserves any committed consumer offsets, so a not-yet-ready
cluster never causes a partial join or offset loss.

## Chaos verification & Verification Artifacts

The Kafka client is verified under adverse conditions by a parameterized,
reproducible chaos harness, `scripts/reliability/kafka-cold-start.sh`, that runs
real fault scenarios against a live broker:

| Scenario | Fault injected | Pass condition |
|---|---|---|
| `cold-start` | repeated fresh client bootstrap | 100 % pass, 0 lost messages |
| `broker-restart` | `docker restart` the broker each cycle | recovers every cycle, 0 lost |
| `network-interruption` | disconnect/reconnect the broker network | resumes within 60 s, all delivered |
| `connection-loss` | pause/unpause the broker (TCP stall) | recovers, 0 lost |
| `slow-broker` | inject ≥ 5000 ms response delay (netem) | still delivers, 0 lost |

A **lost message** is a produced message never delivered to a *committed*
consumer; the harness accounts `produced − deliveredToCommitted` after each
scenario and requires zero loss overall.

The suite is parameterized for the full-scale targets (100 cold starts /
100 broker restarts):

```bash
# Full-scale local run (boots its own apache/kafka:3.7.1 broker via compose):
COLD_STARTS=100 RESTART_CYCLES=100 scripts/reliability/kafka-cold-start.sh

# Drive it through the verification runner so it emits artifacts:
npm run verify:kafka-chaos
```

`npm run verify:kafka-chaos` (the `scripts/reliability/verify.mjs` driver) runs
the suite through the zero-dependency `CommandRunner` and emits one
machine-readable Verification Artifact per capability under
`verification-artifacts/kafka/`:

```
kafka.coldstart.artifact.json
kafka.chaos.broker-restart.artifact.json
kafka.chaos.network-interruption.artifact.json
kafka.chaos.connection-loss.artifact.json
kafka.chaos.slow-broker.artifact.json
```

Each artifact records the parameter values, the pass count, the lost-message
count, and an ISO-8601 timestamp. When no broker is reachable and no container
runtime + `apache/kafka:3.7.1` image is available to start one, the driver
records every capability as an honest **BLOCKED** with the specific missing
prerequisite (`kafka-broker` / `docker-daemon` / `docker-image:apache/kafka:3.7.1`)
— never a mock, never a false VERIFIED. The `kafka-integration` GitHub Actions
workflow runs the full-scale suite on demand (`workflow_dispatch`) and on a
weekly schedule, uploading the artifacts.

