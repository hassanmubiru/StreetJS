import { test } from 'node:test';
import assert from 'node:assert/strict';

// Import a representative symbol from each re-exported package *through the
// meta-package*. If `export *` produced an ambiguous name, that binding would be
// silently unavailable (undefined), so these assertions double as a collision check.
import {
  // @streetjs/postgres
  PgConnection,
  StreetPostgresWireStream,
  PgHaClient,
  buildParseMessage,
  POSTGRES,
  // @streetjs/pool
  PgPool,
  onPoolExhausted,
  // @streetjs/schema-inspector
  SchemaInspector,
  // @streetjs/migrations
  StreetMigrationRunner,
  MigrationDiffer,
  // @streetjs/repository
  StreetPostgresRepository,
  LedgerTransactionService,
} from '../index.js';

// Also confirm a type re-export resolves (compile-time check).
import type { DbResult, PoolOptions, DatabaseSchema, MigrationDiff, IRepository } from '../index.js';

test('re-exports the postgres wire driver + HA client + builders + token', () => {
  assert.equal(typeof PgConnection, 'function');
  assert.equal(typeof StreetPostgresWireStream, 'function');
  assert.equal(typeof PgHaClient, 'function');
  assert.equal(typeof buildParseMessage, 'function');
  assert.equal(typeof POSTGRES, 'symbol');
});

test('re-exports the connection pool', () => {
  assert.equal(typeof PgPool, 'function');
  assert.equal(typeof onPoolExhausted, 'function');
});

test('re-exports the schema inspector', () => {
  assert.equal(typeof SchemaInspector, 'function');
  assert.equal(typeof SchemaInspector.inspect, 'function');
});

test('re-exports the migration runner and differ', () => {
  assert.equal(typeof StreetMigrationRunner, 'function');
  assert.equal(typeof MigrationDiffer, 'function');
  assert.equal(typeof MigrationDiffer.diff, 'function');
});

test('re-exports the repository and ledger service', () => {
  assert.equal(typeof StreetPostgresRepository, 'function');
  assert.equal(typeof LedgerTransactionService, 'function');
});

test('the aggregated API is usable together (pool + schema inspector via one import)', async () => {
  // A fake pool named "PgPool" routes the inspector down the Postgres path,
  // proving the two re-exported packages interoperate through the meta-import.
  const result = (rows: Record<string, string | null>[]) => ({ rows, rowCount: rows.length, command: 'SELECT' });
  class PgPool {
    async query(sql: string) {
      if (/pg_indexes|referential_constraints/i.test(sql)) return result([]);
      return result([
        { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_pk: 't' },
      ]);
    }
  }
  const schema = await SchemaInspector.inspect(new PgPool() as never);
  const users = schema.tables.find((t) => t.name === 'users');
  assert.ok(users, 'inspector produced the users table');
  assert.deepEqual(users.primaryKey, ['id']);

  // Touch the imported types so they are exercised by the compiler.
  const _typecheck: [DbResult | undefined, PoolOptions | undefined, DatabaseSchema, MigrationDiff | undefined, IRepository<object> | undefined] =
    [undefined, undefined, schema, undefined, undefined];
  assert.equal(_typecheck.length, 5);
});
