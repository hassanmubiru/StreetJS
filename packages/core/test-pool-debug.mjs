import { SqlitePool } from './dist/database/sqlite/pool.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlinkSync, existsSync } from 'node:fs';

const dbPath = join(tmpdir(), `street-test-${Date.now()}.db`);
console.log('DB:', dbPath);

const pool = new SqlitePool({ filePath: dbPath, maxWorkers: 2 });

try {
  // Create table
  const r1 = await pool.query('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
  console.log('CREATE:', JSON.stringify(r1));

  // Insert
  const r2 = await pool.query("INSERT INTO users VALUES (1, 'Alice')");
  console.log('INSERT:', JSON.stringify(r2));

  // Insert with params
  const r3 = await pool.query("INSERT INTO users VALUES (?, ?)", [2, 'Bob']);
  console.log('INSERT_PARAM:', JSON.stringify(r3));

  // Select
  const r4 = await pool.query('SELECT * FROM users ORDER BY id');
  console.log('SELECT:', JSON.stringify(r4));

  console.log('\nBasic test PASSED');
} catch (e) {
  console.error('FAILED:', e.message, e.stack);
  process.exit(1);
} finally {
  await pool.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
}
