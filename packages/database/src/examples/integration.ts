/**
 * @streetjs/database — runnable integration example.
 *
 * Shows that the whole data layer is reachable from a single import: the pool,
 * the schema inspector, the migration differ, and the repository — no live
 * database needed (fakes stand in for the pool). In a real app you pass a real
 * `PgPool` pointed at your database.
 *
 * Run with: `npm run example -w packages/database`
 */

import {
  PgPool,
  SchemaInspector,
  MigrationDiffer,
  StreetPostgresRepository,
} from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}
function result(rows: Record<string, string | null>[]) {
  return { rows, rowCount: rows.length, command: 'SELECT' };
}

// Everything below is imported from the single `@streetjs/database` entry point.
console.log('exports available:', {
  PgPool: typeof PgPool,
  SchemaInspector: typeof SchemaInspector,
  MigrationDiffer: typeof MigrationDiffer,
  StreetPostgresRepository: typeof StreetPostgresRepository,
});
assert(typeof PgPool === 'function', 'PgPool re-exported');
assert(typeof StreetPostgresRepository === 'function', 'repository re-exported');

// A fake PG pool (named PgPool) so the inspector + differ run without a server.
class FakePg {
  async query(sql: string) {
    if (/pg_indexes|referential_constraints/i.test(sql)) return result([]);
    return result([]); // empty database
  }
}
Object.defineProperty(FakePg, 'name', { value: 'PgPool' });

const diff = await MigrationDiffer.diff(new FakePg() as never, []);
console.log('schema diff of an empty DB with no entities:', diff);
assert(diff.safe.length === 0 && diff.destructive.length === 0, 'nothing to migrate');

const schema = await SchemaInspector.inspect(new FakePg() as never);
assert(Array.isArray(schema.tables), 'schema has a tables array');
console.log('inspected tables:', schema.tables.length);

console.log('\nAll @streetjs/database example assertions passed.');
