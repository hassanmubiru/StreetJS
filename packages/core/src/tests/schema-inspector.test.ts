// src/tests/schema-inspector.test.ts
// Unit tests for SchemaInspector against a real SqlitePool (:memory:).
// No network required.
//
// Run after `tsc`:
//   node --test dist/tests/schema-inspector.test.js

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { SqlitePool } from '../database/sqlite/pool.js';
import { SchemaInspector } from '../database/schema-inspector.js';
import type { DatabaseSchema } from '../database/schema-inspector.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Create an in-memory SQLite pool with the test schema pre-loaded. */
async function makePool(): Promise<SqlitePool> {
  const pool = new SqlitePool({ filePath: ':memory:' });

  // Users table (pk: id)
  await pool.query(`
    CREATE TABLE users (
      id   INTEGER PRIMARY KEY,
      name TEXT    NOT NULL,
      email TEXT
    )
  `);

  // Posts table with FK to users
  await pool.query(`
    CREATE TABLE posts (
      id      INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      title   TEXT    NOT NULL
    )
  `);

  // A composite-pk table
  await pool.query(`
    CREATE TABLE memberships (
      user_id  INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      role     TEXT,
      PRIMARY KEY (user_id, group_id)
    )
  `);

  // An explicit index on posts.title
  await pool.query('CREATE INDEX idx_posts_title ON posts (title)');

  // A unique index on users.email
  await pool.query('CREATE UNIQUE INDEX idx_users_email ON users (email)');

  return pool;
}

// ─── 1. Basic introspection ───────────────────────────────────────────────────

describe('SchemaInspector — SQLite basic introspection', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('returns a DatabaseSchema with the expected tables', async () => {
    const schema: DatabaseSchema = await SchemaInspector.inspect(pool);

    assert.ok(schema.tables.length >= 3, `expected at least 3 tables, got ${schema.tables.length}`);
    const names = schema.tables.map((t) => t.name).sort();
    assert.ok(names.includes('users'), 'expected "users" table');
    assert.ok(names.includes('posts'), 'expected "posts" table');
    assert.ok(names.includes('memberships'), 'expected "memberships" table');
  });

  it('introspects column metadata for users table', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const users = schema.tables.find((t) => t.name === 'users');
    assert.ok(users, 'users table must be present');

    const colNames = users.columns.map((c) => c.name);
    assert.ok(colNames.includes('id'), 'expected "id" column');
    assert.ok(colNames.includes('name'), 'expected "name" column');
    assert.ok(colNames.includes('email'), 'expected "email" column');

    const idCol = users.columns.find((c) => c.name === 'id');
    assert.ok(idCol, 'id column must exist');
    assert.equal(idCol.type.toUpperCase(), 'INTEGER');
  });

  it('detects primary key on users table', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const users = schema.tables.find((t) => t.name === 'users');
    assert.ok(users, 'users table must be present');
    assert.deepEqual(users.primaryKey, ['id']);
  });

  it('detects composite primary key on memberships table', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const memberships = schema.tables.find((t) => t.name === 'memberships');
    assert.ok(memberships, 'memberships table must be present');
    assert.equal(memberships.primaryKey.length, 2);
    assert.ok(memberships.primaryKey.includes('user_id'), 'pk must include user_id');
    assert.ok(memberships.primaryKey.includes('group_id'), 'pk must include group_id');
  });

  it('detects foreign key on posts.user_id', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const posts = schema.tables.find((t) => t.name === 'posts');
    assert.ok(posts, 'posts table must be present');
    assert.ok(posts.foreignKeys.length >= 1, 'expected at least one FK on posts');

    const fk = posts.foreignKeys.find((f) => f.column === 'user_id');
    assert.ok(fk, 'FK on user_id must be found');
    assert.equal(fk.refTable, 'users');
    assert.equal(fk.refColumn, 'id');
  });

  it('detects non-unique index idx_posts_title', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const posts = schema.tables.find((t) => t.name === 'posts');
    assert.ok(posts, 'posts table must be present');

    const idx = posts.indexes.find((i) => i.name === 'idx_posts_title');
    assert.ok(idx, 'idx_posts_title must be present');
    assert.deepEqual(idx.columns, ['title']);
    assert.equal(idx.unique, false);
  });

  it('detects unique index idx_users_email', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const users = schema.tables.find((t) => t.name === 'users');
    assert.ok(users, 'users table must be present');

    const idx = users.indexes.find((i) => i.name === 'idx_users_email');
    assert.ok(idx, 'idx_users_email must be present');
    assert.deepEqual(idx.columns, ['email']);
    assert.equal(idx.unique, true);
  });

  it('sets inspectedAt to a recent Date', async () => {
    const before = Date.now();
    const schema = await SchemaInspector.inspect(pool);
    const after = Date.now();
    assert.ok(schema.inspectedAt instanceof Date);
    assert.ok(schema.inspectedAt.getTime() >= before);
    assert.ok(schema.inspectedAt.getTime() <= after + 10);
  });
});

// ─── 2. Nullable / NOT NULL columns ──────────────────────────────────────────

describe('SchemaInspector — SQLite nullable columns', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('marks NOT NULL columns as nullable=false', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const users = schema.tables.find((t) => t.name === 'users');
    assert.ok(users);
    const nameCol = users.columns.find((c) => c.name === 'name');
    assert.ok(nameCol, 'name column must exist');
    assert.equal(nameCol.nullable, false);
  });

  it('marks nullable columns as nullable=true', async () => {
    const schema = await SchemaInspector.inspect(pool);
    const users = schema.tables.find((t) => t.name === 'users');
    assert.ok(users);
    const emailCol = users.columns.find((c) => c.name === 'email');
    assert.ok(emailCol, 'email column must exist');
    assert.equal(emailCol.nullable, true);
  });
});

// ─── 3. Cache behavior ───────────────────────────────────────────────────────

describe('SchemaInspector — caching', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('second call returns the same cached DatabaseSchema object', async () => {
    const first = await SchemaInspector.inspect(pool);
    const second = await SchemaInspector.inspect(pool);
    // Strict referential equality — same object from cache
    assert.strictEqual(first, second);
  });

  it('cache stores an entry keyed by the pool object', async () => {
    await SchemaInspector.inspect(pool);
    assert.ok(SchemaInspector._cache.has(pool as object), 'cache must have an entry for the pool');
  });

  it('returns a fresh schema after TTL has expired (mocked expiresAt)', async () => {
    const first = await SchemaInspector.inspect(pool, { ttlMs: 60_000 });

    // Manually set expiresAt to the past to simulate expiry
    const entry = SchemaInspector._cache.get(pool as object)!;
    assert.ok(entry, 'cache entry must exist');
    entry.expiresAt = Date.now() - 1; // already expired

    const second = await SchemaInspector.inspect(pool);
    // Must be a new object (re-fetched)
    assert.notStrictEqual(first, second, 'expected a fresh schema after TTL expiry');
  });

  it('uses the custom TTL passed via opts', async () => {
    const shortTtl = 100; // 100 ms
    await SchemaInspector.inspect(pool, { ttlMs: shortTtl });

    const entry = SchemaInspector._cache.get(pool as object)!;
    assert.ok(entry, 'cache entry must exist');
    const remaining = entry.expiresAt - Date.now();
    // Should be ~100 ms remaining (within reasonable margin)
    assert.ok(remaining > 0 && remaining <= shortTtl + 50,
      `expected TTL ~${shortTtl}ms, got ${remaining}ms remaining`);
  });
});

// ─── 4. Cache invalidation ───────────────────────────────────────────────────

describe('SchemaInspector — invalidateCache', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('removes the cache entry after invalidateCache()', async () => {
    await SchemaInspector.inspect(pool);
    assert.ok(SchemaInspector._cache.has(pool as object), 'entry must exist before invalidation');

    SchemaInspector.invalidateCache(pool);
    assert.ok(!SchemaInspector._cache.has(pool as object), 'entry must be gone after invalidation');
  });

  it('forces a re-fetch after invalidateCache()', async () => {
    const first = await SchemaInspector.inspect(pool);

    SchemaInspector.invalidateCache(pool);

    const second = await SchemaInspector.inspect(pool);
    // Must be a new schema object (different reference)
    assert.notStrictEqual(first, second, 'expected a new schema object after invalidation');
  });

  it('invalidateCache() on a pool with no entry does not throw', () => {
    const fresh = new SqlitePool({ filePath: ':memory:' });
    try {
      assert.doesNotThrow(() => SchemaInspector.invalidateCache(fresh));
    } finally {
      // close the pool (fire and forget, test already done)
      void fresh.close().catch(() => undefined);
    }
  });
});

// ─── 5. Empty database ───────────────────────────────────────────────────────

describe('SchemaInspector — empty database', () => {
  it('returns an empty tables array for a fresh :memory: database', async () => {
    const pool = new SqlitePool({ filePath: ':memory:' });
    try {
      const schema = await SchemaInspector.inspect(pool);
      assert.deepEqual(schema.tables, []);
    } finally {
      SchemaInspector.invalidateCache(pool);
      await pool.close();
    }
  });
});
