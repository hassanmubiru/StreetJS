/**
 * @streetjs/postgres — the StreetJS PostgreSQL driver.
 *
 * A dependency-free PostgreSQL **wire-protocol** client (SCRAM-SHA-256 auth,
 * extended query protocol with parameter binding, streaming results) plus a
 * **high-availability** client (primary discovery via `pg_is_in_recovery()`,
 * role-targeted routing, and failover). Built on Node.js core (`net`, `crypto`,
 * `stream`) only. Public API only.
 *
 * ```ts
 * import { PgConnection } from '@streetjs/postgres';
 *
 * const conn = await PgConnection.connect({ host, port: 5432, user, password, database });
 * const result = await conn.query('SELECT * FROM users WHERE id = $1', [7]);
 * result.rows; // Record<string, string | null>[]
 * await conn.end();
 * ```
 *
 * > This is the standalone home of the driver that also backs the
 * > `streetjs/database` and `streetjs/pg-ha` subpaths; the `streetjs` framework
 * > re-exports it, so there is a single implementation.
 */

export {
  PgConnection,
  StreetPostgresWireStream,
  type PgRow,
  type PgResult,
  type DbResult,
  type PgConnectOptions,
  // Low-level wire-protocol builders/parsers (were reachable via the
  // `streetjs/database` subpath; kept public for backward compatibility).
  buildParseMessage,
  buildBindMessage,
  buildExecuteMessage,
  buildDescribeMessage,
  buildSyncMessage,
  buildSASLInitialResponse,
  buildSASLResponse,
  parseSASLMechanisms,
  parseScramParams,
  validateSASLprep,
  xorBuffers,
} from './wire.js';

export {
  PgHaClient,
  type PgHaOptions,
  type PgHaHost,
  type PgTarget,
} from './ha.js';

/**
 * Dependency-injection token for a {@link PgConnection}-based data source. This
 * package depends on no container, so the token is a plain unique symbol.
 */
export const POSTGRES: unique symbol = Symbol.for('@streetjs/postgres:Connection');
