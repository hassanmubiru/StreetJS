# Architecture — @streetjs/pool

## Purpose

`@streetjs/pool` is the StreetJS PostgreSQL connection pool. It sits directly
above `@streetjs/postgres` (the wire driver) and provides bounded, self-healing
connection management with backpressure — the layer repositories, migrations,
and the HA client build on. It registers as `@Injectable` (from
`@streetjs/container`) and reports database outages via
`DatabaseConnectionError` (from `@streetjs/exceptions`).

## Dependencies

```
@streetjs/postgres   (PgConnection, streaming, connect options)
@streetjs/container  (@Injectable so the pool can be DI-resolved)
@streetjs/exceptions (DatabaseConnectionError for ECONNREFUSED)
```

No cyclic dependencies: all three are lower in the graph.

## Design

### Connection lifecycle

Each pooled connection is tracked as `{ conn, lastUsed, inUse }`. The pool keeps:

- `connections` — the live set;
- `waitQueue` — bounded (100) FIFO of callers waiting for a free connection;
- `pendingCreations` — in-flight `connect()` calls, counted so concurrent
  acquires never exceed `maxConnections`.

### Lazy, idempotent warm-up

`initialize()` opens `minConnections` in parallel. `ensureInitialized()` wraps
it so warm-up happens exactly once, is safe under concurrency (a shared
`initPromise`), and is retryable: on failure the cached promise is cleared so a
later call can try again once the database is reachable. `ECONNREFUSED` is
translated to a `DatabaseConnectionError` carrying an operator suggestion
(PGHOST/PGPORT/…); other errors propagate unchanged.

### Acquire path

`acquire()` awaits warm-up only on the cold path — for an already-initialized
pool it calls `_doAcquire()` in the same tick so a queued waiter is enqueued
synchronously (this preserves `close()`'s contract that pending waiters are
rejected with "Connection pool is closed" rather than the synchronous
"Pool is closed"). `_doAcquire()`:

1. reuses an idle, ready connection;
2. removes any dead connection it encounters, creating a replacement if under
   `maxConnections`;
3. otherwise creates a new connection if under the cap;
4. otherwise emits `pool:exhausted` and enqueues the caller with an
   `acquireTimeoutMs` timer.

### Release, replacement, sweep

`release()` returns healthy connections to idle (serving a waiter if present),
and discards dead ones — triggering `_maybeCreateReplacement()` to keep a queued
waiter moving. `_sweepIdle()` (a 15s unref'd timer) closes idle connections
above `minConnections` once they exceed `idleTimeoutMs`.

### Convenience wrappers

`query()`, `transaction()` (BEGIN/COMMIT, ROLLBACK on throw), and `stream()`
(released on stream `close`) all acquire and release automatically.

## Testing

The suite runs with **no live PostgreSQL** by mocking the static
`PgConnection.connect` with an in-memory fake connection. It covers warm-up,
reuse, growth to max, the wait queue + `pool:exhausted` + timeout, query,
commit/rollback transactions, streaming release, dead-connection replacement on
both acquire and release, `close` rejecting waiters, ECONNREFUSED translation,
and idempotent/retryable warm-up.

### Coverage floor

Lines/statements/functions are ≥98% and branches ≥86%. The declared branch floor
is **80%**: a couple of defensive branches — notably the "a dead connection is
found *and* the pool is simultaneously at `maxConnections`" fall-through — are
not deterministically reachable in single-threaded flow, so they are documented
rather than force-covered. This mirrors the honest, lower floors used by the
other integration-bound StreetJS packages (`postgres`, `cluster`).

## Non-goals

- No SQL building, ORM, or migration logic (higher layers).
- No read/write splitting or failover — that is `PgHaClient` in `@streetjs/postgres`.
- No multi-database routing — that is the tenancy layer in core.
