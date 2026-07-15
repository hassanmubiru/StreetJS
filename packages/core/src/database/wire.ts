// src/database/wire.ts
//
// The PostgreSQL wire-protocol driver now lives in the standalone
// @streetjs/postgres package (single source of truth). This module re-exports
// it so the `streetjs/database` subpath and all internal `./wire.js` imports
// (pool, repository, ha) keep working unchanged — dependency inversion, not
// duplication.

export { PgConnection, StreetPostgresWireStream } from '@streetjs/postgres';
export type { PgRow, PgResult, DbResult, PgConnectOptions } from '@streetjs/postgres';
