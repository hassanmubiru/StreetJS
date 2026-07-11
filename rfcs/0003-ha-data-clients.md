---
rfc: 0003
title: High-Availability data clients (Redis Cluster + PostgreSQL failover)
status: Implemented
authors: ["@hassanmubiru"]
created: 2026-07-11
tracking-issue:
---

# RFC 0003 — High-Availability data clients (Redis Cluster + PostgreSQL failover)

## Implementation status (2026-07-11)

**Implemented and live-verified against real topologies (Docker).**

Redis Cluster:
- ✅ Pure primitives (`transports/cluster.ts`): `crc16` (CCITT/XMODEM), `hashSlot`
  (hash-tag aware), `parseRedirect` (MOVED/ASK), `parseClusterSlots`, `buildSlotMap`
  — verified offline against Redis reference vectors (`crc16("123456789")===0x31C3`,
  `hashSlot("foo")===12182`): `cluster.test` 13/13.
- ✅ Routing client `RedisClusterClient` (`transports/cluster-client.ts`): per-node
  connection pool, slot-map discovery via `CLUSTER SLOTS`, key-slot routing,
  MOVED (with slot-map self-heal) and ASK (ASKING + one-shot redirect) handling.
  Exposed via `streetjs/redis-cluster`.
- ✅ **Live-verified** against a real 3-master/3-replica cluster: full 16384-slot
  discovery; set/get/del across all masters; explicit MOVED redirect followed +
  slot-map self-healed; hash-tag co-location. Integration test
  `redis-cluster.it.test` 5/5 (self-skips without a cluster).
- ✅ Additive `nodes?` field on `RedisClientOptions` (non-breaking).

PostgreSQL HA:
- ✅ `PgHaClient` (`database/ha.ts`): multi-host, primary discovery via
  `pg_is_in_recovery()`, role-targeted routing (`primary` / `prefer-replica` /
  `any`), and failover — a per-attempt query timeout detects a dead/wedged primary,
  drops it, re-discovers the topology, and retries (picks up a promoted primary).
  Exposed via `streetjs/pg-ha`.
- ✅ **Live-verified** against a real primary + streaming-replica topology:
  discovery (primary vs standby), `prefer-replica` reads landing on the standby, and
  **failover** — after promoting the standby (`pg_promote`) and stopping the old
  primary, a `target: primary` query re-resolved to the promoted node and succeeded;
  a post-failover write/read succeeded. Integration test `pg-ha.it.test`
  (self-skips without `PG_HA_PRIMARY`/`PG_HA_REPLICA`).

Packaging: `verify-package` resolves all 171 published modules (new subpaths ship).

## Summary

Extend the core Redis (`RESP`) and PostgreSQL wire clients from single-endpoint
to **topology-aware**: Redis Cluster (multi-seed nodes + `MOVED`/`ASK` redirect
handling) and PostgreSQL HA (multiple hosts + primary/replica discovery +
failover on connection loss). The change is **purely additive** to the existing
option shapes so all current single-endpoint callers are unaffected.

## Motivation

This is the top *technical* blocker to enterprise adoption identified in the
Strategy Review and Transition Report (OUTSTANDING-ACTIONS #30). Verified by
direct inspection: `RedisClientOptions` (`packages/core/src/transports/resp.ts`)
is `{ host?, port?, password? }` — no `nodes[]`, no cluster-redirect handling;
`PgConnectOptions` (`packages/core/src/database/wire.ts`) is
`{ host, port, user, password, database }` — single endpoint, no
replica/standby/failover. Neither client can participate in a Redis Cluster or a
PostgreSQL HA topology today. This is a missing **capability**, not a bug — no
test can honestly close it without first extending the client.

## Guide-level explanation

```typescript
// Redis Cluster — additive `nodes` seed list; single-node config still works.
const redis = new RespClient({
  nodes: [
    { host: '10.0.0.1', port: 6379 },
    { host: '10.0.0.2', port: 6379 },
  ],
  // password?, tls? as today
});
// Client discovers slots, routes by key hash slot, follows MOVED/ASK redirects,
// and refreshes the slot map on topology change.

// PostgreSQL HA — additive `hosts` list + role targeting.
const pg = await PgConnection.connect({
  hosts: [
    { host: 'pg-primary', port: 5432 },
    { host: 'pg-replica-1', port: 5432 },
  ],
  target: 'primary',        // 'primary' | 'prefer-replica' | 'any'
  user, password, database,
  // on connection loss, re-resolve the primary and reconnect (bounded retries)
});
```

## Reference-level explanation

- **Redis (`packages/core/src/transports/resp.ts`):**
  - Add `nodes?: Array<{ host: string; port: number }>` to `RedisClientOptions`
    (retain `host`/`port` as the single-node shorthand; if both given, `nodes`
    wins). No field removed.
  - Add a cluster mode: on connect, issue `CLUSTER SLOTS`, build a slot→node map,
    compute the CRC16 hash slot per key, and route commands to the owning node.
  - Handle `-MOVED <slot> <host:port>` and `-ASK <slot> <host:port>` error
    replies: follow the redirect, and on `MOVED` refresh the slot map.
  - Bounded redirect depth + slot-map refresh backoff (reuse the shared
    resilience primitive from RFC 0004 if accepted, else a local bounded retry).
  - Single-node behavior is the default and unchanged when `nodes` is absent.
- **PostgreSQL (`packages/core/src/database/wire.ts`):**
  - Add `hosts?: Array<{ host: string; port: number }>` and
    `target?: 'primary' | 'prefer-replica' | 'any'` to `PgConnectOptions`
    (retain single `host`/`port`). No field removed.
  - Primary discovery via `SHOW transaction_read_only` (or
    `pg_is_in_recovery()`): a host answering read-write is the primary.
  - On connection loss, re-resolve per `target` with bounded retries before
    surfacing the error.
- **Error behavior:** new typed errors (`RedisClusterRedirectError`,
  `PgNoPrimaryError`) surfaced only in the new modes; single-node error paths
  unchanged.

## Backward compatibility

**Non-breaking, additive.** Existing `{ host, port, ... }` callers keep identical
behavior; the new topology fields are optional. Ships in a **1.x minor**. A
cleaner unified option shape (if ever desired) is deferred to 2.0.

## Security considerations

No new secret handling — credentials use the existing fields. New attack surface
is limited to trusting redirect targets from the cluster; mitigate by only
following redirects to hosts within the configured node set / same
port-and-scheme policy, and bounding redirect depth. TLS options apply per node.

## Testing & verification

**"Done" requires live-topology integration tests — no simulation.**
- Property-based tests for the CRC16 hash-slot computation and MOVED/ASK redirect
  state machine (pure, offline).
- A live **Redis Cluster** (≥3 masters) integration suite: key routing, a forced
  slot migration producing `ASK`/`MOVED`, and slot-map refresh.
- A live **PostgreSQL primary+replica** suite: read-write routed to primary,
  `prefer-replica` reads served by a standby, and failover (kill primary →
  reconnect to promoted primary within bounded retries).
- New CI workflow(s) standing up the cluster/HA topologies (Docker), gated
  honest-BLOCKED when the runtime is unavailable (mirroring existing integration
  workflows). This RFC is **not implementable-to-VERIFIED without that infra**.

## Alternatives considered

- **Wrap a third-party client (ioredis / node-postgres cluster helpers):**
  rejected — violates the dependency-free-core invariant (permanent architectural
  decision).
- **A separate `@streetjs/ha` package:** rejected — the capability belongs in the
  wire clients themselves; a split would fragment the client API.
- **Defer to 2.0 with a breaking unified shape:** rejected — additive 1.x delivery
  unblocks enterprise sooner without a migration.

## Unresolved questions

- Read-write splitting policy granularity (per-query vs per-connection) for
  `prefer-replica`.
- Whether to expose slot-map / topology events for observability.
- Failover detection tuning (timeout/backoff defaults) validated against real
  clusters.
