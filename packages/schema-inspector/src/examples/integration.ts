/**
 * @streetjs/schema-inspector — runnable integration example.
 *
 * Introspects a database through the structural `QueryablePool` interface,
 * without a live server, by supplying an in-memory fake whose `constructor.name`
 * ("PgPool") routes it down the PostgreSQL path. In a real app you pass your
 * actual pool (PgPool, MysqlPool, or SqlitePool) — no code change needed.
 *
 * Run with: `npm run example -w packages/schema-inspector`
 */

import { SchemaInspector } from '../index.js';
import type { QueryablePool } from '../index.js';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

function rows(r: Record<string, string | null>[]) {
  return { rows: r, rowCount: r.length, command: 'SELECT' };
}

// A fake PostgreSQL pool serving canned catalogue rows.
class PgPool implements QueryablePool {
  async query(sql: string) {
    if (/pg_indexes/i.test(sql)) {
      return rows([
        {
          tablename: 'users',
          indexname: 'users_email_key',
          indexdef: 'CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email)',
        },
      ]);
    }
    if (/referential_constraints/i.test(sql)) {
      return rows([
        { table_name: 'posts', column_name: 'author_id', ref_table: 'users', ref_column: 'id' },
      ]);
    }
    return rows([
      { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_pk: 't' },
      { table_name: 'users', column_name: 'email', data_type: 'text', is_nullable: 'YES', column_default: null, is_pk: 'false' },
      { table_name: 'posts', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_pk: 't' },
      { table_name: 'posts', column_name: 'author_id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_pk: 'false' },
    ]);
  }
}

const pool = new PgPool();

// First inspect hits the database (our fake); the result is cached.
const schema = await SchemaInspector.inspect(pool);
console.log(`inspected ${schema.tables.length} tables at ${schema.inspectedAt.toISOString()}`);
for (const t of schema.tables) {
  console.log(`  ${t.name}: ${t.columns.map((c) => c.name).join(', ')} (pk: ${t.primaryKey.join('+') || 'none'})`);
}

const users = schema.tables.find((t) => t.name === 'users')!;
const posts = schema.tables.find((t) => t.name === 'posts')!;
assert(users.primaryKey.join(',') === 'id', 'users pk is id');
assert(users.indexes.some((i) => i.unique && i.columns[0] === 'email'), 'unique email index detected');
assert(posts.foreignKeys[0]!.refTable === 'users', 'posts.author_id references users');

// A second inspect within the TTL is served from cache (same object).
const again = await SchemaInspector.inspect(pool);
assert(again === schema, 'second inspect is a cache hit');

// Invalidation forces a fresh introspection.
SchemaInspector.invalidateCache(pool);
const fresh = await SchemaInspector.inspect(pool);
assert(fresh !== schema, 'inspect after invalidate re-fetches');

console.log('\nAll @streetjs/schema-inspector example assertions passed.');
