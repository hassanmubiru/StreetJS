# Realtime Channels, Presence & Typing

StreetJS's realtime layer adds named channels (rooms), reference-counted presence,
typing indicators, and scoped broadcasting on top of the WebSocket server
(`StreetWebSocketServer` / `StreetSocket`). The channel logic lives in
`ChannelHub` and is transport-agnostic, so it can be unit-tested without sockets
and reused across transports.

## Concepts

- **Channel (room):** a named group identified by a string.
- **Member:** a logical user (`memberId`).
- **Connection:** a single socket. A member may hold several connections
  (multi-device, or a reconnect overlapping a stale socket).
- **Presence:** a member is *present* in a channel while **at least one** of
  their connections is in it. Presence is reference-counted by connection, so a
  reconnect never makes a member flicker offline.

## Quick start

```ts
import { createServer } from 'node:http';
import { StreetWebSocketServer, ChannelHub, ChannelEvents } from '@streetjs/core';

const http = createServer();
const wss = new StreetWebSocketServer();
const hub = new ChannelHub({ typingTtlMs: 5_000 });

wss.attach(http, (socket, req) => {
  const memberId = deriveUser(req);     // from session/auth (see authFn)

  hub.bind(socket);                     // auto-disconnect from all channels on close
  hub.join('general', memberId, socket);
  socket.emit('presence:snapshot', { channel: 'general', members: hub.presence('general') });

  socket.on('chat', (p) =>
    hub.publish('general', 'chat', { from: memberId, text: p.text }, { exceptConnId: socket.id }));

  socket.on('typing', (p) =>
    hub.setTyping('general', memberId, p.typing === true, socket));
});

http.listen(3000);
```

## API: `ChannelHub`

| Method | Description |
|---|---|
| `join(channel, memberId, conn)` | Add a connection; returns `{ newlyPresent }`. Emits `presence:join` to others when the member first appears. |
| `leave(channel, memberId, conn)` | Remove a connection; returns `{ nowAbsent }`. Emits `presence:leave` when the member's last connection goes. |
| `disconnect(conn)` | Remove a connection from **all** channels (call on socket close). |
| `bind(conn)` | Auto-call `disconnect` when the connection's `onClose` fires. |
| `publish(channel, type, payload, opts?)` | Broadcast to the channel. `opts.exceptConnId` / `opts.exceptMemberId` exclude the sender. |
| `presence(channel)` | Member ids currently present. |
| `isPresent(channel, memberId)` | Presence check. |
| `memberCount` / `connectionCount(channel)` | Counts of members / live connections. |
| `setTyping(channel, memberId, typing, conn?)` | Set + broadcast typing; auto-clears after `typingTtlMs` when enabled. |
| `typingMembers(channel)` | Member ids currently flagged typing. |

### Built-in events (`ChannelEvents`)

| Constant | Event type | Payload |
|---|---|---|
| `PresenceJoin` | `presence:join` | `{ channel, memberId }` |
| `PresenceLeave` | `presence:leave` | `{ channel, memberId }` |
| `Typing` | `typing` | `{ channel, memberId, typing }` |

## Reconnection

Because presence is reference-counted by connection, the recommended client
flow is **connect-then-replace**: the reconnecting client opens a new socket and
joins before the old socket is reaped by the server heartbeat. The member stays
present throughout, and `presence:leave` only fires once the last connection is
gone.

## Scaling horizontally

`ChannelHub` keeps state in-process. To run multiple instances, place a shared
pub/sub (e.g. Redis) in front of `publish` and the presence events so a message
published on one node reaches members connected to another. The hub's surface
(`publish`, `presence`, `ChannelEvents`) is the integration seam for that
fan-out.

## Example

A complete, runnable end-to-end example (real server + two real clients) lives
at [`examples/04-realtime-chat`](../examples/04-realtime-chat/README.md):

```bash
npm run build:app -w packages/core
node examples/04-realtime-chat/main.mjs
```

## Tests

`packages/core/src/tests/channels.test.ts` covers membership, presence,
multi-device reference counting, reconnection stability, scoped broadcasting,
typing (including TTL auto-clear), validation, and a property test asserting
presence always equals the set of members with at least one live connection. It
runs as part of the Core coverage suite.
