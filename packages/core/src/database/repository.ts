// src/database/repository.ts
// Generic repository and ACID ledger service.
//
// The implementation now lives in the standalone `@streetjs/repository` package
// (built on @streetjs/pool + @streetjs/postgres, with a structural FieldEncryptor
// hook so it needs no data-policy dependency). This module re-exports it verbatim
// so every internal `../database/repository.js` importer and the public `streetjs`
// API keep working against a single source of truth — no duplication, no shim.

export { StreetPostgresRepository, LedgerTransactionService } from '@streetjs/repository';
export type { IRepository } from '@streetjs/repository';
