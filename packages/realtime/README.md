# @streetjs/realtime

Strongly-typed, plugin-first realtime for StreetJS: rooms, presence, typing
indicators, scoped broadcast, connection authentication, channel authorization,
per-connection and per-channel rate limiting, and horizontal scaling through
pluggable cluster adapters — all layered additively over the existing
`streetjs` `StreetWebSocketServer` and `ChannelHub`.

`@streetjs/realtime` **wraps** the core realtime primitives; it does not replace
them. Existing `StreetWebSocketServer` / `ChannelHub` code keeps working
unchanged (see [Migration & backward compatibility](#migration--backward-compatibility)).

## Contents

- [Install](#install)
- [Quick start](#quick-start)
- [Rooms](#rooms)
- [Presence](#presence)
- [Typing indicators](#typing-indicators)
- [Broadcast](#broadcast)
- [Authentication](#authentication)
- [Authorization (secured channels)](#authorization-secured-channels)
- [Rate limiting](#rate-limiting)
- [Cluster adapters](#cluster-adapters)
- [Plugin registration](#plugin-registration)
- [Health & metrics](#health--metrics)
- [Testing utilities](#testing-utilities)
- [CLI generators](#cli-generators)
- [Runnable example](#runnable-example)
- [Migration & backward compatibility](#migration--backward-compatibility)

## Install

```bash
npm install @streetjs/realtime streetjs
```

The package is ESM-only (`"type": "module"`, `NodeNext`). With the default
`MemoryAdapter` it pulls in **no** third-party runtime dependency beyond
`streetjs`. The Redis adapter is opt-in and lives behind a separate submodule
export (`@streetjs/realtime/redis`).

## Quick start

```ts
import { createRealtime } from '@streetjs/realtime';
import type { Member } from '@streetjs/realtime';
import { StreetWebSocketServer } from 'streetjs';

// Your application already owns a WebSocket server; the facade attaches over it.
const server = new StreetWebSocketServer();
const realtime = createRealtime({ server });

const alice: Member = { id: 'alice' };
const room = realtime.room('general');

await room.join(alice, connection);          // connection is a StreetSocket
await room.broadcast({ type: 'message', payload: { text: 'Hello, StreetJS!' } });
```

`createRealtime(options)` accepts:

| Option         | Type                                             | Default                     | Purpose |
| -------------- | ------------------------------------------------ | --------------------------- | ------- |
| `server`       | `StreetWebSocketServer`                          | — (required)                | The existing server the facade attaches over. |
| `adapter`      | `ClusterAdapter`                                 | `new MemoryAdapter()`       | Cross-instance fan-out backend. |
| `typingTtlMs`  | `number`                                         | `0` (disabled)              | Auto-clear typing after this many ms. |
| `rateLimit`    | `RateLimitConfig`                                | enabled with defaults       | Per-connection / per-channel quotas. |
| `authenticate` | `(req) => Promise<Member \| null>`               | none                        | Resolve a `Member` from the upgrade request. |
| `health`       | `HealthCheckRegistry`                            | none                        | Register the realtime health check. |
| `metrics`      | `MetricsRegistry`                                | none                        | Export connection / member-count metrics. |

## Rooms

A `Room` is a lightweight, stateless handle to a named channel. Calling
`realtime.room(name)` twice with the same name returns handles over the **same**
underlying channel. An empty or non-string name is rejected without creating a
channel.

```ts
const room = realtime.room('general');
room.name; // "general"

await room.join(member, conn);   // add a member's connection
await room.leave(member, conn);  // remove a member's connection

const ids = await room.presence();       // string[] of present member ids
const count = await room.memberCount();   // number of present members
```

Presence is **reference-counted per connection**: a member holding several
connections (multi-device / reconnect) stays present until the last connection
leaves. `join` is idempotent per connection.

## Presence

`presence()` returns the ids of members currently present, and under a cluster
adapter it is the **distributed union** across every instance. `memberCount()`
is the size of that union (a member present on two instances is counted once).

```ts
const present = await room.presence(); // e.g. ['alice', 'bob']
```

Presence transitions emit the built-in `presence:join` and `presence:leave`
events to the *other* connections in the room (the transitioning connection
never receives its own presence event). When a member's last connection closes
— including a heartbeat reap — they become absent and `presence:leave` fires.

## Typing indicators

```ts
// Signal that a member is composing a message.
room.setTyping(member, true, conn);  // conn excludes the setter's own connection

// Clear it explicitly...
room.setTyping(member, false, conn);
```

Emits the built-in `typing` event. If you configure a positive `typingTtlMs`,
the indicator auto-clears after the TTL elapses without a refresh (a
`typing: false` event is emitted). `typingTtlMs: 0` disables the TTL. Typing
state is also cleared automatically when a member's last connection leaves.

## Broadcast

`broadcast` delivers a typed message to the eligible connections of a room. A
`RealtimeMessage<T>` carries a `type` and a typed `payload`.

```ts
await room.broadcast({ type: 'message', payload: { text: 'hi' } });

// Exclude the sender's own connection (typical for chat):
await room.broadcast(
  { type: 'message', payload: { text: 'hi' } },
  { exceptConnId: senderConn.id },
);

// Exclude every connection belonging to a member:
await room.broadcast(
  { type: 'message', payload: { text: 'hi' } },
  { exceptMemberId: member.id },
);
```

`BroadcastOptions`:

- `exceptConnId?: string` — exclude a single connection (e.g. the sender).
- `exceptMemberId?: string` — exclude all connections of a member.

Broadcasting to a room with no connections completes without error and delivers
nothing. A failing send to one connection does not stop delivery to the others.
Under a cluster adapter the same exclusions are honored on peer instances, and
each eligible connection receives a cross-instance message exactly once.

> **Note on the sender identity.** `broadcast` carries no explicit sender
> argument. On a **secured channel** and for **per-connection rate limiting**,
> the sender is identified by `exceptConnId` (by convention a sender excludes its
> own connection). Pass `exceptConnId` when broadcasting from an authenticated
> connection so authorization and per-connection quotas resolve correctly.

## Authentication

Provide an `authenticate` hook to resolve a `Member` from the WebSocket upgrade
request, typically using the framework's `JwtService` / `SessionManager`. It
runs **after** the server's built-in origin gate and **before** the connection
is accepted.

```ts
import { createRealtime } from '@streetjs/realtime';
import type { Member } from '@streetjs/realtime';

const realtime = createRealtime({
  server,
  authenticate: async (req): Promise<Member | null> => {
    const token = extractBearerToken(req); // your logic
    const claims = await jwtService.verify(token).catch(() => null);
    if (!claims) return null;              // missing/invalid → reject upgrade
    return { id: claims.sub, roles: claims.roles };
  },
});
```

- A resolved `Member` is associated with the accepted connection (via
  `Realtime.bind`), and its close lifecycle is bound so a disconnect removes it
  from every room.
- A `null` result (or a thrown authenticator) rejects the upgrade with **HTTP
  401** and establishes no connection.
- If the identity cannot be associated after a successful auth, the connection
  is kept open without a `Member`.

**Production security warning.** When `NODE_ENV === 'production'` and **no**
`authenticate` hook is configured, the subsystem emits a one-time security
warning naming the unauthenticated-upgrade finding. This is diagnostic only — it
does not change runtime behavior. Configure `authenticate` in production.

## Authorization (secured channels)

Mark a channel as secured with `realtime.secure(name, rule)`. The
`ChannelAuthorizer` rule is evaluated for `action: 'join'` before admitting a
join, and for `action: 'broadcast'` before delivering a broadcast.

```ts
import type { ChannelAuthorizer } from '@streetjs/realtime';

const adminsOnly: ChannelAuthorizer = ({ member, action }) => {
  if (!member) return false;                      // unauthenticated → deny
  return member.roles?.includes('admin') ?? false;
};

const room = realtime.secure('admin-updates', adminsOnly);

await room.join(adminMember, adminConn);          // allowed
await room.join(guestMember, guestConn);          // rejected: authorization error, not added
```

- On a denied **join**, the member is not added and an authorization error event
  is emitted to the requesting connection.
- A **broadcast** on a secured channel must originate from an authenticated,
  authorized member (resolved from `exceptConnId`). If the sender is
  unauthenticated or unauthorized, nothing is delivered — locally or across the
  cluster.
- Non-secured rooms permit authenticated members without an extra check.

## Rate limiting

Rate limiting is **enabled by default** with documented quotas:

- Per-connection: **20 / 1s**
- Per-channel: **200 / 1s**

```ts
const realtime = createRealtime({
  server,
  rateLimit: {
    enabled: true,                                  // default
    perConnection: { requests: 20, window: '1s' },  // default
    perChannel:    { requests: 200, window: '1s' }, // default
  },
});
```

Messages at or below quota are delivered. Excess per-connection messages and
excess per-channel broadcasts are rejected and **not delivered**; the offending
connection receives an `error` event with `reason: 'rate_limited'` naming the
exceeded quota (`perConnection` or `perChannel`). Set `enabled: false` to opt
out. When a `metrics` registry is configured, each rejection increments the
`realtime_rate_limit_rejections_total` counter.

The per-connection quota applies only when the sending connection is identified
via `exceptConnId`; the per-channel quota always applies.

## Cluster adapters

The facade owns a single `ClusterAdapter` that separates **local delivery**
(always via `ChannelHub`) from **cross-instance propagation**. The default is
the zero-dependency `MemoryAdapter`. For multi-instance deployments use the
`RedisAdapter`.

See [docs/cluster-adapters.md](./docs/cluster-adapters.md) for full Memory and
Redis configuration, including a multi-instance Redis deployment walkthrough.

```ts
// Single instance (default): zero third-party runtime deps.
import { createRealtime, MemoryAdapter } from '@streetjs/realtime';
const realtime = createRealtime({ server, adapter: new MemoryAdapter() });
```

```ts
// Multi-instance: Redis pub/sub fan-out + distributed presence union.
import { createRealtime } from '@streetjs/realtime';
import { RedisAdapter } from '@streetjs/realtime/redis';
import { RedisClient } from 'streetjs';

const client = new RedisClient({ host: '127.0.0.1', port: 6379 });
await client.connect();
const realtime = createRealtime({
  server,
  adapter: new RedisAdapter({ client, keyPrefix: 'streetjs:rt:', presenceTtlMs: 30_000 }),
});
```

If an explicitly configured adapter fails to initialize, `createRealtime`
surfaces a descriptive error and does **not** silently fall back to the
`MemoryAdapter`.

## Plugin registration

Register the subsystem through the standard StreetJS plugin mechanism instead of
constructing the facade directly.

```ts
import { RealtimePlugin } from '@streetjs/realtime';

const plugin = new RealtimePlugin({ server, health, metrics });
await host.register(plugin, manifest); // or your app's usePlugin(...) path
```

`onLoad` constructs the facade (`createRealtime`) over `options.server` and
registers observability from `options.health` / `options.metrics`; `onUnload`
closes the adapter and stops the metrics refresh timer.

## Health & metrics

Pass a `HealthCheckRegistry` and/or `MetricsRegistry` to wire observability. It
is entirely opt-in — omit them and nothing is registered.

```ts
const realtime = createRealtime({ server, health, metrics });
```

- **Health check** `realtime` is registered and reported through the existing
  `/health/*` routes. It maps the cluster adapter's connectivity onto the check
  status — for the `RedisAdapter` this surfaces broker connectivity (`down` on
  connection loss). Live connection count is attached to the details.
- **Metrics** exported through the `MetricsRegistry`:
  - `realtime_connections` — live WebSocket connection count (gauge).
  - `realtime_room_members` — members present per room, labelled `room` (gauge).
  - `realtime_rate_limit_rejections_total` — rate-limit rejections (counter).

## Testing utilities

The package ships an in-memory harness so you can test realtime logic with no
network socket.

```ts
import { createHarness, FakeConnection, simulateClose } from '@streetjs/realtime';

const harness = createHarness({ typingTtlMs: 5_000, fakeTimers: true });
const conn = harness.connect({ id: 'c1' });

harness.join('general', 'alice', conn);
harness.broadcast('general', 'message', { text: 'hi' });

conn.eventsOfType('message');   // assert what a connection received
harness.presence('general');    // ['alice']
harness.advance(5_000);         // drive typing-TTL / rate-limit windows
simulateClose(conn);            // exercise the real close path
harness.close();
```

- `FakeConnection` implements `RealtimeConnection` and records every emitted
  event (`{ type, payload, ts }`). Construct with `{ throwOnEmit: true }` to
  exercise send-failure resilience.
- `createHarness()` drives a real `ChannelHub` in memory and exposes a
  `ManualClock` for deterministic TTL and rate-limit windows.
- `simulateClose(conn)` invokes the same close path a live `StreetSocket` uses,
  removing the connection from every room.

## CLI generators

The existing `street` CLI scaffolds typed realtime source that imports only
public `@streetjs/realtime` symbols and compiles cleanly under your project's
`tsconfig`.

```bash
street make:channel Chat     # → src/channels/ChatChannel.ts
street make:gateway Chat     # → src/gateways/ChatGateway.ts
```

- Names are normalized to PascalCase and validated against
  `^[A-Za-z][A-Za-z0-9]*$`.
- A missing name exits non-zero with usage guidance.
- An existing target file is never overwritten (non-zero exit, file left
  intact).

**Generated channel** (`src/channels/ChatChannel.ts`) binds a typed message
union to a room:

```ts
import { type Room, type RealtimeMessage } from '@streetjs/realtime';

export type ChatMessage = RealtimeMessage<{ text: string }>;

export class ChatChannel {
  static readonly channelName = 'chat' as const;
  constructor(private readonly room: Room) {}
  broadcast(message: ChatMessage): Promise<void> {
    return this.room.broadcast(message);
  }
}
```

**Generated gateway** (`src/gateways/ChatGateway.ts`) groups room event handlers
wired to the `Realtime` facade with `onJoin` / `onLeave` / `onMessage` methods.

## Runnable example

A runnable example lives at
[`src/examples/room-broadcast.ts`](./src/examples/room-broadcast.ts) and
demonstrates the `realtime.room(...).join(...).broadcast(...)` flow end to end.
Run it against the compiled output:

```bash
npm run build
node dist/examples/room-broadcast.js
```

Expected output:

```
[example] "general" presence: [ 'alice', 'bob' ]
[example] bob received message events: 1
[example] alice received message events: 0
```

It exports an async `main()` returning a result snapshot, so it is also usable
as an automated smoke test.

## Migration & backward compatibility

`@streetjs/realtime` is purely **additive**. See
[docs/migration.md](./docs/migration.md) for the full migration guide. In short:

- The existing public method signatures of `StreetWebSocketServer`,
  `StreetSocket`, and `ChannelHub` are preserved.
- Applications that use `StreetWebSocketServer` and `ChannelHub` **directly**,
  without adopting the facade, behave exactly as before.
- The built-in event identifiers `presence:join`, `presence:leave`, and
  `typing` are retained verbatim.
- Adopting the facade is opt-in: construct `createRealtime({ server })` over your
  existing server, or register `RealtimePlugin`.

## License

MIT
