# RabbitMQ Transport

A from-scratch **AMQP 0-9-1** client and event transport for the Street Framework, built directly on `node:net` with **zero third-party libraries** (no `amqplib`, no `rascal`). It powers durable, at-least-once event delivery for the Street `EventBus` and can also be used standalone as a low-level publisher/consumer.

- Source: `packages/core/src/transports/rabbitmq/` (`codec.ts`, `connection.ts`, `index.ts`)
- Package: `@streetjs/core`

---

## Overview

The RabbitMQ transport speaks the AMQP 0-9-1 wire protocol end to end:

- Full connection handshake (`Connection.Start` → `Start-Ok` → `Tune` → `Tune-Ok` → `Open` → `Open-Ok`)
- Single working channel management
- Exchange and queue declaration (`direct`, `fanout`, `topic`)
- Topic / fanout / direct routing via routing keys and bindings
- **Publisher confirms** (`Confirm.Select`, `Basic.Ack`/`Basic.Nack` correlation)
- **Consumer ack model** (`Basic.Consume`, `Basic.Deliver`, `Basic.Ack`/`Basic.Nack`)
- **Dead-letter exchange (DLX)** routing + retry semantics
- Automatic reconnect with exponential backoff
- Heartbeats and graceful shutdown

### Public exports

All of the following are exported from `@streetjs/core`:

| Export | Kind | Purpose |
| --- | --- | --- |
| `RabbitMqTransport` | class | `EventBusTransport` adapter (`publish(topic, envelope)` / `subscribe(topic, handler)`) |
| `RabbitMqConnectionManager` | class | Reconnecting connection supplier with exponential backoff |
| `RabbitMqPublisher` | class | Confirming publisher bound to a topic exchange |
| `RabbitMqConsumer` | class | Acknowledging consumer with DLX + routing-key bindings |
| `AmqpConnection` | class | Low-level AMQP 0-9-1 connection / single-channel manager |
| `RabbitMqOptions` | type | Transport-level options |
| `ConsumerOptions` | type | Per-consumer queue / routing / DLX options |
| `AmqpConnectionOptions` | type | Connection-level options |
| `DeliveredMessage` | type | A delivered message handed to consumers |

```typescript
import {
  RabbitMqTransport,
  RabbitMqConnectionManager,
  RabbitMqPublisher,
  RabbitMqConsumer,
  AmqpConnection,
  type RabbitMqOptions,
  type ConsumerOptions,
  type AmqpConnectionOptions,
  type DeliveredMessage,
} from '@streetjs/core';
```

---

## Architecture

### Frame codec (`codec.ts`)

Every AMQP frame is `[type:1][channel:2][size:4][payload:size][0xCE]`. The codec provides:

- `AmqpWriter` — a fluent encoder for AMQP field types: `octet`, `shortUint`, `longUint`, `longLong`, `shortStr` (≤ 255 bytes), `longStr`, `table` (field tables with `S`/`t`/`I`/`F`/`V` field types), and `bits` (LSB-first packed booleans).
- `AmqpReader` — the matching decoder (`octet`, `shortUint`, `longUint`, `longLong`, `shortStr`, `longStr`, `bit`, `skipTable`).
- Frame builders: `buildFrame`, `buildMethodFrame`, `buildHeaderFrame`, `buildBodyFrame`, `buildHeartbeat`.
- `FrameDecoder` — an incremental decoder that accumulates socket bytes and yields complete `RawFrame`s, validating the `0xCE` frame-end byte.
- `readMethodHeader` — parses the `class-id`/`method-id` prefix of a method frame.

The protocol header sent first on every connection is `AMQP\0\0\9\1` (`PROTOCOL_HEADER`).

### Connection lifecycle (`connection.ts`)

`AmqpConnection` extends `EventEmitter` and drives the handshake reactively from inbound frames over a single channel (channel `1`):

1. TCP connect, then write `PROTOCOL_HEADER`.
2. On `Connection.Start` (class 10, method 10) → send `Start-Ok` with `PLAIN` SASL credentials (`\0username\0password`) and client properties (`product: street-framework`).
3. On `Connection.Tune` (10, 30) → reply `Tune-Ok` echoing channel-max/frame-max and **our** heartbeat interval, then send `Connection.Open` for the vhost.
4. On `Connection.Open-Ok` (10, 41) → open the working channel (`Channel.Open`), start heartbeats, and resolve `connect()`.
5. `Connection.Close` (10, 50) from the server is answered with `Close-Ok` and surfaced as an `error` event.

Synchronous server replies are matched by a `class.method` → resolver map (`_rpc`), so declarations and QoS calls return promises that resolve when the broker acks them.

### Publisher confirms

`enableConfirms()` sends `Confirm.Select` and flips the channel into confirm mode. Each `publish` then allocates a monotonic delivery tag and registers a resolver. Inbound `Basic.Ack` (60, 80) resolves the publish promise; `Basic.Nack` (60, 120) rejects it. The `multiple` flag is honoured, so a single ack with `multiple=true` resolves every pending tag `<= tag`.

```text
publish → Basic.Publish + content header + body frames → (await confirm)
broker  → Basic.Ack(tag, multiple?)  → resolve
broker  → Basic.Nack(tag, multiple?) → reject('publish nacked')
```

### Consumer ack model

`consume(queue, handler)` issues `Basic.Consume` and registers the server-assigned consumer tag. Deliveries arrive as three frames that the connection reassembles:

1. `Basic.Deliver` (60, 60) — consumer tag, delivery tag, redelivered flag, exchange, routing key.
2. Content **header** frame — carries the body size.
3. One or more **body** frames — concatenated until `bodySize` bytes are collected, then the `DeliveredMessage` is dispatched.

The higher-level `RabbitMqConsumer` awaits your handler and then:

- **success →** `ack(deliveryTag)`
- **throw →** `nack(deliveryTag, requeue=false)` so the broker routes the message to the configured DLX (or drops it if none is set).

### DLQ routing

When `ConsumerOptions.deadLetterExchange` is set, the consumer declares the DLX (as a durable `fanout` exchange) and declares the work queue with the `x-dead-letter-exchange` argument. Because failed messages are nacked **without requeue**, the broker dead-letters them to the DLX. Bind a DLQ queue to that exchange to capture and inspect failures or drive a retry pipeline.

```text
work queue (x-dead-letter-exchange = street.events.dlx)
   └─ handler throws → nack(requeue=false) → broker → DLX (fanout) → dlq.queue
```

### Reconnect & heartbeats

`RabbitMqConnectionManager.get()` returns a live connection, (re)connecting on demand. On `disconnect` it eagerly reconnects so consumers resume. Backoff is exponential: `min(reconnectBaseMs * 2^attempt, reconnectMaxMs)`. Consumers register via `onReconnect(...)` so their queues/bindings/QoS and `Basic.Consume` are re-established on a fresh connection.

Heartbeats are sent on a timer at half the negotiated `heartbeatSeconds` interval (the timer is `unref()`-ed so it never keeps the process alive). `heartbeatSeconds <= 0` disables heartbeats.

---

## Configuration

### `RabbitMqOptions`

`RabbitMqOptions` extends `AmqpConnectionOptions` and adds transport-level fields.

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `exchange` | `string` | `'street.events'` | Topic exchange used for event routing |
| `reconnectBaseMs` | `number` | `500` | Exponential backoff base in ms |
| `reconnectMaxMs` | `number` | `30000` | Maximum backoff in ms |
| `prefetch` | `number` | `50` | Default consumer prefetch (QoS) |

### `AmqpConnectionOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `host` | `string` | `'127.0.0.1'` | Broker host |
| `port` | `number` | `5672` | AMQP port |
| `username` | `string` | `'guest'` | PLAIN SASL username |
| `password` | `string` | `'guest'` | PLAIN SASL password |
| `vhost` | `string` | `'/'` | Virtual host |
| `heartbeatSeconds` | `number` | `60` | Heartbeat interval in seconds (`<= 0` disables) |
| `connectTimeoutMs` | `number` | `10000` | TCP/handshake connect timeout in ms |

> Note: the connection option is named `heartbeatSeconds`.

### `ConsumerOptions`

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `queue` | `string` | — | Queue name to declare and consume from |
| `routingKeys` | `string[]` | — | Routing keys bound to the work queue |
| `deadLetterExchange` | `string` | — | DLX for messages that exhaust retries (optional) |
| `prefetch` | `number` | `50` | Per-consumer prefetch (QoS) |

---

## Usage examples

### Publisher with confirms

```typescript
import { RabbitMqConnectionManager, RabbitMqPublisher } from '@streetjs/core';

const manager = new RabbitMqConnectionManager({
  host: '127.0.0.1',
  port: 5672,
  username: 'guest',
  password: 'guest',
  exchange: 'street.events',
});

// The publisher lazily declares the durable topic exchange and enables confirms
// on first publish. Each publish resolves only after the broker confirms it.
const publisher = new RabbitMqPublisher(manager, 'street.events');

await publisher.publish('orders.created', JSON.stringify({ orderId: 'o-123' }), {
  persistent: true,
  contentType: 'application/json',
});

console.log('broker confirmed the publish');
```

### Consumer with DLQ + routing keys

```typescript
import {
  RabbitMqConnectionManager,
  RabbitMqConsumer,
  type DeliveredMessage,
} from '@streetjs/core';

const manager = new RabbitMqConnectionManager({ host: '127.0.0.1', port: 5672 });

const consumer = new RabbitMqConsumer(manager, 'street.events', {
  queue: 'orders.worker',
  routingKeys: ['orders.created', 'orders.updated'],
  deadLetterExchange: 'street.events.dlx',
  prefetch: 25,
});

await consumer.consume(async (msg: DeliveredMessage) => {
  const event = JSON.parse(msg.body.toString('utf8'));
  // Throwing nacks the message (requeue=false) → routed to the DLX.
  await handleOrder(event);
  // Returning normally acks the delivery.
});
```

To capture dead-lettered messages, bind a DLQ to the DLX and consume from it:

```typescript
import { AmqpConnection } from '@streetjs/core';

const conn = new AmqpConnection({ host: '127.0.0.1', port: 5672 });
await conn.connect();

await conn.declareExchange('street.events.dlx', 'fanout', { durable: true });
await conn.declareQueue('orders.dlq', { durable: true });
await conn.bindQueue('orders.dlq', 'street.events.dlx', '#');

await conn.consume('orders.dlq', (msg) => {
  console.error('dead-lettered:', msg.routingKey, msg.body.toString('utf8'));
  conn.ack(msg.deliveryTag);
});
```

### EventBus adapter usage

`RabbitMqTransport` implements `EventBusTransport`, so it drops into the Street `EventBus`. Topics map to routing keys on the shared durable topic exchange; each subscription gets its own durable queue (`street.<topic>.<pid>`) wired to a `<exchange>.dlx` dead-letter exchange.

```typescript
import { EventBus, RabbitMqTransport } from '@streetjs/core';

const transport = new RabbitMqTransport({
  host: '127.0.0.1',
  port: 5672,
  exchange: 'street.events',
});

const bus = new EventBus(transport);

// Publish an envelope-wrapped event.
await bus.publish('orders.created', { orderId: 'o-123', total: 4200 });

// Subscribe; returns an unsubscribe function.
const unsubscribe = bus.subscribe('orders.created', async (env) => {
  console.log('received', env.id, env.payload);
});

// On shutdown:
unsubscribe();
await transport.close();
```

---

## Deployment

A reproducible broker is provided at the repository root in `docker-compose.rabbitmq.yml`:

```yaml
services:
  rabbitmq:
    image: rabbitmq:3.13-management
    container_name: street-rabbitmq
    ports:
      - "5672:5672"     # AMQP
      - "15672:15672"   # Management UI
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 5s
      timeout: 10s
      retries: 12
```

- AMQP listens on `5672`.
- The management UI is on `15672` (http://localhost:15672, login `guest` / `guest`).

```bash
docker compose -f docker-compose.rabbitmq.yml up -d
# ... run tests / app ...
docker compose -f docker-compose.rabbitmq.yml down
```

---

## Running integration tests

```bash
# 1. Start the broker
docker compose -f docker-compose.rabbitmq.yml up -d

# 2. Build the core package
npm run build -w packages/core

# 3. Compile the tests
npx tsc

# 4. Run the RabbitMQ integration tests against the broker
RABBITMQ_HOST=127.0.0.1 RABBITMQ_PORT=5672 \
  node --test dist/src/integration/rabbitmq/*.integration.test.js
```

> Steps 3 and 4 run from inside `packages/core`.

The integration tests **skip gracefully** when no broker is reachable, so the suite stays green in environments without RabbitMQ. Set `RABBITMQ_HOST` / `RABBITMQ_PORT` to point the tests at your broker.

---

## Troubleshooting

| Symptom | Likely cause | Resolution |
| --- | --- | --- |
| `ECONNREFUSED` / "connect timeout" | Broker not running or wrong host/port | Verify the container is up (`docker ps`) and `port 5672` is mapped; check `connectTimeoutMs` |
| `AMQP server closed connection: 403 ...` | Auth failure (bad `username`/`password` or vhost permissions) | Confirm credentials and that the user has access to `vhost` |
| Unacked messages piling up | Handler never returns/throws, or prefetch too high | Ensure handlers settle; lower `prefetch`; check for blocked event loop |
| DLQ not receiving messages | DLX not declared / queue missing `x-dead-letter-exchange`, or messages requeued | Set `deadLetterExchange`; confirm the work queue was declared with the DLX argument; failures must `nack(requeue=false)` |
| Publishes never resolve | Confirms enabled but broker dropped the channel | Check connectivity; the manager reconnects, but in-flight confirm promises from a dead connection will not resolve — retry after reconnect |

---

## Production guidance

- **Durability:** declare exchanges and queues as `durable` (the defaults) and publish `persistent` messages so data survives broker restarts.
- **Prefetch tuning:** start at `prefetch: 50` and tune to your handler latency. Lower it for slow handlers to avoid one consumer hogging the queue; raise it for fast, cheap handlers to increase throughput.
- **At-least-once:** keep publisher confirms enabled (the publisher does this automatically) and only ack after your handler has durably processed the message.
- **Idempotent consumers:** because delivery is at-least-once (and DLX retries can re-deliver), make handlers idempotent — dedupe on the envelope `id` or a business key.
- **Dead-letter strategy:** always configure a DLX in production so poison messages are quarantined instead of silently dropped, and monitor the DLQ depth.
- **Monitoring:** use the management UI on `15672` to watch queue depth, unacked counts, publish/confirm rates, and connection/heartbeat health.
