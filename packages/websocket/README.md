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
- **`attachProtocol(server, subprotocol, handler)`** — negotiate a custom subprotocol
  (e.g. `graphql-transport-ws`) and own the raw framing.

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
