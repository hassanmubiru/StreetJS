// src/database/types.ts
//
// The universal DbResult type now lives in the standalone @streetjs/postgres
// package (single source of truth); re-exported here so existing
// `../database/types.js` importers keep working — dependency inversion.

export type { DbResult } from '@streetjs/postgres';
