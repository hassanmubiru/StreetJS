# @streetjs/pool

The StreetJS PostgreSQL connection pool: a bounded pool over
[`@streetjs/postgres`](https://www.npmjs.com/package/@streetjs/postgres)
connections with lazy warm-up, health checking, idle sweeping, a backpressure
wait queue, transactions, and streaming. ESM, strict-TypeScript, `@Injectable`.

This is the standalone home of the pool that also backs the `streetjs/pool`
subpath. The `streetjs` framework re-exports this package, so there is a single
source of truth.

## Install

```bash
npm install @streetjs/pool @streetjs/postgres
```

## Usage

```ts
import { PgPool } from '@streetjs/pool';

const pool = new PgPool({
  host: 'localhost',
  port: 5432,
  user: 'app',
  password: process.env.PGPASSWORD!,
  database: 'app',
  minConnections: 2,
  maxConnections: 10,
  acquireTimeoutMs: 5_000,
  idleTimeoutMs: 30_000,
});

// Auto acquire/release around a single query:
const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [7]);

// A transaction (BEGIN/COMMIT, or ROLLBACK on throw):
await pool.transaction(async (conn) => {
  await conn.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1]);
  await conn.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2]);
});

// Streaming (connection released when the stream closes):
const stream = await pool.stream('SELECT * FROM big_table');

await pool.close();
```

## Behavior

- **Lazy warm-up.** A pool can be constructed before the database is reachable.
  The first `acquire`/`query`/`stream`/`transaction` warms it up to
  `minConnections`; a failed warm-up is retryable on the next call.
- **Bounded growth.** New connections are created on demand up to
  `maxConnections`, accounting for in-flight creations.
- **Backpressure.** When the pool is at capacity, callers queue (bounded to 100)
  and a `pool:exhausted` event fires. Queued callers are served as connections
  are released, or rejected after `acquireTimeoutMs`.
- **Self-healing.** Dead connections are detected on acquire and release and
  replaced; idle connections above `minConnections` are swept after
  `idleTimeoutMs`.
- **Observability.** `size`, `idle`, `waiting`, and a rolling `avgAcquireMs` are
  exposed as getters.

### `onPoolExhausted(pool, fn)`

Subscribe to `pool:exhausted` events; returns an unsubscribe function.

```ts
import { onPoolExhausted } from '@streetjs/pool';
const off = onPoolExhausted(pool, ({ total, idle, waiting }) => log.warn({ total, idle, waiting }));
```

## Options

`PoolOptions` extends `PgConnectOptions` from `@streetjs/postgres` and adds:

| Option | Default | Description |
| ------ | ------- | ----------- |
| `minConnections` | `2` | Connections warmed up eagerly. |
| `maxConnections` | `10` | Hard cap on total connections. |
| `idleTimeoutMs` | `30000` | Idle connections above the minimum are swept after this. |
| `acquireTimeoutMs` | `5000` | How long a queued caller waits before rejecting. |

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/pool
```

## License

MIT — see [LICENSE](./LICENSE).
