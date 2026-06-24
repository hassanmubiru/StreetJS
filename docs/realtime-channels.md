---
layout:    default
title:     "Realtime Channels"
nav_order: 40
permalink: /realtime-channels/
description: "StreetJS realtime channels — named rooms, reference-counted presence, typing indicators, and scoped broadcasting over the built-in WebSocket server."
---

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

## Securing the WebSocket server

`StreetWebSocketServer` accepts a `WsServerOptions` object. Two of its options harden
realtime connections against cross-site hijacking (CSWSH) and unauthenticated access.

### Origin validation (`allowedOrigins`)

The `allowedOrigins` option lists the origins permitted to complete a WebSocket
upgrade. Origin matching is exact on the normalized origin (scheme, host, and port).

```ts
const wss = new StreetWebSocketServer({
  allowedOrigins: ['https://app.example.com', 'https://admin.example.com'],
});
```

**Same-origin default.** When `allowedOrigins` is omitted, the server defaults to
**same-origin**: the request's `Origin` must match the server's own scheme, host, and
port. This is the secure default — a cross-site page cannot open a connection unless
you explicitly allow its origin.

Origin handling rules:

| `Origin` header | Behavior |
|-----------------|----------|
| Absent | **Allowed.** Non-browser clients (native apps, server-to-server) legitimately omit `Origin`, and CSWSH is a browser-only attack. To reject originless upgrades, layer your own `authFn`. |
| Present and allowed | Permitted to proceed to any configured `authFn`. |
| Present but disallowed | **Rejected** with `403 Forbidden`; the socket is destroyed and no `connection` event is emitted. |
| Malformed (unparseable) | **Rejected** — treated as disallowed. |

A disallowed origin is rejected **before** the handshake completes, so the connection
never reaches your handler.

### Production warning for unauthenticated servers (F-R1)

A WebSocket server constructed in production (`NODE_ENV === 'production'`) **without** an
`authFn` accepts every upgrade unauthenticated. To make this visible, the constructor
emits a one-time `console.warn` identifying finding **F-R1** and pointing to the
remediation — supply an `authFn`:

```ts
// In production without authFn, this logs a SECURITY warning referencing F-R1
const wss = new StreetWebSocketServer();

// Supplying an authFn authenticates the upgrade and suppresses the warning
const wss = new StreetWebSocketServer({
  authFn: (req) => verifySession(req),   // return false (or throw) to reject with 401
});
```

The warning never throws and never blocks startup — the server still starts and accepts
connections according to its other configured controls. It only fires in production and
only when no `authFn` is supplied; in development, or with an `authFn` present, no
warning is emitted.

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
