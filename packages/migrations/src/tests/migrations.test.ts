import 'reflect-metadata';
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MigrationDiffer, StreetMigrationRunner } from '../index.js';
import { SchemaInspector } from '@streetjs/schema-inspector';
import type { PgPool as RealPgPool } from '@streetjs/pool';

// The metadata keys the differ reads (contract set by the @Entity/@Column
// decorators in core). We set them directly here — the same values a decorator
// would emit.
const COLUMNS = 'street:columns';
const INDEXES = 'street:indexes';
const TABLE = 'street:table';
const PK = 'street:primaryKey';

function result(rows: Record<string, string | null>[]) {
  return { rows, rowCount: rows.length, command: 'SELECT' };
}

// ── A fake "PgPool" so SchemaInspector routes down the Postgres path ───────────

class PgPool {
  constructor(private readonly tables: { name: string; columns: { name: string; type: string }[]; indexes?: string[] }[] = []) {}
  async query(sql: string) {
    if (/pg_indexes/i.test(sql)) {
      const rows: Record<string, string | null>[] = [];
      for (const t of this.tables) {
        for (const idx of t.indexes ?? []) {
          rows.push({ tablename: t.name, indexname: idx, indexdef: `CREATE INDEX ${idx} ON ${t.name} (x)` });
        }
      }
      return result(rows);
    }
    if (/referential_constraints/i.test(sql)) return result([]);
    const rows: Record<string, string | null>[] = [];
    for (const t of this.tables) {
      for (const c of t.columns) {
        rows.push({ table_name: t.name, column_name: c.name, data_type: c.type, is_nullable: 'YES', column_default: null, is_pk: 'false' });
      }
    }
    return result(rows);
  }
}

function diffPool(tables: { name: string; columns: { name: string; type: string }[]; indexes?: string[] }[]): unknown {
  return new PgPool(tables);
}

afterEach(() => SchemaInspector._cache.clear());

// ── MigrationDiffer ─────────────────────────────────────────────────────────────

test('diff: a missing table yields a safe CREATE TABLE plus its indexes', async () => {
  class User {}
  Reflect.defineMetadata(TABLE, 'users', User);
  Reflect.defineMetadata(COLUMNS, [
    { name: 'id', type: 'INTEGER', nullable: false },
    { name: 'email', type: 'TEXT' },
  ], User);
  Reflect.defineMetadata(PK, ['id'], User);
  Reflect.defineMetadata(INDEXES, [{ name: 'idx_users_email', columns: ['email'], unique: true }], User);

  const diff = await MigrationDiffer.diff(diffPool([]) as never, [User]);
  assert.equal(diff.destructive.length, 0);
  assert.match(diff.safe[0]!, /CREATE TABLE users \(id INTEGER NOT NULL, email TEXT, PRIMARY KEY \(id\)\);/);
  assert.match(diff.safe[1]!, /CREATE UNIQUE INDEX idx_users_email ON users \(email\);/);
});

test('diff: adding a nullable column is safe, a NOT NULL column without default is destructive', async () => {
  class Widget {}
  Reflect.defineMetadata(TABLE, 'widgets', Widget);
  Reflect.defineMetadata(COLUMNS, [
    { name: 'id', type: 'integer' },
    { name: 'note', type: 'text' }, // nullable add → safe
    { name: 'code', type: 'text', nullable: false }, // NOT NULL, no default → destructive
    { name: 'flag', type: 'boolean', nullable: false, default: 'false' }, // NOT NULL w/ default → safe
  ], Widget);

  const pool = diffPool([{ name: 'widgets', columns: [{ name: 'id', type: 'integer' }] }]);
  const diff = await MigrationDiffer.diff(pool as never, [Widget]);

  assert.ok(diff.safe.some((s) => /ADD COLUMN note text;/.test(s)));
  assert.ok(diff.safe.some((s) => /ADD COLUMN flag boolean NOT NULL DEFAULT false;/.test(s)));
  assert.ok(diff.destructive.some((s) => /ADD COLUMN code text NOT NULL;/.test(s)));
});

test('diff: a type change is a destructive ALTER COLUMN', async () => {
  class Item {}
  Reflect.defineMetadata(TABLE, 'items', Item);
  Reflect.defineMetadata(COLUMNS, [{ name: 'qty', type: 'BIGINT' }], Item);
  const pool = diffPool([{ name: 'items', columns: [{ name: 'qty', type: 'integer' }] }]);
  const diff = await MigrationDiffer.diff(pool as never, [Item]);
  assert.ok(diff.destructive.some((s) => /ALTER TABLE items ALTER COLUMN qty TYPE BIGINT;/.test(s)));
});

test('diff: type synonyms (int vs integer) do not produce a spurious change', async () => {
  class Item {}
  Reflect.defineMetadata(TABLE, 'items', Item);
  Reflect.defineMetadata(COLUMNS, [{ name: 'qty', type: 'INT' }], Item);
  const pool = diffPool([{ name: 'items', columns: [{ name: 'qty', type: 'integer' }] }]);
  const diff = await MigrationDiffer.diff(pool as never, [Item]);
  assert.equal(diff.safe.length, 0);
  assert.equal(diff.destructive.length, 0);
});

test('diff: a column present in DB but not in the entity is a destructive DROP COLUMN', async () => {
  class Item {}
  Reflect.defineMetadata(TABLE, 'items', Item);
  Reflect.defineMetadata(COLUMNS, [{ name: 'id', type: 'integer' }], Item);
  const pool = diffPool([{ name: 'items', columns: [{ name: 'id', type: 'integer' }, { name: 'legacy', type: 'text' }] }]);
  const diff = await MigrationDiffer.diff(pool as never, [Item]);
  assert.ok(diff.destructive.some((s) => /DROP COLUMN legacy;/.test(s)));
});

test('diff: a live table with no entity is dropped, but framework tables are preserved', async () => {
  const pool = diffPool([
    { name: 'orphan', columns: [{ name: 'id', type: 'integer' }] },
    { name: 'street_migrations', columns: [{ name: 'id', type: 'integer' }] },
    { name: 'sqlite_sequence', columns: [{ name: 'name', type: 'text' }] },
  ]);
  const diff = await MigrationDiffer.diff(pool as never, []);
  assert.ok(diff.destructive.some((s) => /DROP TABLE orphan;/.test(s)));
  assert.ok(!diff.destructive.some((s) => /street_migrations/.test(s)));
  assert.ok(!diff.destructive.some((s) => /sqlite_sequence/.test(s)));
});

test('diff: a missing index on an existing table is a safe CREATE INDEX', async () => {
  class Post {}
  Reflect.defineMetadata(TABLE, 'posts', Post);
  Reflect.defineMetadata(COLUMNS, [{ name: 'title', type: 'text' }], Post);
  Reflect.defineMetadata(INDEXES, [{ name: 'idx_posts_title', columns: ['title'] }], Post);
  const pool = diffPool([{ name: 'posts', columns: [{ name: 'title', type: 'text' }], indexes: [] }]);
  const diff = await MigrationDiffer.diff(pool as never, [Post]);
  assert.ok(diff.safe.some((s) => /CREATE INDEX idx_posts_title ON posts \(title\);/.test(s)));
});

test('diff: entity table name falls back to the lowercased class name', async () => {
  class Account {}
  Reflect.defineMetadata(COLUMNS, [{ name: 'id', type: 'integer' }], Account);
  const diff = await MigrationDiffer.diff(diffPool([]) as never, [Account]);
  assert.match(diff.safe[0]!, /CREATE TABLE account /);
});

test('diff: an entity with no resolvable table name is skipped', async () => {
  const anon = {}; // no name, no metadata → resolveTableName returns ''
  const diff = await MigrationDiffer.diff(diffPool([]) as never, [anon]);
  assert.equal(diff.safe.length, 0);
  assert.equal(diff.destructive.length, 0);
});

test('diff: an unsafe identifier in metadata is rejected', async () => {
  class Bad {}
  Reflect.defineMetadata(TABLE, 'users; DROP TABLE users', Bad);
  Reflect.defineMetadata(COLUMNS, [{ name: 'id', type: 'integer' }], Bad);
  await assert.rejects(() => MigrationDiffer.diff(diffPool([]) as never, [Bad]), /Unsafe table name/);
});

test('diff: an unsafe column default is rejected', async () => {
  class Bad {}
  Reflect.defineMetadata(TABLE, 'things', Bad);
  Reflect.defineMetadata(COLUMNS, [{ name: 'x', type: 'text', default: "'a'; DROP TABLE things;--" }], Bad);
  await assert.rejects(() => MigrationDiffer.diff(diffPool([]) as never, [Bad]), /Unsafe column default/);
});

// ── StreetMigrationRunner ────────────────────────────────────────────────────────

/** A fake PgPool recording queries and running the transaction callback. */
function makeRunnerPool() {
  const queries: { sql: string; params?: unknown[] }[] = [];
  const applied = new Set<string>();
  const conn = {
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      // Emulate recording an applied migration on INSERT.
      const m = /VALUES \(\$1/.test(sql) && sql.includes('INSERT') ? params?.[0] : undefined;
      if (typeof m === 'string') applied.add(m);
      return result([]);
    },
  };
  const pool = {
    queries,
    applied,
    async query(sql: string, params?: unknown[]) {
      queries.push({ sql, params });
      if (/SELECT name FROM street_migrations/.test(sql)) {
        return result([...applied].map((name) => ({ name })));
      }
      return result([]);
    },
    async transaction<T>(fn: (c: typeof conn) => Promise<T>): Promise<T> {
      return fn(conn);
    },
  };
  return pool;
}

async function makeMigrationsDir(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'streetjs-migrations-'));
  for (const [name, sql] of Object.entries(files)) {
    await writeFile(join(dir, name), sql, 'utf8');
  }
  return dir;
}

test('runner: applies pending migrations in lexicographic order and records them', async () => {
  const pool = makeRunnerPool();
  const dir = await makeMigrationsDir({
    '002_second.sql': 'CREATE TABLE b (id int);',
    '001_first.sql': 'CREATE TABLE a (id int);',
    'notes.txt': 'ignored',
  });
  try {
    await new StreetMigrationRunner(pool as unknown as RealPgPool).run(dir);
    const applied = [...pool.applied];
    assert.deepEqual(applied, ['001_first.sql', '002_second.sql']);
    // The tracking table is created first.
    assert.ok(pool.queries.some((q) => /CREATE TABLE IF NOT EXISTS street_migrations/.test(q.sql)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runner: skips already-applied migrations', async () => {
  const pool = makeRunnerPool();
  pool.applied.add('001_first.sql');
  const dir = await makeMigrationsDir({
    '001_first.sql': 'CREATE TABLE a (id int);',
    '002_second.sql': 'CREATE TABLE b (id int);',
  });
  try {
    await new StreetMigrationRunner(pool as unknown as RealPgPool).run(dir);
    // Only the second migration's DDL should have been executed this run.
    const ddl = pool.queries.filter((q) => /CREATE TABLE [ab] /.test(q.sql)).map((q) => q.sql);
    assert.equal(ddl.length, 1);
    assert.match(ddl[0]!, /CREATE TABLE b /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runner: a missing directory is tolerated (no migrations, no throw)', async () => {
  const pool = makeRunnerPool();
  const dir = join(tmpdir(), 'streetjs-does-not-exist-' + Date.now());
  await assert.doesNotReject(() => new StreetMigrationRunner(pool as unknown as RealPgPool).run(dir));
  assert.equal(pool.applied.size, 0);
});

test('runner: rollback runs the .rollback.sql and removes the record', async () => {
  const pool = makeRunnerPool();
  pool.applied.add('001_first.sql');
  const dir = await makeMigrationsDir({
    '001_first.sql': 'CREATE TABLE a (id int);',
    '001_first.rollback.sql': 'DROP TABLE a;',
  });
  try {
    await new StreetMigrationRunner(pool as unknown as RealPgPool).rollback(dir, 1);
    assert.ok(pool.queries.some((q) => /DROP TABLE a;/.test(q.sql)));
    assert.ok(pool.queries.some((q) => /DELETE FROM street_migrations/.test(q.sql)));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('runner: rollback throws when the .rollback.sql file is missing', async () => {
  const pool = makeRunnerPool();
  pool.applied.add('001_first.sql');
  const dir = await makeMigrationsDir({ '001_first.sql': 'CREATE TABLE a (id int);' });
  try {
    await assert.rejects(
      () => new StreetMigrationRunner(pool as unknown as RealPgPool).rollback(dir, 1),
      /Rollback file not found/
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
