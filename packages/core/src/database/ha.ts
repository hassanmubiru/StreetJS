// src/database/ha.ts
//
// The PostgreSQL high-availability client now lives in the standalone
// @streetjs/postgres package (single source of truth). This module re-exports
// it so the `streetjs/pg-ha` subpath and all internal imports keep working
// unchanged — dependency inversion, not duplication.

export { PgHaClient } from '@streetjs/postgres';
export type { PgHaOptions, PgHaHost, PgTarget } from '@streetjs/postgres';
