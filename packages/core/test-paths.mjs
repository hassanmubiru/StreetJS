import { SqlitePool } from './dist/database/sqlite/pool.js';
import { mkdtempSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Test 1: flat temp file (like test-pool-debug.mjs does)
const flatPath = join(tmpdir(), `flat-test-${Date.now()}.db`);
console.log('Test 1 - flat path:', flatPath);
try {
  const pool = new SqlitePool({ filePath: flatPath, maxWorkers: 1 });
  const r = await pool.query('SELECT 1 AS n');
  console.log('Flat path OK:', r.rows[0]);
  await pool.close();
} catch (e) {
  console.error('Flat path FAILED:', e.message);
}

// Test 2: nested in subdirectory
const dir = mkdtempSync(join(tmpdir(), 'nested-test-'));
const nestedPath = join(dir, 'test.db');
console.log('Test 2 - nested path:', nestedPath);
console.log('Dir exists:', existsSync(dir));
try {
  const pool = new SqlitePool({ filePath: nestedPath, maxWorkers: 1 });
  const r = await pool.query('SELECT 1 AS n');
  console.log('Nested path OK:', r.rows[0]);
  await pool.close();
} catch (e) {
  console.error('Nested path FAILED:', e.message);
}

// Test 3: SQLite WAL mode and the path
console.log('Done');
