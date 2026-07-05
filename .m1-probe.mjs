// Probe: does StreetMigrationRunner work against SqlitePool? Determines whether
// M-1 (SQLite migrate support) is fixable by branching the CLI, or whether the
// core runner is PostgreSQL-only.
import { SqlitePool, StreetMigrationRunner } from 'streetjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'm1-'));
fs.writeFileSync(path.join(dir, '20240101_init.sql'),
  'CREATE TABLE IF NOT EXISTS items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');

try {
  const pool = new SqlitePool({ filePath: ':memory:' });
  if (typeof pool.initialize === 'function') await pool.initialize();
  console.log('SqlitePool constructed. methods:', ['query','initialize','close','transaction'].filter(m => typeof pool[m] === 'function').join(','));
  const runner = new StreetMigrationRunner(pool);
  await runner.run(dir);
  console.log('RESULT: StreetMigrationRunner.run() SUCCEEDED against SqlitePool');
  if (typeof pool.close === 'function') await pool.close();
} catch (e) {
  console.log('RESULT: FAILED against SqlitePool ->', e.message);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
