---
layout:      default
title:       "High-Availability Data Clients"
permalink:   /ha-clients/
nav_exclude: true
description:  "StreetJS high-availability data clients — Redis Cluster routing (hash-slot, MOVED/ASK) and PostgreSQL primary discovery + failover. Added in 1.2.0, additive and dependency-free."
---

# High-Availability Data Clients

*Added in **StreetJS 1.2.0** ([RFC 0003](https://github.com/hassanmubiru/StreetJS/blob/main/rfcs/0003-ha-data-clients.md)). Additive and opt-in — existing single-endpoint clients are unchanged, so no migration is required.*

StreetJS ships topology-aware clients for the two most common HA data tiers, built
on the same dependency-free core as the rest of the framework.

---

## Redis Cluster

`RedisClusterClient` discovers the cluster topology (`CLUSTER SLOTS`), routes each
command to the node that owns the key's hash slot (CRC16, with hash-tag support),
and follows `MOVED`/`ASK` redirects — self-healing its slot map when the topology
changes.

```typescript
import { RedisClusterClient } from 'streetjs';
// or: import { RedisClusterClient } from 'streetjs/redis-cluster';

const redis = new RedisClusterClient({
  nodes: [
    { host: '10.0.0.1', port: 6379 },
    { host: '10.0.0.2', port: 6379 },
    { host: '10.0.0.3', port: 6379 },
  ],
  // password?: '…', maxRedirects?: 5
});

await redis.connect();               // discovers all 16384 slots
await redis.set('user:42', 'alice', 60_000);
const v = await redis.get('user:42'); // routed to the owning master
await redis.del('user:42');
await redis.publish('events', 'hello');
redis.close();
```

**Hash tags** co-locate related keys on the same slot (useful for multi-key
operations): `{user42}.profile` and `{user42}.settings` always share a slot.

Pure primitives are also exported for advanced use:
`crc16`, `hashSlot`, `parseRedirect`, `parseClusterSlots`, `buildSlotMap`.

The single-node `RedisClient` also gained an additive optional `nodes` field for
config symmetry; when you need cluster routing, use `RedisClusterClient`.

---

## PostgreSQL HA

`PgHaClient` connects to multiple hosts, discovers which is the primary (via
`pg_is_in_recovery()`), routes queries by role, and fails over automatically: a
per-attempt query timeout detects a dead or demoted primary, re-discovers the
topology, and retries against a promoted primary.

```typescript
import { PgHaClient } from 'streetjs';
// or: import { PgHaClient } from 'streetjs/pg-ha';

const db = new PgHaClient({
  hosts: [
    { host: 'pg-a', port: 5432 },
    { host: 'pg-b', port: 5432 },
  ],
  user: 'app', password: process.env.PGPASSWORD!, database: 'app',
  target: 'primary',          // 'primary' | 'prefer-replica' | 'any'
  // queryTimeoutMs?: 8000, maxFailover?: 2, connectTimeoutMs?: 10000
});

await db.connect();
// writes / read-your-writes → primary
await db.query('INSERT INTO orders(id, total) VALUES ($1,$2)', [1, 99]);
// read-scaling → a standby when available
const rows = await db.query('SELECT * FROM orders', [], { target: 'prefer-replica' });
// failover is transparent: if the primary is lost and a standby is promoted,
// the next `target: 'primary'` query re-resolves to the new primary and succeeds.
db.primaryEndpoint();   // current primary {host, port}
db.replicaEndpoints();  // current standbys
await db.close();
```

### Routing policies

| `target` | Behavior |
|----------|----------|
| `primary` | Always the read-write primary (default). Use for writes and read-your-writes. |
| `prefer-replica` | A standby when one is available, else the primary. Use for read scaling. |
| `any` | Primary first, else any reachable standby. |

---

## Verification & guarantees

Both clients are exercised by unit tests (Redis hash-slot/redirect logic is verified
against Redis's own reference vectors) and by live integration tests: the Redis
client against a 3-master/3-replica cluster (including a real `MOVED` redirect and
slot-map self-heal), and the PostgreSQL client against a primary + streaming replica
with a real `pg_promote` failover. The integration suites self-skip when no topology
is present, so they never block a build without HA infrastructure.

No runtime dependencies are added — both clients are pure standard-library
implementations, consistent with StreetJS's verifiable-supply-chain posture.
