/**
 * @streetjs/pool — the StreetJS PostgreSQL connection pool.
 *
 * A bounded pool over `@streetjs/postgres` connections with lazy warm-up,
 * health checking, idle sweeping, a backpressure wait queue, transactions, and
 * streaming. Registers as an `@Injectable` so it can be resolved from the
 * `@streetjs/container`. Public API only.
 *
 * ```ts
 * import { PgPool } from '@streetjs/pool';
 *
 * const pool = new PgPool({ host, port: 5432, user, password, database, maxConnections: 10 });
 * const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [7]);
 * await pool.transaction(async (conn) => { await conn.query('UPDATE ...'); });
 * await pool.close();
 * ```
 *
 * > This is the standalone home of the pool that also backs the `streetjs/pool`
 * > subpath; the `streetjs` framework re-exports it, so there is a single
 * > implementation.
 */

export { PgPool, onPoolExhausted } from './pool.js';
export type { PoolOptions } from './pool.js';
