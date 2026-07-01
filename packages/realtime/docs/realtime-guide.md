# Realtime Guide

A practical, example-driven guide to building realtime features with
`@streetjs/realtime` — chat, notifications, live dashboards, multiplayer, and
collaborative editing — all on first-party StreetJS primitives, with no
Socket.IO dependency.

> Every snippet uses the real public API. Note in particular that
> `room.broadcast(...)` takes a **message object** `{ type, payload }` (not
> positional `broadcast("event", data)` arguments), and `presence()` resolves to
> an array of **member id strings**.

## Contents

1. [Setup](#1-setup)
2. [Core concepts](#2-core-concepts)
3. [Chat](#3-chat)
4. [Notifications](#4-notifications)
5. [Live dashboard](#5-live-dashboard)
6. [Multiplayer](#6-multiplayer)
7. [Collaborative editor](#7-collaborative-editor)
8. [Authentication & secured channels](#8-authentication--secured-channels)
9. [Rate limiting](#9-rate-limiting)
10. [Scaling to multiple instances (Redis)](#10-scaling-to-multiple-instances-redis)
11. [CLI generators](#11-cli-generators)
12. [Testing](#12-testing)

---

## 1. Setup

`createRealtime` layers over an existing `StreetWebSocketServer`. With no adapter
configured it uses the zero-dependency `MemoryAdapter` (single instance).

```ts
import { StreetWebSocketServer } from 'streetjs';
import { createRealtime } from '@streetjs/realtime';

const server = new StreetWebSocketServer();

const realtime = createRealtime({
  server,
  typingTtlMs: 5_000, // auto-clear a typing indicator after 5s (0 disables)
});
```

Options accepted by `createRealtime`:

| Option | Purpose |
|---|---|
| `server` | The `StreetWebSocketServer` to attach over (required). |
| `adapter` | Cross-instance backend. Defaults to `MemoryAdapter`. |
| `typingTtlMs` | Typing-indicator TTL forwarded to the hub. `0` disables auto-clear. |
| `rateLimit` | Per-connection / per-channel quotas (enabled by default). |
| `authenticate` | Resolves a `Member` from an upgrade request (see §8). |
| `health` | `HealthCheckRegistry` for the realtime `/health/*` check. |
| `metrics` | `MetricsRegistry` for connection / room-member gauges. |

## 2. Core concepts

- **Room** — a named channel a member joins, leaves, and broadcasts within.
  `realtime.room("general")` returns a lightweight handle; the same name always
  maps to the same underlying channel.
- **Member** — a logical user (`{ id, roles?, ... }`). Presence is
  **reference-counted by connection**: a member with two tabs open stays present
  until the last connection leaves.
- **Connection** — a single WebSocket link (`RealtimeConnection`). In production
  this is the `StreetSocket` your gateway handler receives; in tests it is a
  `FakeConnection`.
- **Events on the wire** — the built-in identifiers `presence:join`,
  `presence:leave`, and `typing` are emitted to the *other* connections in a
  room (never echoed to the actor).

A minimal join → broadcast flow:

```ts
const room = realtime.room('general');

await room.join({ id: 'alice' }, aliceConn);
await room.join({ id: 'bob' }, bobConn);

// Deliver to everyone in the room except the sender's own connection.
await room.broadcast(
  { type: 'message', payload: { text: 'Hello, StreetJS!' } },
  { exceptConnId: aliceConn.id },
);

await room.presence();   // → ['alice', 'bob']
await room.memberCount(); // → 2
```

## 3. Chat

A chat room combines messages, presence, and typing indicators.

```ts
const chat = realtime.room(`chat:${channelId}`);

// When a user opens the channel:
await chat.join(user, socket);
const online = await chat.presence(); // render the roster

// Sending a message (exclude the sender so their UI can render optimistically):
await chat.broadcast(
  { type: 'chat.message', payload: { from: user.id, text, ts: Date.now() } },
  { exceptConnId: socket.id },
);

// Typing indicators (auto-clear after `typingTtlMs`):
chat.setTyping(user, true, socket);  // others receive { typing: true }
chat.setTyping(user, false, socket); // or it clears itself after the TTL

// When the user closes the tab, the socket's close removes them from every room
// and fires `presence:leave` to the remaining connections automatically.
```

Clients listen for `chat.message`, `presence:join`, `presence:leave`, and
`typing` events.

## 4. Notifications

Give every user a private room named after their id, then push to it from
anywhere in your app.

```ts
// On connect, subscribe the user to their personal channel:
await realtime.room(`user:${user.id}`).join(user, socket);

// Elsewhere (e.g. after a payment settles) — deliver to all of the user's
// devices/tabs at once:
await realtime.room(`user:${user.id}`).broadcast({
  type: 'notification',
  payload: { kind: 'payment.succeeded', amount: 4200, currency: 'UGX' },
});

// Fan out an announcement to a broadcast channel everyone joined:
await realtime.room('announcements').broadcast({
  type: 'announcement',
  payload: { text: 'Scheduled maintenance at 02:00 UTC' },
});
```

Because presence is ref-counted, a user with a phone + laptop open receives the
notification on both, and remains "present" until the last one disconnects.

## 5. Live dashboard

Push server-side metrics to everyone watching a dashboard room on an interval.

```ts
const dash = realtime.room('dashboard:ops');

setInterval(async () => {
  await dash.broadcast({
    type: 'metrics.tick',
    payload: {
      connections: server.connectionCount,
      viewers: await dash.memberCount(),
      ts: Date.now(),
    },
  });
}, 1_000).unref();
```

The subsystem's own health and metrics are also exported when you pass
registries to `createRealtime` (see §1): a `realtime` health check on
`/health/*` (including Redis connectivity) plus `realtime_connections` and
`realtime_room_members` gauges — so you can watch the dashboard *infrastructure*
in Prometheus while the dashboard *app* streams over the same server.

## 6. Multiplayer

Model each match/session as a room. Broadcast state deltas; use presence for the
lobby and `exceptConnId` so the acting player doesn't get their own echo.

```ts
const match = realtime.room(`match:${matchId}`);

await match.join(player, socket);        // lobby присоединение
await match.presence();                  // → current players

// A player acts; broadcast the delta to opponents only:
await match.broadcast(
  { type: 'move', payload: { player: player.id, from: 'e2', to: 'e4' } },
  { exceptConnId: socket.id },
);

// Exclude a whole member (all their connections) when needed:
await match.broadcast(
  { type: 'state.sync', payload: snapshot },
  { exceptMemberId: spectatorId },
);
```

When a player's last connection drops (network loss, tab close, or a
heartbeat-reaped dead socket), the hub records them absent and emits
`presence:leave` so opponents see them leave immediately.

## 7. Collaborative editor

Treat each document as a room and broadcast operations (OT/CRDT ops, cursor
positions). Presence shows who's in the doc; typing can signal active editing.

```ts
const doc = realtime.room(`doc:${docId}`);

await doc.join(editor, socket);

// Relay an edit operation to every other collaborator:
await doc.broadcast(
  { type: 'op', payload: { rev, ops } },
  { exceptConnId: socket.id },
);

// Cursor / selection presence:
await doc.broadcast(
  { type: 'cursor', payload: { user: editor.id, anchor, head } },
  { exceptConnId: socket.id },
);

// "Alice is editing…" indicator, reusing the typing channel:
doc.setTyping(editor, true, socket);
```

For conflict resolution, keep the authoritative document state server-side and
broadcast accepted operations; the room is the transport, not the source of
truth.

## 8. Authentication & secured channels

Authenticate the WebSocket upgrade with your existing auth, then gate sensitive
rooms with an authorizer.

```ts
const realtime = createRealtime({
  server,
  // Runs at upgrade time, after the server's origin gate. Return the Member on
  // success, or null to reject the upgrade with HTTP 401 (no connection).
  authenticate: async (req) => {
    const token = req.headers['authorization']?.replace('Bearer ', '');
    const claims = token ? await jwt.verify(token) : null;
    return claims ? { id: claims.sub, roles: claims.roles } : null;
  },
});

// Secure a channel: the rule is evaluated for both `join` and `broadcast`.
const admin = realtime.secure('admin:audit', ({ member, action }) => {
  return !!member?.roles?.includes('admin');
});

// An unauthorized join is denied (no presence recorded) and the requesting
// connection receives an authorization error; an unauthenticated/unauthorized
// broadcast to the secured channel is delivered to no one.
```

If no `authenticate` hook is configured and `NODE_ENV === 'production'`, the
framework emits a one-time warning naming the unauthenticated-upgrade finding —
without changing behavior.

## 9. Rate limiting

Enabled by default with documented quotas; tune per deployment.

```ts
const realtime = createRealtime({
  server,
  rateLimit: {
    perConnection: { requests: 20, window: '1s' },  // default
    perChannel: { requests: 200, window: '1s' },    // default
    // enabled: false,                              // opt out entirely
  },
});
```

When a connection or channel exceeds its quota, the excess broadcast is **not
delivered**, the offending connection receives a `rate_limited` error event
naming the exceeded quota, and a `realtime_rate_limit_rejections_total` counter
is incremented (when a metrics registry is configured).

## 10. Scaling to multiple instances (Redis)

Single-instance apps run on the default `MemoryAdapter` with zero extra deps.
When you scale horizontally, switch to the Redis adapter — no application code
changes, only the adapter:

```ts
import { RedisClient } from 'streetjs';
import { createRealtime } from '@streetjs/realtime';
import { RedisAdapter } from '@streetjs/realtime/redis'; // opt-in submodule

const client = new RedisClient({ host: '127.0.0.1', port: 6379 });
await client.connect();

const realtime = createRealtime({
  server,
  adapter: new RedisAdapter({ client, keyPrefix: 'streetjs:rt:' }),
});
```

With Redis configured:

- **Broadcasts** fan out across every instance and reach each eligible
  connection **exactly once**.
- **Presence** is the **union** across all connected instances — `presence()`
  and `memberCount()` reflect members on peer nodes, and a room is empty only
  when the distributed union is empty.
- **Degradation is graceful**: if the Redis connection drops, the realtime
  health check flips to `down` while **local** single-instance broadcasts keep
  working; cross-instance propagation resumes on reconnect.

## 11. CLI generators

Scaffold typed channel and gateway files that import only public symbols:

```bash
street make:channel Chat      # → src/channels/ChatChannel.ts
street make:gateway Chat      # → src/gateways/ChatGateway.ts
```

Both validate the name, refuse to overwrite an existing file, and generate code
that compiles under your project's TypeScript configuration.

## 12. Testing

The testing utilities let you unit-test rooms, presence, and broadcasts with no
network socket.

```ts
import { createHarness } from '@streetjs/realtime';

const h = createHarness({ typingTtlMs: 5_000, fakeTimers: true });
try {
  const a = h.connect({ id: 'a' });
  const b = h.connect({ id: 'b' });

  h.join('room', 'alice', a);
  h.join('room', 'bob', b);

  h.broadcast('room', 'message', { text: 'hi' }, { exceptConnId: a.id });
  // b received it; a (the sender) did not:
  b.eventsOfType('message'); // length 1
  a.eventsOfType('message'); // length 0

  // Deterministic typing-TTL expiry:
  h.setTyping('room', 'alice', true, a);
  h.advance(5_000); // fires the auto-clear `typing: false`
} finally {
  h.close();
}
```

For the full facade (auth, secured channels, rate limiting), drive
`createRealtime({ server })` over a `StreetWebSocketServer` with `FakeConnection`
instances and `realtime.bind(conn, member)` to associate identities — see the
runnable example at `src/examples/room-broadcast.ts`.

---

### See also

- [`docs/cluster-adapters.md`](./cluster-adapters.md) — the `ClusterAdapter`
  contract, Memory vs Redis configuration, and multi-instance deployment.
- [`docs/migration.md`](./migration.md) — backward-compatibility guarantees and
  adopting the facade over existing `StreetWebSocketServer` / `ChannelHub` code.
- [`README.md`](../README.md) — API reference and quick start.
