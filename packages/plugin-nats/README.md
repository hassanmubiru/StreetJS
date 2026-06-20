<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-nats

Official StreetJS plugin: **NATS** publish/subscribe messaging.

A standalone package that extends the core `PluginModule` SDK. It ships a
**dependency-free** NATS client built on `node:net` — no vendor SDK required —
and injects a connected client into each request via the sandboxed middleware
surface.

## Install

```bash
npm install @streetjs/plugin-nats
# or, via the CLI:
street add nats
```

## Configuration

```ts
import { NatsPlugin } from '@streetjs/plugin-nats';

const plugin = new NatsPlugin({
  host: '127.0.0.1',
  port: 4222,
  // optional auth — token, OR user+pass (provided together):
  // token: process.env.NATS_TOKEN,
  // user: 'app', pass: process.env.NATS_PASS,
  name: 'my-service',     // advertised connection name (default 'streetjs')
  timeoutMs: 5000,        // connect/flush timeout (default 5000)
  stateKey: 'nats',       // ctx.state key for the injected client (default 'nats')
});
```

| Field | Type | Required | Default | Notes |
|-------|------|:--------:|---------|-------|
| `host` | string | yes | — | non-empty |
| `port` | number | yes | — | integer 1–65535 |
| `token` | string | no | — | token auth |
| `user` / `pass` | string | no | — | must be provided together |
| `name` | string | no | `streetjs` | advertised connection name |
| `timeoutMs` | number | no | `5000` | connect/flush timeout |
| `stateKey` | string | no | `nats` | request-state injection key |

## Usage

The plugin injects a connected `NatsClient` into `ctx.state[stateKey]`:

```ts
import { Controller, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';
import type { NatsClient } from '@streetjs/plugin-nats';

@Controller('/events')
class EventsController {
  @Post('/order')
  async publishOrder(ctx: StreetContext) {
    const nats = ctx.state['nats'] as NatsClient;
    nats.publish('orders.created', JSON.stringify(ctx.body));
    await nats.flush(); // confirm the server processed the publish
    ctx.status(202).json({ accepted: true });
  }
}
```

Subscribing (e.g. in a worker):

```ts
const sid = nats.subscribe('orders.*', (msg) => {
  console.log(msg.subject, msg.data.toString('utf8'));
}, 'order-workers'); // optional queue group for load-balanced delivery

// later:
nats.unsubscribe(sid);
```

## Security

- **Permissions:** `net` (TCP to the broker) and `middleware` (request injection).
- The manifest is **Ed25519-signed** (`manifest.signed.json`, verifiable against
  `manifest.pub`) and verified on install by the plugin host.
- No third-party runtime dependencies — the entire NATS protocol client is built
  on Node.js core, minimizing supply-chain surface.
- Subject names are validated (non-empty, no whitespace/NUL) before being written
  to the wire to prevent protocol injection.

## Protocol coverage

`CONNECT`, `PUB`, `SUB`, `UNSUB`, `PING`/`PONG` (including server-heartbeat
auto-reply), `MSG` delivery, `INFO`, `+OK`, and `-ERR`. The codec functions
(`encodeConnect`, `encodePub`, `encodeSub`, `encodeUnsub`, `parseFrame`) are
exported as testable seams.

## License

MIT
