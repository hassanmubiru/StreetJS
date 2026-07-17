/**
 * @streetjs/database — the StreetJS database meta-package.
 *
 * A single convenience import that re-exports the whole StreetJS data layer, so
 * an application can `import { PgConnection, PgPool, StreetPostgresRepository }
 * from '@streetjs/database'` instead of depending on each package individually:
 *
 * - **`@streetjs/postgres`** — dependency-free PostgreSQL wire driver (SCRAM auth,
 *   extended query protocol, streaming) + high-availability client.
 * - **`@streetjs/pool`** — bounded connection pool with backpressure and health checks.
 * - **`@streetjs/schema-inspector`** — unified PG/MySQL/SQLite schema introspection.
 * - **`@streetjs/migrations`** — transactional SQL migration runner + schema differ.
 * - **`@streetjs/repository`** — generic typed CRUD repository + ledger transactions.
 *
 * This package contains **no logic of its own** — it is a stable aggregate entry
 * point. Depend on the individual packages directly when you want a narrower
 * dependency surface.
 *
 * ```ts
 * import { PgPool, StreetPostgresRepository } from '@streetjs/database';
 *
 * const pool = new PgPool({ host, port: 5432, user, password, database });
 * const { rows } = await pool.query('SELECT 1');
 * ```
 */

export * from '@streetjs/postgres';
export * from '@streetjs/pool';
export * from '@streetjs/schema-inspector';
export * from '@streetjs/migrations';
export * from '@streetjs/repository';
