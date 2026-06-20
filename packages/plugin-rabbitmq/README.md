<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-rabbitmq

Official StreetJS plugin: **RabbitMQ** messaging (AMQP 0-9-1).

Wraps the dependency-free RabbitMQ transport shipped by `streetjs` — a
from-scratch AMQP 0-9-1 client (connection manager with reconnect, a confirming
publisher, and an acknowledging consumer with DLQ support). The plugin validates
connection config and injects a ready client into each request via the sandboxed
middleware surface.

## Install

```bash
npm install @streetjs/plugin-rabbitmq
# or, via the CLI:
street add rabbitmq
```

## Configuration

```ts
import { RabbitMqPlugin } from '@streetjs/plugin-rabbitmq';

const plugin = new RabbitMqPlugin({
  host: '127.0.0.1',
  port: 5672,
  username: 'guest',          // username + password must be provided together
  password: 'guest',
  vhost: '/',
  exchange: 'street.events',  // topic exchange (default 'street.events')
  prefetch: 50,               // consumer prefetch (default 50)
  stateKey: 'rabbitmq',       // ctx.state key (default 'rabbitmq')
});
```

| Field | Type | Required | Default | Notes |
|-------|------|:--------:|---------|-------|
| `host` | string | yes | — | non-empty |
| `port` | number | yes | — | integer 1–65535 |
| `username` / `password` | string | no | — | must be provided together |
| `vhost` | string | no | — | virtual host |
| `exchange` | string | no | `street.events` | topic exchange |
| `prefetch` | number | no | `50` | consumer prefetch |
| `connectTimeoutMs` | number | no | — | connect timeout |
| `heartbeatSeconds` | number | no | — | AMQP heartbeat |
| `stateKey` | string | no | `rabbitmq` | request-state injection key |

## Usage

```ts
import { Controller, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';
import type { RabbitMqClient } from '@streetjs/plugin-rabbitmq';

@Controller('/events')
class EventsController {
  @Post('/order')
  async publish(ctx: StreetContext) {
    const mq = ctx.state['rabbitmq'] as RabbitMqClient;
    await mq.publish('orders.created', JSON.stringify(ctx.body)); // awaits broker confirm
    ctx.status(202).json({ accepted: true });
  }
}
```

Consuming (e.g. in a worker), with an optional dead-letter exchange:

```ts
await mq.consume('order-workers', ['orders.*'], async (msg) => {
  console.log(msg.body.toString('utf8')); // throw to nack → routed to the DLX
}, 'street.events.dlx');
```

## Security

- **Permissions:** `net` (TCP to the broker) and `middleware` (request injection).
- The manifest is **Ed25519-signed** (`manifest.signed.json`, verifiable against
  `manifest.pub`) and verified on install by the plugin host.
- No third-party runtime dependencies — the AMQP client is built on Node.js core,
  minimizing supply-chain surface.
- Publishes use publisher confirms; failed handlers nack without requeue so the
  broker routes to the configured dead-letter exchange instead of hot-looping.

## License

MIT
