// src/database/pool.ts
// Bounded PostgreSQL connection pool with health checking and backpressure.
//
// The implementation now lives in the standalone `@streetjs/pool` package
// (built on @streetjs/postgres + @streetjs/container + @streetjs/exceptions).
// This module re-exports it verbatim so the `streetjs/pool` subpath and every
// internal `../database/pool.js` importer keep working against a single source
// of truth — no duplication, no shim.

export { PgPool, onPoolExhausted } from '@streetjs/pool';
export type { PoolOptions } from '@streetjs/pool';
