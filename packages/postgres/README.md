# @streetjs/postgres

The PostgreSQL driver for StreetJS: a **dependency-free wire-protocol client**
(SCRAM-SHA-256 auth, extended query protocol with parameter binding, streaming results)
plus a **high-availability client** (primary discovery, role-targeted routing, failover).

**Zero runtime dependencies.** Built on Node.js core (`net`, `crypto`, `stream`) only —
no `pg`, no native bindings — matching the StreetJS minimal, carefully curated dependency
footprint.

```bash
npm install @streetjs/postgres
```

> This is the standalone home of the driver that also backs the `streetjs/database` and
> `streetjs/pg-ha` subpaths; the `streetjs` framework re-exports it, so there is a single
> implementation.

## Single connection

```ts
import { PgConnection } from '@streetjs/postgres';

const conn = await PgConnection.connect({
  host: 'localhost', port: 5432, user: 'app', password: process.env.PGPASSWORD!, database: 'app',
});

const result = await conn.query('SELECT id, email FROM users WHERE id = $1', [7]);
result.rows;     // Record<string, string | null>[]  (text-protocol semantics)
result.rowCount; // number
result.command;  // 'SELECT' | 'INSERT' | ...

await conn.end();
```

- **SCRAM-SHA-256** authentication (the modern PostgreSQL default), implemented over
  `node:crypto`.
- **Extended query protocol** — parameters are bound server-side (`$1`, `$2`, …), not
  string-interpolated.
- **Streaming** — large result sets can be consumed as a `StreetPostgresWireStream`
  (an object-mode `Readable`) instead of buffering all rows.

## High availability

```ts
import { PgHaClient } from '@streetjs/postgres';

const db = new PgHaClient({
  hosts: [{ host: 'pg-a', port: 5432 }, { host: 'pg-b', port: 5432 }],
  user: 'app', password, database: 'app',
  target: 'primary',          // default routing; also 'prefer-replica' | 'any'
});

await db.query('INSERT INTO events (kind) VALUES ($1)', ['signup']);              // → primary
await db.query('SELECT count(*) FROM events', [], { target: 'prefer-replica' });  // → replica

db.primaryEndpoint();   // current primary
db.replicaEndpoints();  // known replicas
await db.close();
```

`PgHaClient` discovers each host's role via `pg_is_in_recovery()`, routes by `target`, and
on a lost/timed-out connection **re-discovers the topology and retries** — so a primary
promotion (failover) is picked up transparently. A per-attempt query timeout prevents a
wedged endpoint from hanging a query.

## Result shape

All drivers return the universal `DbResult`: `{ rows, rowCount, command }`, where each row
maps column names to `string | null` (PostgreSQL text-protocol semantics).

## Dependency injection

Exports a `POSTGRES` token (a global `Symbol`) for interface-first wiring.

## Public API

`PgConnection` · `StreetPostgresWireStream` · `PgHaClient` · types (`PgRow`, `PgResult`,
`DbResult`, `PgConnectOptions`, `PgHaOptions`, `PgHaHost`, `PgTarget`) · `POSTGRES` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable (server-free) example.

## License

MIT © street contributors
