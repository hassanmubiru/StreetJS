// src/tests/migration-diff.test.ts
// Unit tests for MigrationDiffer.diff() against a real SqlitePool (:memory:).
// No network required.
//
// Run after `tsc`:
//   node --test dist/tests/migration-diff.test.js

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import 'reflect-metadata';

import { SqlitePool } from '../database/sqlite/pool.js';
import { SchemaInspector } from '../database/schema-inspector.js';
import {
  MigrationDiffer,
  type EntityColumnMeta,
  type EntityIndexMeta,
} from '../database/migrations.js';

// ─── Entity metadata helpers ───────────────────────────────────────────────────

interface EntitySpec {
  table: string;
  columns: EntityColumnMeta[];
  indexes?: EntityIndexMeta[];
  primaryKey?: string[];
}

/** Build a class carrying the `street:*` metadata MigrationDiffer reads. */
function makeEntity(spec: EntitySpec): object {
  class Entity {}
  Reflect.defineMetadata('street:table', spec.table, Entity);
  Reflect.defineMetadata('street:columns', spec.columns, Entity);
  if (spec.indexes) Reflect.defineMetadata('street:indexes', spec.indexes, Entity);
  if (spec.primaryKey) Reflect.defineMetadata('street:primaryKey', spec.primaryKey, Entity);
  return Entity;
}

/** Create an in-memory SQLite pool with a baseline `users` table. */
async function makePool(): Promise<SqlitePool> {
  const pool = new SqlitePool({ filePath: ':memory:' });
  await pool.query(`
    CREATE TABLE users (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      email TEXT
    )
  `);
  return pool;
}

// ─── 1. Identical schema → empty diff ──────────────────────────────────────────

describe('MigrationDiffer — no changes', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('produces no statements when entity matches the live table', async () => {
    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT' },
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.safe, []);
    assert.deepEqual(diff.destructive, []);
  });
});

// ─── 2. Additive (safe) changes ────────────────────────────────────────────────

describe('MigrationDiffer — safe additive changes', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('emits CREATE TABLE for an entity table missing from the DB', async () => {
    const posts = makeEntity({
      table: 'posts',
      columns: [
        { name: 'id', type: 'INTEGER', nullable: false },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'body', type: 'TEXT' },
      ],
      primaryKey: ['id'],
    });

    const diff = await MigrationDiffer.diff(pool, [posts]);
    assert.equal(diff.destructive.length, 0);
    assert.equal(diff.safe.length, 1);
    const stmt = diff.safe[0]!;
    assert.match(stmt, /^CREATE TABLE posts \(/);
    assert.match(stmt, /id INTEGER NOT NULL/);
    assert.match(stmt, /title TEXT NOT NULL/);
    assert.match(stmt, /body TEXT/);
    assert.match(stmt, /PRIMARY KEY \(id\)/);
  });

  it('emits ADD COLUMN (safe) for a new nullable column', async () => {
    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT' },
        { name: 'bio', type: 'TEXT' }, // new, nullable
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.destructive, []);
    assert.deepEqual(diff.safe, ['ALTER TABLE users ADD COLUMN bio TEXT;']);
  });

  it('emits ADD COLUMN (safe) for a new NOT NULL column that has a default', async () => {
    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT' },
        { name: 'active', type: 'INTEGER', nullable: false, default: '1' },
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.destructive, []);
    assert.deepEqual(diff.safe, ['ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1;']);
  });

  it('emits CREATE INDEX (safe) for an entity index missing from the DB', async () => {
    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT' },
      ],
      indexes: [{ name: 'idx_users_email', columns: ['email'], unique: true }],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.destructive, []);
    assert.deepEqual(diff.safe, ['CREATE UNIQUE INDEX idx_users_email ON users (email);']);
  });
});

// ─── 3. Destructive changes ─────────────────────────────────────────────────────

describe('MigrationDiffer — destructive changes', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('emits DROP COLUMN for a live column absent from the entity', async () => {
    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        // email omitted → must be dropped
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.safe, []);
    assert.deepEqual(diff.destructive, ['ALTER TABLE users DROP COLUMN email;']);
  });

  it('emits a NOT NULL ADD COLUMN without default as destructive', async () => {
    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT' },
        { name: 'tenant_id', type: 'INTEGER', nullable: false }, // new, NOT NULL, no default
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.safe, []);
    assert.deepEqual(diff.destructive, ['ALTER TABLE users ADD COLUMN tenant_id INTEGER NOT NULL;']);
  });

  it('emits an ALTER COLUMN TYPE for a column type change (narrowing)', async () => {
    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'INTEGER' }, // was TEXT in DB
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.safe, []);
    assert.deepEqual(diff.destructive, ['ALTER TABLE users ALTER COLUMN email TYPE INTEGER;']);
  });

  it('emits DROP TABLE for a live table not represented by any entity', async () => {
    await pool.query('CREATE TABLE legacy_audit (id INTEGER PRIMARY KEY, note TEXT)');

    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT' },
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.safe, []);
    assert.deepEqual(diff.destructive, ['DROP TABLE legacy_audit;']);
  });

  it('never proposes dropping framework-managed tables', async () => {
    await pool.query('CREATE TABLE street_migrations (id INTEGER PRIMARY KEY, name TEXT)');

    const users = makeEntity({
      table: 'users',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT' },
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [users]);
    assert.deepEqual(diff.destructive, []);
    assert.deepEqual(diff.safe, []);
  });
});

// ─── 4. Type synonyms do not produce false positives ───────────────────────────

describe('MigrationDiffer — type equivalence', () => {
  let pool: SqlitePool;
  beforeEach(async () => {
    pool = new SqlitePool({ filePath: ':memory:' });
    await pool.query('CREATE TABLE widgets (id INTEGER PRIMARY KEY, label VARCHAR(255))');
  });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('treats VARCHAR(255) and "character varying" as equivalent (no diff)', async () => {
    const widgets = makeEntity({
      table: 'widgets',
      columns: [
        { name: 'id', type: 'INTEGER' },
        { name: 'label', type: 'CHARACTER VARYING(255)' },
      ],
    });

    const diff = await MigrationDiffer.diff(pool, [widgets]);
    assert.deepEqual(diff.safe, []);
    assert.deepEqual(diff.destructive, []);
  });
});

// ─── 5. Identifier safety ───────────────────────────────────────────────────────

describe('MigrationDiffer — SQL injection defense', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('rejects an entity table name containing unsafe characters', async () => {
    const evil = makeEntity({
      table: 'users; DROP TABLE users;--',
      columns: [{ name: 'id', type: 'INTEGER' }],
    });

    await assert.rejects(
      () => MigrationDiffer.diff(pool, [evil]),
      /Unsafe table name/,
    );
  });

  it('rejects an entity column name containing unsafe characters', async () => {
    const evil = makeEntity({
      table: 'posts',
      columns: [{ name: 'id) ; DROP TABLE users; --', type: 'INTEGER' }],
    });

    await assert.rejects(
      () => MigrationDiffer.diff(pool, [evil]),
      /Unsafe column name/,
    );
  });
});

// ─── 6. Classification invariant (deterministic property sweep) ─────────────────
//
// For a baseline table, applying any subset of additive changes (new nullable
// columns, indexes, new tables) must NEVER produce a destructive statement.
// This is a universal property exercised over many generated entity shapes
// using only node:test (zero external libraries).

describe('MigrationDiffer — additive-only invariant', () => {
  let pool: SqlitePool;
  beforeEach(async () => { pool = await makePool(); });
  afterEach(async () => {
    SchemaInspector.invalidateCache(pool);
    await pool.close();
  });

  it('additive-only entity definitions never yield destructive statements', async () => {
    const baseCols: EntityColumnMeta[] = [
      { name: 'id', type: 'INTEGER' },
      { name: 'name', type: 'TEXT', nullable: false },
      { name: 'email', type: 'TEXT' },
    ];

    // Generate 24 deterministic additive variations.
    for (let i = 0; i < 24; i++) {
      const extraNullable = Array.from({ length: i % 5 }, (_, k) => ({
        name: `extra_${i}_${k}`,
        type: 'TEXT',
      } as EntityColumnMeta));
      const extraDefaulted = (i % 2 === 0)
        ? [{ name: `flag_${i}`, type: 'INTEGER', nullable: false, default: '0' } as EntityColumnMeta]
        : [];
      const indexes: EntityIndexMeta[] = (i % 3 === 0)
        ? [{ name: `idx_${i}`, columns: ['email'], unique: i % 2 === 0 }]
        : [];

      const users = makeEntity({
        table: 'users',
        columns: [...baseCols, ...extraNullable, ...extraDefaulted],
        indexes,
      });

      const diff = await MigrationDiffer.diff(pool, [users]);
      assert.deepEqual(
        diff.destructive, [],
        `iteration ${i} unexpectedly produced destructive statements: ${diff.destructive.join(' | ')}`,
      );
      SchemaInspector.invalidateCache(pool);
    }
  });
});
