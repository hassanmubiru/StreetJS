# @streetjs/gateway

StreetJS API Gateway & Edge Framework. A strongly-typed, additive reverse proxy
that layers over the `streetjs` core: priority/wildcard/regex routing, pluggable
load balancing, health-filtered upstreams, circuit breaking, retries and
timeouts, rate limiting, authentication/authorization, request validation,
response transformation, API versioning, CORS, compression, structured logging,
metrics/observability, a plugin, a CLI, and in-process testing utilities.

It is **additive and backwards compatible**: it makes zero modifications to the
`streetjs` core public API. Its only runtime dependency is `streetjs`; the
sibling pillar packages (`@streetjs/realtime`, `@streetjs/queue`,
`@streetjs/events`, `@streetjs/storage`) are declared as **optional peer
dependencies** and are never statically imported by the base entry.

- ESM / NodeNext, strict TypeScript.
- Deterministic: all time flows through an injectable `Clock`, all randomness
  through an injectable `rng`, and all forwarding through an injectable
  `Forwarder`, so a gateway can be driven reproducibly under test.

## Install

```bash
npm install @streetjs/gateway streetjs
```

## Quick start

```ts
import { createGateway } from "@streetjs/gateway";

const gateway = createGateway({
  services: [
    { name: "users-service", targets: [{ id: "u1", url: "http://127.0.0.1:4001" }] },
    { name: "orders-service", targets: [{ id: "o1", url: "http://127.0.0.1:4002" }] },
  ],
  routes: [
    { pattern: "/users", kind: "prefix", service: "users-service" },
    { pattern: "/orders", kind: "prefix", service: "orders-service" },
  ],
  cors: { origins: ["https://app.example.com"], credentials: true },
  compression: { enabled: true, threshold: 1024 },
  defaults: {
    timeoutMs: 5_000,
    retry: { maxAttempts: 2, baseDelayMs: 50 },
    rateLimit: { scope: "ip", limit: 100, windowMs: 60_000 },
  },
});

const res = await gateway.handle({
  method: "GET",
  path: "/users/42",
  url: "/users/42",
  headers: {},
});
console.log(res.status);
```

`gateway.handle(req)` runs one request through the full pipeline and resolves a
`GatewayResponse`. Bind it to a `node:http` server (or any transport) by
translating the incoming request into a `GatewayRequest` and writing the
`GatewayResponse` back — see [`docs/configuration.md`](./docs/configuration.md).

## Request pipeline

```
requestId/logging → body-size limit → CORS → versioning → routing → policy merge
→ rate limit → auth → authz → upstream selection (health filter + load balance)
→ circuit breaker → forward (retry + per-attempt timeout) → response transform
(security headers, CORS, compression) → structured log + telemetry
```

`use()`-registered middleware wrap the terminal forward handler as an onion:
they run in registration order on the way in and reverse order on the way out,
and may short-circuit or transform the response.

## Reverse proxy & WebSocket upgrades

`httpForwarder` is the default HTTP(S) forwarder (streaming request body, header
forwarding, `AbortSignal` cancellation). `proxyWebSocketUpgrade` bridges a
client `upgrade` event to an upstream, establishing a bidirectional byte tunnel.

## Testing utilities (`@streetjs/gateway/testing`)

- `FakeBackend` — a real in-process `node:http` server (loopback, ephemeral
  port) a gateway can forward to; records every request.
- `GatewayHarness` — a real gateway wired to `httpForwarder`, with backend
  registration and status-assertion helpers.
- `FakeGateway` — a recording `Gateway` double that returns canned/queued
  responses without any real forwarding.

Nothing here touches the internet.

## CLI

`GatewayCommands` provides the following `@Command`-decorated commands. They are
**registered by your application through the core `CliKernel`** (construct
`GatewayCommands` and register it, optionally passing a `Gateway`/`GatewayConfig`
for the operational commands) — they are **not** part of the standalone
`@streetjs/cli` (`street`) built-in command set. Once registered they are
invoked as:

- `make:gateway-route <Name> [--dir <dir>]` — scaffold a typed route.
- `make:proxy <Name> [--dir <dir>]` — scaffold a proxy/gateway setup.
- `gateway:routes` — list configured routes as `pattern → service`.
- `gateway:health` — print upstream health counts + per-target state.

## Example

A runnable, fully in-process example (Browser → Gateway → three backends →
Realtime/Storage/Queue/Events) lives under `src/examples/edge`:

```bash
npm run example
```

## Documentation

- [Architecture](./docs/architecture.md)
- [Configuration](./docs/configuration.md)
- [Security guide](./docs/security.md)
- [Migration guide](./docs/migration.md)
- [Performance tuning](./docs/performance.md)

## Development

```bash
npm run build   # tsc → dist/
npm test        # node --test dist/tests/*.test.js
npm run lint    # tsc --noEmit
```

## License

MIT
