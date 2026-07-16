/**
 * @streetjs/migrations — runnable integration example.
 *
 * Demonstrates the schema differ (safe vs. destructive DDL) and the migration
 * runner, without a live database. The differ reads a fake "PgPool" (routed by
 * constructor name through @streetjs/schema-inspector); the runner writes real
 * .sql files to a temp directory and applies them against an in-memory fake.
 *
 * Run with: `npm run example -w packages/migrations`
 */

import 'reflect-metadata';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MigrationDiffer, StreetMigrationRunner } from '../index.js';
import type { PgPool as RealPgPool } from '@streetjs/pool';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}
function result(rows: Record<string, string | null>[]) {
  return { rows, rowCount: rows.length, command: 'SELECT' };
}

// ── 1. Schema diff ───────────────────────────────────────────────────────────
// A fake PgPool reporting an empty database, so the differ proposes CREATE TABLE.
class PgPool {
  async query(sql: string) {
    if (/pg_indexes|referential_constraints/i.test(sql)) return result([]);
    return result([]); // no columns → no tables
  }
}

class User {}
Reflect.defineMetadata('street:table', 'users', User);
Reflect.defineMetadata('street:columns', [
  { name: 'id', type: 'INTEGER', nullable: false },
  { name: 'email', type: 'TEXT', nullable: false },
], User);
Reflect.defineMetadata('street:primaryKey', ['id'], User);
Reflect.defineMetadata('street:indexes', [{ name: 'idx_users_email', columns: ['email'], unique: true }], User);

const diff = await MigrationDiffer.diff(new PgPool(), [User]);
console.log('safe DDL:');
for (const s of diff.safe) console.log('  ' + s);
assert(diff.destructive.length === 0, 'creating a new schema is non-destructive');
assert(diff.safe.some((s) => /CREATE TABLE users/.test(s)), 'CREATE TABLE proposed');

// ── 2. Migration runner ──────────────────────────────────────────────────────
const applied = new Set<string>();
const conn = {
  async query(sql: string, params?: unknown[]) {
    if (sql.includes('INSERT') && typeof params?.[0] === 'string') applied.add(params[0]);
    return result([]);
  },
};
const runnerPool = {
  async query(sql: string) {
    if (/SELECT name FROM street_migrations/.test(sql)) {
      return result([...applied].map((name) => ({ name })));
    }
    return result([]);
  },
  async transaction<T>(fn: (c: typeof conn) => Promise<T>): Promise<T> {
    return fn(conn);
  },
};

const dir = await mkdtemp(join(tmpdir(), 'streetjs-migrations-example-'));
try {
  await writeFile(join(dir, '001_init.sql'), 'CREATE TABLE users (id int);', 'utf8');
  await writeFile(join(dir, '002_posts.sql'), 'CREATE TABLE posts (id int);', 'utf8');

  await new StreetMigrationRunner(runnerPool as unknown as RealPgPool).run(dir);
  console.log('applied migrations:', [...applied].join(', '));
  assert(applied.has('001_init.sql') && applied.has('002_posts.sql'), 'both migrations applied');

  // A second run is idempotent — nothing new to apply.
  const before = applied.size;
  await new StreetMigrationRunner(runnerPool as unknown as RealPgPool).run(dir);
  assert(applied.size === before, 'second run applies nothing new');
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('\nAll @streetjs/migrations example assertions passed.');
