<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-kafka

Official StreetJS plugin: **Apache Kafka** streaming.

Wraps the dependency-free `KafkaStreamTransport` shipped by `streetjs` (a
from-scratch Kafka protocol client built on Node.js core — no vendor SDK). The
plugin validates connection config and injects a ready transport into each
request via the sandboxed middleware surface.

## Install

```bash
npm install @streetjs/plugin-kafka
# or, via the CLI:
street add kafka
```

## Configuration

```ts
import { KafkaPlugin } from '@streetjs/plugin-kafka';

const plugin = new KafkaPlugin({
  brokers: ['127.0.0.1:9092'], // OR host: '127.0.0.1', port: 9092
  clientId: 'my-service',      // default 'street-kafka'
  connectTimeoutMs: 10000,     // default 10000
  stateKey: 'kafka',           // ctx.state key (default 'kafka')
});
```

| Field | Type | Required | Default | Notes |
|-------|------|:--------:|---------|-------|
| `brokers` | string[] | one of brokers/host | — | `"host:port"` entries |
| `host` | string | one of brokers/host | — | single-broker host |
| `port` | number | no | `9092` | single-broker port |
| `clientId` | string | no | `street-kafka` | advertised client id |
| `connectTimeoutMs` | number | no | `10000` | connect timeout |
| `stateKey` | string | no | `kafka` | request-state injection key |

## Usage

```ts
import { Controller, Post } from 'streetjs';
import type { StreetContext, KafkaStreamTransport } from 'streetjs';

@Controller('/events')
class EventsController {
  @Post('/order')
  async publish(ctx: StreetContext) {
    const kafka = ctx.state['kafka'] as KafkaStreamTransport;
    await kafka.publish('orders.created', ctx.body);
    ctx.status(202).json({ accepted: true });
  }
}
```

Consuming (e.g. in a worker):

```ts
const unsubscribe = kafka.subscribe('orders.created', 'order-workers', async (msg) => {
  console.log('order event', msg);
});
// later: unsubscribe();
```

## Security

- **Permissions:** `net` (TCP to brokers) and `middleware` (request injection).
- The manifest is **Ed25519-signed** (`manifest.signed.json`, verifiable against
  `manifest.pub`) and verified on install by the plugin host.
- No third-party runtime dependencies — the Kafka protocol client is built on
  Node.js core, minimizing supply-chain surface.
- Broker strings are validated (`host:port`, port in range) before use.

## License

MIT
