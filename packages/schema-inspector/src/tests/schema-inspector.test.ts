import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SchemaInspector } from '../index.js';
import type { DatabaseSchema, QueryablePool } from '../index.js';

// Minimal DbResult-shaped helper.
function result(rows: Record<string, string | null>[]): {
  rows: Record<string, string | null>[];
  rowCount: number;
  command: string;
} {
  return { rows, rowCount: rows.length, command: 'SELECT' };
}

// ── Fake pools whose constructor.name drives dialect detection ─────────────────
//
// These are legitimate fake data sources satisfying QueryablePool — not mocks of
// the code under test. Their class names ("PgPool", "SqlitePool", generic) route
// the inspector down each dialect path so all three can be tested with no live
// database.

class PgPool implements QueryablePool {
  queryCount = 0;
  async query(sql: string): Promise<ReturnType<typeof result>> {
    this.queryCount++;
    if (/pg_indexes/i.test(sql)) {
      return result([
        { tablename: 'posts', indexname: 'idx_posts_title', indexdef: 'CREATE INDEX idx_posts_title ON public.posts USING btree (title)' },
        { tablename: 'users', indexname: 'users_email_key', indexdef: 'CREATE UNIQUE INDEX users_email_key ON public.users USING btree ("email")' },
        { tablename: 'ghost', indexname: 'x', indexdef: 'CREATE INDEX x ON ghost (a)' }, // table not in colResult → skipped
      ]);
    }
    if (/referential_constraints/i.test(sql)) {
      return result([
        { table_name: 'posts', column_name: 'user_id', ref_table: 'users', ref_column: 'id' },
        { table_name: 'ghost', column_name: 'a', ref_table: 'users', ref_column: 'id' }, // skipped
      ]);
    }
    // columns
    return result([
      { table_name: 'users', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: "nextval('users_id_seq')", is_pk: 't' },
      { table_name: 'users', column_name: 'email', data_type: 'text', is_nullable: 'YES', column_default: null, is_pk: 'false' },
      { table_name: 'posts', column_name: 'id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_pk: 'true' },
      { table_name: 'posts', column_name: 'user_id', data_type: 'integer', is_nullable: 'NO', column_default: null, is_pk: 'false' },
      { table_name: 'posts', column_name: 'title', data_type: 'text', is_nullable: 'NO', column_default: null, is_pk: 'false' },
    ]);
  }
}

class SqlitePool implements QueryablePool {
  queryCount = 0;
  async query(sql: string): Promise<ReturnType<typeof result>> {
    this.queryCount++;
    if (/sqlite_master/i.test(sql)) {
      return result([{ name: 'users' }, { name: 'posts' }]);
    }
    if (/table_info\("users"\)/i.test(sql)) {
      return result([
        { name: 'id', type: 'INTEGER', notnull: '1', dflt_value: null, pk: '1' },
        { name: 'email', type: 'TEXT', notnull: '0', dflt_value: null, pk: '0' },
      ]);
    }
    if (/table_info\("posts"\)/i.test(sql)) {
      return result([
        { name: 'group_id', type: 'INTEGER', notnull: '1', dflt_value: null, pk: '2' },
        { name: 'user_id', type: 'INTEGER', notnull: '1', dflt_value: null, pk: '1' },
        { name: 'title', type: 'TEXT', notnull: '0', dflt_value: "''", pk: '0' },
      ]);
    }
    if (/index_list\("users"\)/i.test(sql)) {
      return result([{ name: 'idx_users_email', unique: '1' }]);
    }
    if (/index_list\("posts"\)/i.test(sql)) {
      return result([]);
    }
    if (/index_info\("idx_users_email"\)/i.test(sql)) {
      return result([{ seqno: '0', cid: '1', name: 'email' }]);
    }
    if (/foreign_key_list\("posts"\)/i.test(sql)) {
      return result([{ id: '0', seq: '0', table: 'users', from: 'user_id', to: 'id' }]);
    }
    // foreign_key_list(users), etc.
    return result([]);
  }
}

class MysqlPool implements QueryablePool {
  queryCount = 0;
  async query(sql: string): Promise<ReturnType<typeof result>> {
    this.queryCount++;
    if (/KEY_COLUMN_USAGE/i.test(sql)) {
      return result([
        { table_name: 'posts', column_name: 'user_id', ref_table: 'users', ref_column: 'id' },
        { table_name: 'ghost', column_name: 'a', ref_table: 'users', ref_column: 'id' }, // skipped
      ]);
    }
    if (/STATISTICS/i.test(sql)) {
      return result([
        { table_name: 'posts', index_name: 'idx_ab', column_name: 'a', non_unique: '0' },
        { table_name: 'posts', index_name: 'idx_ab', column_name: 'b', non_unique: '0' },
        { table_name: 'ghost', index_name: 'gi', column_name: 'a', non_unique: '1' }, // skipped
      ]);
    }
    // information_schema.COLUMNS
    return result([
      { table_name: 'posts', column_name: 'a', data_type: 'int', is_nullable: 'NO', column_default: null, column_key: 'PRI' },
      { table_name: 'posts', column_name: 'b', data_type: 'varchar', is_nullable: 'YES', column_default: null, column_key: '' },
    ]);
  }
}

afterEach(() => {
  // Clear the shared static cache so tests never leak state.
  SchemaInspector._cache.clear();
});

// ── PostgreSQL path ────────────────────────────────────────────────────────────

test('Postgres: builds tables, columns, primary keys, FKs, and indexes', async () => {
  const schema = await SchemaInspector.inspect(new PgPool());
  const users = schema.tables.find((t) => t.name === 'users')!;
  const posts = schema.tables.find((t) => t.name === 'posts')!;

  assert.deepEqual(users.primaryKey, ['id']); // is_pk 't'
  assert.deepEqual(posts.primaryKey, ['id']); // is_pk 'true'
  assert.equal(users.columns.find((c) => c.name === 'email')!.nullable, true);
  assert.equal(users.columns.find((c) => c.name === 'id')!.nullable, false);

  const fk = posts.foreignKeys.find((f) => f.column === 'user_id')!;
  assert.equal(fk.refTable, 'users');
  assert.equal(fk.refColumn, 'id');

  const titleIdx = posts.indexes.find((i) => i.name === 'idx_posts_title')!;
  assert.deepEqual(titleIdx.columns, ['title']);
  assert.equal(titleIdx.unique, false);

  const emailIdx = users.indexes.find((i) => i.name === 'users_email_key')!;
  assert.deepEqual(emailIdx.columns, ['email'], 'quoted column name is unquoted');
  assert.equal(emailIdx.unique, true);
});

test('Postgres: rows referencing unknown tables are skipped', async () => {
  const schema = await SchemaInspector.inspect(new PgPool());
  assert.equal(schema.tables.find((t) => t.name === 'ghost'), undefined);
});

// ── MySQL path ──────────────────────────────────────────────────────────────────

test('MySQL: PRI key, FK, and multi-column unique index grouping', async () => {
  const schema = await SchemaInspector.inspect(new MysqlPool());
  const posts = schema.tables.find((t) => t.name === 'posts')!;
  assert.deepEqual(posts.primaryKey, ['a']);
  assert.equal(posts.columns.find((c) => c.name === 'b')!.nullable, true);
  assert.equal(posts.foreignKeys[0]!.refTable, 'users');

  const idx = posts.indexes.find((i) => i.name === 'idx_ab')!;
  assert.deepEqual(idx.columns, ['a', 'b'], 'index columns grouped in order');
  assert.equal(idx.unique, true, 'non_unique=0 means unique');
});

// ── SQLite path ─────────────────────────────────────────────────────────────────

test('SQLite: tables, columns, composite PK order, FK, and indexes', async () => {
  const schema = await SchemaInspector.inspect(new SqlitePool());
  const users = schema.tables.find((t) => t.name === 'users')!;
  const posts = schema.tables.find((t) => t.name === 'posts')!;

  assert.deepEqual(users.primaryKey, ['id']);
  assert.equal(users.columns.find((c) => c.name === 'email')!.nullable, true);

  // Composite PK sorted by pk position: user_id (pk=1) before group_id (pk=2).
  assert.deepEqual(posts.primaryKey, ['user_id', 'group_id']);
  assert.equal(posts.columns.find((c) => c.name === 'title')!.default, "''");

  assert.equal(posts.foreignKeys[0]!.column, 'user_id');
  assert.equal(posts.foreignKeys[0]!.refTable, 'users');

  const idx = users.indexes.find((i) => i.name === 'idx_users_email')!;
  assert.deepEqual(idx.columns, ['email']);
  assert.equal(idx.unique, true);
  assert.deepEqual(posts.indexes, [], 'posts has no explicit indexes');
});

test('SQLite: an empty database yields no tables', async () => {
  class EmptySqlite implements QueryablePool {
    async query(sql: string): Promise<ReturnType<typeof result>> {
      if (/sqlite_master/i.test(sql)) return result([]);
      return result([]);
    }
  }
  // Rename so constructor.name === 'SqlitePool'.
  Object.defineProperty(EmptySqlite, 'name', { value: 'SqlitePool' });
  const schema = await SchemaInspector.inspect(new EmptySqlite());
  assert.deepEqual(schema.tables, []);
});

// ── Caching & invalidation ───────────────────────────────────────────────────────

test('inspect caches within the TTL and returns the same object', async () => {
  const pool = new PgPool();
  const first = await SchemaInspector.inspect(pool);
  const countAfterFirst = pool.queryCount;
  const second = await SchemaInspector.inspect(pool);
  assert.strictEqual(first, second);
  assert.equal(pool.queryCount, countAfterFirst, 'no re-query within TTL');
});

test('a custom ttlMs is honored', async () => {
  const pool = new PgPool();
  await SchemaInspector.inspect(pool, { ttlMs: 100 });
  const entry = SchemaInspector._cache.get(pool as object)!;
  const remaining = entry.expiresAt - Date.now();
  assert.ok(remaining > 0 && remaining <= 150, `expected ~100ms TTL, got ${remaining}`);
});

test('an expired cache entry triggers a fresh inspect', async () => {
  const pool = new PgPool();
  const first = await SchemaInspector.inspect(pool, { ttlMs: 60_000 });
  SchemaInspector._cache.get(pool as object)!.expiresAt = Date.now() - 1;
  const second = await SchemaInspector.inspect(pool);
  assert.notStrictEqual(first, second);
  assert.ok(pool.queryCount > 3, 're-fetched from the source');
});

test('invalidateCache forces a re-fetch', async () => {
  const pool = new PgPool();
  const first = await SchemaInspector.inspect(pool);
  assert.ok(SchemaInspector._cache.has(pool as object));
  SchemaInspector.invalidateCache(pool);
  assert.ok(!SchemaInspector._cache.has(pool as object));
  const second = await SchemaInspector.inspect(pool);
  assert.notStrictEqual(first, second);
});

test('invalidateCache on an unknown pool does not throw', () => {
  assert.doesNotThrow(() => SchemaInspector.invalidateCache(new PgPool()));
});

test('inspectedAt is a recent Date', async () => {
  const before = Date.now();
  const schema: DatabaseSchema = await SchemaInspector.inspect(new PgPool());
  assert.ok(schema.inspectedAt instanceof Date);
  assert.ok(schema.inspectedAt.getTime() >= before);
});
