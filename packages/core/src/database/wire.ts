// src/database/wire.ts
//
// The PostgreSQL wire-protocol driver now lives in the standalone
// @streetjs/postgres package (single source of truth). This module re-exports
// it so the `streetjs/database` subpath and all internal `./wire.js` imports
// (pool, repository, ha) keep working unchanged — dependency inversion, not
// duplication. The low-level protocol builders/parsers are re-exported too, as
// they were reachable via the `streetjs/database` subpath before.

export {
  PgConnection,
  StreetPostgresWireStream,
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
} from '@streetjs/postgres';
export type { PgRow, PgResult, DbResult, PgConnectOptions } from '@streetjs/postgres';
