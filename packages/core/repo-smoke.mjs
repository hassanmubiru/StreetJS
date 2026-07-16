import { StreetPostgresRepository, LedgerTransactionService } from './dist/database/repository.js';
console.log('StreetPostgresRepository', typeof StreetPostgresRepository, 'LedgerTransactionService', typeof LedgerTransactionService);

// Concrete subclass with a fake pool exercising a query round-trip.
class Repo extends StreetPostgresRepository {
  tableName = 'users';
  mapRow(row) { return { id: row.id, name: row.name }; }
}
const pool = { async query() { return { rows: [{ id: '1', name: 'Ada' }], rowCount: 1, command: 'SELECT' }; } };
const r = new Repo(pool);
const u = await r.findById('1');
console.log('OK', JSON.stringify(u));
