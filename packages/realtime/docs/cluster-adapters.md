# Cluster adapters

The `Realtime` facade separates **local delivery** (always through the core
`ChannelHub`) from **cross-instance propagation** (through a `ClusterAdapter`).
This lets a single-instance app run with zero third-party runtime dependencies
while a multi-instance deployment gets consistent broadcast and presence across
every node — by swapping only the adapter.

Two adapters ship with the package:

| Adapter         | Import                                | Use case |
| --------------- | ------------------------------------- | -------- |
| `MemoryAdapter` | `@streetjs/realtime`                  | Default. Single instance / development. Inert cross-instance methods, no external service. |
| `RedisAdapter`  | `@streetjs/realtime/redis` (opt-in)   | Multi-instance production. Redis pub/sub fan-out + distributed presence union. |

The `ClusterAdapter` contract both implement:

```ts
interface ClusterAdapter {
  init(sink: ClusterSink): Promise<void>;
  publish(channel: string, message: RealtimeMessage, options: BroadcastOptions): Promise<void>;
  publishPresence(channel: string, memberId: string, state: 'join' | 'leave'): Promise<void>;
  remotePresence(channel: string): Promise<string[]>;
  health(): { status: 'up' | 'down'; details?: Record<string, unknown> };
  close(): Promise<void>;
}
```

## Memory adapter (default, single instance)

The `MemoryAdapter` is the zero-dependency default. Local delivery already
happens through `ChannelHub`, so its cross-instance methods are inert:
`publish` / `publishPresence` are no-ops, `remotePresence` returns `[]`, and
`health()` is always `up`. It contacts no external service.

```ts
import { createRealtime, MemoryAdapter } from '@streetjs/realtime';
import { StreetWebSocketServer } from 'streetjs';

const server = new StreetWebSocketServer();

// Equivalent — the facade defaults to a MemoryAdapter when none is configured.
const realtime = createRealtime({ server });
const realtimeExplicit = createRealtime({ server, adapter: new MemoryAdapter() });
```

On a single instance the distributed presence union equals local presence, so
`room.presence()` / `room.memberCount()` are exactly correct with no extra
configuration.

## Redis adapter (multi-instance)

The `RedisAdapter` is opt-in and imported from the `@streetjs/realtime/redis`
submodule so Memory-adapter users pull in no extra runtime dependency. It wraps
the core `RedisClient` / `RedisLike` pub/sub surface to:

- fan broadcasts out to peer instances over a single pub/sub topic
  (`{keyPrefix}events`); the publisher discards its own echo and each peer
  re-injects a foreign broadcast into its local hub **exactly once** per
  eligible connection;
- mirror presence into per-channel-per-instance Redis sets (with an optional
  `PEXPIRE` so a crashed instance's presence self-heals) and compute the
  distributed presence **union** via `remotePresence`;
- degrade gracefully: on connection loss `health()` flips to `down` and
  `publish` / `publishPresence` become best-effort no-ops while **local**
  broadcasts keep working, resuming cross-instance propagation on reconnect. It
  never throws into the facade's hot path.

### `RedisAdapterOptions`

| Option          | Type                | Default            | Purpose |
| --------------- | ------------------- | ------------------ | ------- |
| `client`        | `RedisPubSubClient` | — (required)       | A connected `RedisClient` (or any `RedisLike` + pub/sub client). |
| `keyPrefix`     | `string`            | `"streetjs:rt:"`   | Prefix for every Redis key and the pub/sub topic. |
| `instanceId`    | `string`            | random uuid        | Unique id for this instance; used to discard its own echoed envelopes. |
| `presenceTtlMs` | `number`            | none               | TTL on presence sets so a crashed instance's presence expires. |

### Configuration

```ts
import { createRealtime } from '@streetjs/realtime';
import { RedisAdapter } from '@streetjs/realtime/redis';
import { RedisClient, StreetWebSocketServer } from 'streetjs';

const server = new StreetWebSocketServer();

const client = new RedisClient({ host: '127.0.0.1', port: 6379 }); // { host, port, password? }
await client.connect();
const adapter = new RedisAdapter({
  client,
  keyPrefix: 'streetjs:rt:',
  presenceTtlMs: 30_000, // self-heal a crashed instance's presence after 30s
});

const realtime = createRealtime({ server, adapter });
```

If the adapter's `init` rejects (e.g. Redis is unreachable at startup),
`createRealtime` surfaces a descriptive error rather than silently falling back
to the `MemoryAdapter`. Connection losses *after* init degrade gracefully
instead.

### Multi-instance deployment

Run the same application on N instances, each behind a load balancer that may
route different members' connections to different instances. Every instance:

1. constructs its own `StreetWebSocketServer` and `RedisAdapter` pointed at the
   **same** Redis and using the **same** `keyPrefix`;
2. gets a distinct `instanceId` (the default random uuid is fine).

```ts
// instance-a and instance-b run identical code:
const adapter = new RedisAdapter({ client, keyPrefix: 'streetjs:rt:' });
const realtime = createRealtime({ server, adapter, health, metrics });
```

With this setup:

- A broadcast on instance A reaches eligible connections on instance B exactly
  once, honoring the same `exceptConnId` / `exceptMemberId` exclusions.
- `room.presence()` / `room.memberCount()` return the union of members across
  all instances; a member present on two instances is counted once.
- The `realtime` health check reports `down` on any instance that loses its
  Redis connection (surfaced through `/health/*`), and local broadcasts keep
  working on that instance until Redis reconnects.

### Verifying against a real broker

Point `REDIS_URL` at a running Redis (or a docker-compose service) to exercise
the adapter against a real broker. When no broker is reachable, the package's
Redis integration tests report BLOCKED (skipped) with an explicit
unreachable-dependency message rather than passing without a real broker.

```bash
export REDIS_URL=redis://localhost:6379
npm test
```
