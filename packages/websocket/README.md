# @streetjs/websocket

The realtime foundation for StreetJS: a **hardened WebSocket server** (origin + auth
gating, heartbeat, capacity limits), an event-framed socket, a **Server-Sent Events**
connection, and a transport-agnostic **channel hub** with presence and typing.

Built on [`ws`](https://github.com/websockets/ws) (its only runtime dependency), matching
the StreetJS minimal, carefully curated dependency footprint. Generic and reusable by any
application.

```bash
npm install @streetjs/websocket
```

> This is the standalone home of the realtime transport that also backs the
> `streetjs/websocket` and `streetjs/sse` subpaths; the `streetjs` framework re-exports
> it, so there is a single implementation.

## WebSocket server

```ts
import { StreetWebSocketServer } from '@streetjs/websocket';

const ws = new StreetWebSocketServer({
  path: '/ws',
  heartbeatIntervalMs: 30_000,
  maxConnections: 10_000,
  allowedOrigins: ['https://app.example.com'], // omit → same-origin only
  authFn: async (req) => verifyToken(req),      // reject → 401 before upgrade
});

ws.attach(httpServer, (socket) => {
  socket.on('chat', (msg) => ws.broadcast('chat', msg));
  socket.onClose(() => cleanup());
});
```

- **Origin gating** — cross-origin upgrades are rejected with `403` before the handshake
  (no `Origin` header is allowed for non-browser clients; malformed origins are rejected).
- **Auth gating** — an optional `authFn` runs before the upgrade; failure/throw → `401`.
  In production, a server with no `authFn` logs a one-time security warning.
- **Heartbeat** — optional ping/pong reaps dead connections.
- **Capacity** — connections beyond `maxConnections` are closed with `1013`.
  Enable pre-upgrade admission below to reject overload with HTTP `503` instead.
- **`attachProtocol(server, subprotocol, handler)`** — negotiate a custom subprotocol
  (e.g. `graphql-transport-ws`) and own the raw framing.

### Gateway admission for larger deployments

```ts
const ws = new StreetWebSocketServer({
  path: '/ws',
  maxConnections: 10_000,
  maxPendingUpgrades: 100,
  upgradeTimeoutMs: 5_000,
  maxBufferedBytes: 256 * 1024,
  heartbeatIntervalMs: 30_000,
  authFn: async (req) => verifyToken(req),
});
```

These are example limits, not measured capacity. `maxPendingUpgrades` is opt-in
and must be a positive integer. When enabled:

- The server reserves a slot **before authentication**, after origin validation.
  Both `attach` and `attachProtocol` share the same budget.
- Active connections plus reservations cannot exceed `maxConnections`. Pending
  authentication/handshakes also cannot exceed `maxPendingUpgrades`.
- Overload returns HTTP `503` with `Retry-After: 1`, without running `authFn`
  or the application connection handler. `connectionCount` counts active sockets only.
- `upgradeTimeoutMs` (default 10,000) destroys an overdue upgrade socket. A late
  authentication result cannot admit it. The auth call retains its reservation
  until it settles, preventing a hung backend from accumulating more auth calls.
  Set timeouts on authentication's database/HTTP calls too; the socket deadline
  cannot cancel application promises.
- Shutdown destroys pending sockets and prevents late upgrades.

Without `maxPendingUpgrades`, the existing post-handshake `1013` capacity behavior
remains in effect and there is no upgrade deadline.

### Slow-client protection

`maxBufferedBytes` defaults to **1 MiB per connection**. Before each framed send,
StreetJS compares `ws.bufferedAmount` plus the next JSON envelope's UTF-8 byte
length against this limit. A message that would exceed it is not queued; the
connection is terminated immediately. Clients normally observe abnormal closure
(`1006`), because waiting for a close handshake behind a stalled buffer would
retain that buffer. Transport write failures are isolated during fanout too.

The limit applies to `StreetSocket.emit()` (including room delivery through
`ChannelHub`) and `StreetWebSocketServer.broadcast()`. Broadcasts serialize once
and check each recipient independently, so healthy recipients continue receiving.
Socket close hooks remove disconnected members from hubs bound with `hub.bind()`.

Directly constructed sockets accept the same setting:

```ts
const socket = new StreetSocket(rawWebSocket, { maxBufferedBytes: 256 * 1024 });
```

Use a positive safe integer, or `Infinity` to restore unbounded framed sends.
This also limits individual outgoing messages, including their envelope overhead.
The budget covers application bytes and the transport's reported buffer, not
total process memory, serialization allocations, or kernel buffers. Budget across
all connections: even 1 MiB times 10,000 sockets is about 9.8 GiB.

Custom `attachProtocol` handlers own raw `ws.send()` calls and must enforce their
own backpressure policy; server broadcasts to those sockets use the limit above.
Disconnecting a slow consumer is not reliable message delivery: chat applications
still need persisted messages and a replay cursor after reconnect.

### Capacity planning toward millions of connections

Five million concurrent users is a fleet-level target, **not a verified StreetJS
capacity rating**. Count connections separately from users (multiple devices/tabs).
Measure a representative gateway's safe connection limit under the target message
rate, payload sizes, room sizes, TLS setup, and authentication latency.

For example, **if measured** safe capacity were 10,000 sockets per gateway, five
million sockets would require 500 gateways at full utilization, or 715 at 70%
utilization, before accounting for failure-domain loss. Increasing `maxConnections`
alone does not establish that capacity.

Before expanding a fleet, measure connection admission latency, auth concurrency,
RSS/heap, event-loop delay, outbound buffering, message latency, and broker traffic.
Test idle sockets, realistic room fanout, slow consumers, reconnect bursts, and
gateway/broker loss separately. Ramp from one gateway to a small cluster before
distributed load tests with independent load generators.

The current realtime Redis adapter uses one pub/sub topic per prefix, so all
gateways in that group receive every published event. Large fleets still need
room/tenant routing and partitioned fanout, reconnect jitter, and failure-domain
capacity testing. Admission and framed-send buffer limits are building
block toward that architecture.

### StreetSocket

The per-connection handle uses a `{ type, payload, ts }` envelope:

```ts
socket.on('event', (payload) => { ... });
socket.on('*', (envelope) => { ... }); // wildcard: full envelope
socket.emit('event', payload);
socket.onClose(() => { ... });
socket.close(code?, reason?);
socket.id; // stable per-connection id
```

## Server-Sent Events

```ts
import { createSse } from '@streetjs/websocket';

app.get('/stream', (req, res) => {
  const sse = createSse(res); // sets SSE headers + heartbeat
  sse.send({ event: 'update', data: { count: 1 } });
  sse.comment('keep-alive');
  req.on('close', () => sse.close());
});
```

CR/LF are stripped from `event`/`id` to prevent frame injection; multi-line data is
split into multiple `data:` lines.

## Channel hub (presence & typing)

Transport-agnostic rooms with reference-counted presence (multi-device correct):

```ts
import { ChannelHub } from '@streetjs/websocket';

const hub = new ChannelHub({ typingTtlMs: 4000 });

ws.attach(server, (socket) => {
  hub.bind(socket);                        // auto-cleanup on close
  hub.join('room:1', userId, socket);      // presence:join broadcast to others
  hub.publish('room:1', 'msg', payload, { exceptConnId: socket.id });
  hub.setTyping('room:1', userId, true, socket);
});

hub.presence('room:1');       // present member ids
hub.memberCount('room:1');
```

A member is "present" while any of their connections is in the channel, so reconnects
don't flicker presence. For horizontal scale, fan `publish`/presence through a pub/sub
layer.

## Dependency injection

Exports a `WEBSOCKET_SERVER` token (a global `Symbol`):

```ts
import { WEBSOCKET_SERVER, StreetWebSocketServer } from '@streetjs/websocket';
container.register(WEBSOCKET_SERVER, new StreetWebSocketServer({ path: '/ws' }));
```

## Public API

`StreetWebSocketServer` · `StreetSocket` · `WsHandler`/`RawWsHandler`/`WsEvent`/
`WsServerOptions` · `normalizeOrigin`/`deriveSelfOrigin`/`isOriginAllowed` ·
`SseConnection`/`createSse`/`SseEvent` · `ChannelHub`/`ChannelEvents` (+ presence/typing
types) · `WEBSOCKET_SERVER` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable end-to-end example.

## License

MIT © street contributors
