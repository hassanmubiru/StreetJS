// create-database.test.ts
// Unit tests for `street create --database <sqlite|postgres>`: verifies the
// generated database configuration removes the old `postgres`/`postgres`
// credential assumption, defaults to zero-config SQLite, and that the PostgreSQL
// scaffold validates credentials and starts the server even when the database
// is unreachable (no immediate startup failure).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCommand } from '../commands/create.js';

function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'street-db-test-'));
  return fn(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function capture() {
  const ol = console.log, oe = console.error, ow = console.warn;
  console.log = () => {}; console.error = () => {}; console.warn = () => {};
  return () => { console.log = ol; console.error = oe; console.warn = ow; };
}

function ctx(cwd: string, positional: string[], flags: Record<string, string | boolean> = {}) {
  process.exitCode = 0;
  return { cwd, args: { command: 'create', positional, flags: { 'no-lockfile': true, ...flags } } };
}

function read(dir: string, proj: string, rel: string): string {
  return readFileSync(join(dir, proj, rel), 'utf8');
}

describe('street create --database', () => {
  it('rejects an unknown database driver', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { database: 'mongo' })); } finally { restore(); }
      assert.equal(process.exitCode, 1);
    });
  });

  it('defaults to SQLite (zero-config) with no database flag', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'])); } finally { restore(); }

      const config = read(dir, 'proj', 'street.config.ts');
      assert.ok(config.includes("dbDriver: process.env['DB_DRIVER'] ?? 'sqlite'"), 'config defaults to sqlite');
      assert.ok(config.includes('sqlitePath'), 'config exposes sqlitePath');

      const main = read(dir, 'proj', 'src/main.ts');
      assert.ok(main.includes('SqlitePool'), 'main uses SqlitePool');
      assert.ok(main.includes('CREATE TABLE IF NOT EXISTS items'), 'main bootstraps the example schema');

      const repo = read(dir, 'proj', 'src/repositories/example.repository.ts');
      assert.ok(repo.includes('SqlitePool'), 'repository uses SqlitePool');
      assert.ok(repo.includes('LIMIT ? OFFSET ?'), 'repository uses sqlite ? placeholders');
    });
  });

  it('SQLite scaffold contains NO postgres credential assumptions', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { database: 'sqlite' })); } finally { restore(); }

      const config = read(dir, 'proj', 'street.config.ts');
      const env = read(dir, 'proj', '.env.example');
      assert.ok(!config.includes("?? 'postgres'"), 'no hardcoded postgres user/password default');
      assert.ok(!env.includes('PG_USER=postgres'), '.env.example has no fake postgres user');
      assert.ok(env.includes('DB_DRIVER=sqlite'), '.env.example selects sqlite');
    });
  });

  it('postgres scaffold validates credentials and never hardcodes them', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { database: 'postgres' })); } finally { restore(); }

      const config = read(dir, 'proj', 'street.config.ts');
      assert.ok(!config.includes("?? 'postgres'"), 'no postgres/postgres credential guess');
      assert.ok(config.includes("pgUser: process.env['PG_USER']"), 'pgUser comes only from env');

      const main = read(dir, 'proj', 'src/main.ts');
      assert.ok(main.includes('PgPool'), 'main uses PgPool');
      assert.ok(main.includes('requireEnv'), 'main validates required env vars');
      // initialize() must be wrapped so a connection failure cannot crash boot.
      assert.ok(main.includes('try {') && main.includes('await pool.initialize()'), 'initialize is guarded');
      assert.ok(main.includes('will start') || main.includes('503'), 'graceful, non-fatal startup messaging');

      const repo = read(dir, 'proj', 'src/repositories/example.repository.ts');
      assert.ok(repo.includes('WHERE id = $1'), 'repository uses postgres $n placeholders');
    });
  });

  it('postgres .env.example requires credentials (no defaults baked in)', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { database: 'postgres' })); } finally { restore(); }

      const env = read(dir, 'proj', '.env.example');
      assert.ok(/^PG_USER=\s*$/m.test(env), 'PG_USER is empty (must be set by user)');
      assert.ok(/^PG_PASSWORD=\s*$/m.test(env), 'PG_PASSWORD is empty (must be set by user)');
      assert.ok(!env.includes('PG_PASSWORD=postgres'), 'no guessed password');
    });
  });

  it('missing credentials path is non-fatal: generated main keeps the server running', async () => {
    await withTempDir(async (dir) => {
      const restore = capture();
      try { await new CreateCommand().execute(ctx(dir, ['proj'], { database: 'postgres' })); } finally { restore(); }

      const main = read(dir, 'proj', 'src/main.ts');
      // When required env is missing, the app warns and continues (does not throw).
      assert.ok(main.includes('Database not configured'), 'warns on missing config');
      assert.ok(main.includes('--database sqlite'), 'suggests the zero-config alternative');
      // The only process.exit on the DB path is the top-level fatal handler, not
      // the missing-credentials branch.
      const dbSection = main.slice(main.indexOf('Database not configured'), main.indexOf('Services'));
      assert.ok(!dbSection.includes('process.exit'), 'missing-credentials branch does not exit the process');
    });
  });
});
