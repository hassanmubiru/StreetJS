# Example 04 — Realtime Chat (channels, presence, typing, broadcasting)

Demonstrates StreetJS's realtime channel system: named channels (rooms),
reference-counted presence, typing indicators, and scoped event broadcasting on
top of the WebSocket server.

## Run

```bash
# from the repo root
npm run build:app -w packages/core
node examples/04-realtime-chat/main.mjs
```

The script boots a real WebSocket server, wires each connection into a
`ChannelHub`, connects two real clients (`ada` and `bob`), and walks through:

1. `ada` connects and receives a **presence snapshot**.
2. `bob` connects; `ada` receives a **`presence:join`** event.
3. `ada` sends a **typing** indicator; `bob` receives **`typing`**.
4. `ada` sends a **chat** message; `bob` receives it (sender excluded).
5. `bob` disconnects; `ada` receives **`presence:leave`**.

It asserts each step and exits non-zero if any contract breaks.

## The pieces

```ts
import { StreetWebSocketServer, ChannelHub, ChannelEvents } from '@streetjs/core';

const hub = new ChannelHub({ typingTtlMs: 5_000 });
const wss = new StreetWebSocketServer({ path: '/ws' });

wss.attach(httpServer, (socket, req) => {
  const memberId = /* derive from auth/session */;
  hub.bind(socket);                          // auto-cleanup on socket close
  hub.join('general', memberId, socket);     // join a room (presence tracked)

  socket.on('chat', (p) =>
    hub.publish('general', 'chat', { from: memberId, text: p.text }, { exceptConnId: socket.id }));

  socket.on('typing', (p) =>
    hub.setTyping('general', memberId, p.typing === true, socket));
});
```

### Reconnection handling

Presence is reference-counted by connection, so a client that reconnects (new
socket joins before the stale one is reaped) never flickers offline. Presence
`leave` fires only when a member's **last** connection goes away.

### Scaling out

`ChannelHub` is in-process. For multiple server instances, fan
`publish`/presence events through a shared pub/sub (e.g. Redis) so events reach
members connected to other nodes.

## See also

- `@streetjs/core` exports: `ChannelHub`, `ChannelEvents`, `StreetWebSocketServer`, `StreetSocket`
- Docs: `docs/realtime-channels.md`
