---
layout:    default
title:     "PostgreSQL Wire Driver"
parent:    "Database"
nav_order: 1
permalink: /database/postgres-wire-driver/
description: "Native PostgreSQL driver for Node.js in StreetJS — wire protocol v3, SCRAM-SHA-256 auth and row streaming, with no pg dependency."
---

# PostgreSQL Wire Driver

street implements the PostgreSQL frontend/backend wire protocol v3 from scratch using only `node:net` and `node:crypto`. There is no `pg`, `postgres`, or `node-postgres` dependency. This gives you direct control over connection lifecycle, streaming behavior, and memory consumption.

---

## Why a custom wire driver?

Most PostgreSQL libraries buffer entire result sets in memory before resolving a query promise. For large result sets, this causes heap spikes proportional to the data size. street's driver is streaming-first: rows are emitted as they arrive over the wire, and the socket is paused when the consumer is not ready (backpressure).

The wire driver also eliminates the `pg` dependency's transitive dependency tree, reducing the install footprint and the CVE surface.

---

## Protocol overview

PostgreSQL uses a binary message protocol over TCP. After authentication, the client and server exchange typed messages:

```
Client → StartupMessage (user, database)
Server → AuthenticationMD5Password (salt)
Client → PasswordMessage (md5(md5(password + user) + salt))
Server → AuthenticationOk
Server → ParameterStatus (×N)
Server → BackendKeyData
Server → ReadyForQuery

Client → Query (SQL string)
Server → RowDescription (column names, types)
Server → DataRow (×N)
Server → CommandComplete
Server → ReadyForQuery
```

street handles all of this in `src/database/wire.ts`.

---

## PgConnection

`PgConnection` represents a single authenticated connection to PostgreSQL.

### Connecting

```typescript
import { PgConnection } from '../database/wire.js';

const conn = await PgConnection.connect({
  host: 'localhost',
  port: 5432,
  user: 'myapp',
  password: 'secret',
  database: 'myapp_dev',
  connectTimeoutMs: 10_000,  // optional, default 10s
});
```

### Querying

```typescript
// Returns all rows buffered in a PgResult
const result = await conn.query('SELECT id, email FROM users LIMIT 100');

console.log(result.command);   // 'SELECT 100'
console.log(result.rowCount);  // 100
console.log(result.rows);      // [{ id: '...', email: '...' }, ...]
```

All row values are strings or `null`. The wire protocol transmits values as text — numeric types like `BIGINT` come back as `'12345'`, not `12345`. Parse at the application layer:

```typescript
const count = parseInt(result.rows[0]?.['count'] ?? '0', 10);
const price = parseFloat(result.rows[0]?.['price'] ?? '0');
```

### Streaming

For large result sets, use `queryStream()` to receive rows one at a time:

```typescript
const stream = conn.queryStream('SELECT * FROM orders WHERE year = 2024');

stream.on('data', (row: Record<string, string | null>) => {
  console.log(row['id'], row['total']);
  // Process without buffering the full result set
});

stream.on('end', () => console.log('Done'));
stream.on('error', (err) => console.error('Error:', err));
```

Streaming with row-by-row backpressure is covered in the sections above.

### Closing

Always close connections when done, especially in tests:

```typescript
await conn.close();
```

`close()` sends a `Terminate` message to the server, waits for the socket to drain, then destroys it. Calling `close()` on an already-closed connection is a no-op.

---

## Authentication support

### MD5 (default for most PostgreSQL installations)

```
password_hash = 'md5' + md5(md5(password + username) + salt)
```

street computes this correctly. The 4-byte salt is provided by the server in the `AuthenticationMD5Password` message.

### Cleartext

Supported for environments where PostgreSQL is configured for cleartext auth (e.g., local trust auth in CI). Not recommended for production.

### Unsupported methods

SCRAM-SHA-256 (PostgreSQL 14+ default) is not yet implemented. If your PostgreSQL server requires SCRAM, configure it to accept MD5:

```sql
-- postgresql.conf
password_encryption = md5

-- pg_hba.conf
host myapp myapp 0.0.0.0/0 md5
```

Or set the user's password in MD5 format:

```sql
ALTER USER myapp WITH PASSWORD 'secret';  -- stores as md5 if password_encryption=md5
```

---

## Error handling

PostgreSQL errors are parsed from `ErrorResponse` messages and thrown as JavaScript `Error` objects with the full server error message:

```typescript
try {
  await conn.query("INSERT INTO users (email) VALUES ('duplicate@example.com')");
} catch (err) {
  if (err instanceof Error) {
    console.log(err.message);
    // "PostgreSQL: duplicate key value violates unique constraint "users_email_unique"
    //  — Key (lower(email))=(duplicate@example.com) already exists."
  }
}
```

After an error, the server sends `ReadyForQuery` and the connection returns to the `ready` state automatically. You do not need to reconnect.

---

## PgPool

Direct use of `PgConnection` is uncommon in application code. Use `PgPool` instead — it manages a bounded set of connections, handles acquisition queuing, and sweeps idle connections.

```typescript
import { PgPool } from '../database/pool.js';

const pool = new PgPool({
  host: 'localhost',
  port: 5432,
  user: 'myapp',
  password: 'secret',
  database: 'myapp_dev',
  minConnections: 2,          // Pre-warm this many connections
  maxConnections: 10,         // Never exceed this
  idleTimeoutMs: 30_000,      // Close connections idle longer than this
  acquireTimeoutMs: 5_000,    // Throw if no connection available within this
});

await pool.initialize();      // Creates minConnections connections
```

### Simple query

```typescript
const result = await pool.query('SELECT COUNT(*) AS total FROM orders');
const total = parseInt(result.rows[0]?.['total'] ?? '0', 10);
```

The pool acquires a connection, executes the query, and releases the connection back — all automatically.

### Pool configuration guidance

| Config | Development | Production |
|---|---|---|
| `minConnections` | 1 | 2–4 |
| `maxConnections` | 5 | 10–20 (≤ PostgreSQL `max_connections`) |
| `idleTimeoutMs` | 60_000 | 30_000 |
| `acquireTimeoutMs` | 10_000 | 5_000 |

PostgreSQL's default `max_connections` is 100. A rule of thumb: total pool size across all app instances should not exceed 80% of `max_connections`.

### Pool metrics

```typescript
pool.size    // Total connections (in use + idle)
pool.idle    // Idle connections available for acquisition
```

### Closing the pool

Call during graceful shutdown:

```typescript
process.once('SIGTERM', async () => {
  await pool.close();  // Closes all connections, waits for in-flight queries
  process.exit(0);
});
```

---

## Memory safety in the wire driver

The wire driver enforces memory bounds at three levels:

### Socket-level backpressure

When the `StreetPostgresWireStream` internal row queue reaches `MAX_BUFFERED` (256 rows), it returns `false` from `push()`. The connection layer pauses the socket:

```typescript
// In PgConnection._handleMessage:
const canContinue = this.streamTarget.pushRow(row);
if (!canContinue) {
  this.socket.pause();  // Stop reading from the network
}
```

When the consumer reads from the stream, the socket resumes:

```typescript
stream.on('drain', () => this.socket.resume());
```

This prevents the network buffer → row buffer chain from growing unboundedly.

### Buffer accumulation

The TCP receive buffer (`this.buffer`) accumulates only until a complete message frame is parsed. Frames are removed immediately after parsing:

```typescript
this.buffer = this.buffer.subarray(totalLen);  // Remove parsed message
```

The buffer never grows larger than one PostgreSQL message (max ~1 GB, but practical maximum is much smaller).

### Bounded row arrays

The buffered query path (`conn.query()`) collects rows in `this.queryRows`. The assumption is that buffered queries are used for small result sets (e.g., finding a single user, counting rows). Use `queryStream()` for anything that could return more than ~1000 rows.
