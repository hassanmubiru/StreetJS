import { SqlitePool } from './dist/database/sqlite/pool.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';

const dbPath = join(tmpdir(), `concurrent-test-${Date.now()}.db`);
console.log('DB:', dbPath);

const pool = new SqlitePool({ filePath: dbPath, maxWorkers: 4 });

try {
  // Enable WAL mode for better concurrent access
  await pool.query('PRAGMA journal_mode=WAL');
  await pool.query('PRAGMA synchronous=NORMAL');
  
  // Create table and insert on one worker
  await pool.query('CREATE TABLE t (id INTEGER, val INTEGER)');
  for (let i = 0; i < 10; i++) {
    await pool.query('INSERT INTO t VALUES (?, ?)', [i, i * 2]);
  }
  
  // Ensure checkpoint before concurrent reads  
  await pool.query('PRAGMA wal_checkpoint(PASSIVE)');
  
  console.log('Setup done, now firing 8 concurrent reads');

  // Fire 8 concurrent reads
  const promises = Array.from({ length: 8 }, (_, i) =>
    pool.query('SELECT * FROM t WHERE id = ?', [i])
      .then(r => { console.log(`  id=${i}: ok, rows=${r.rows.length}`); return r; })
      .catch(e => { console.error(`  id=${i}: ERROR ${e.message}`); throw e; })
  );
  
  const results = await Promise.all(promises);
  console.log('All 8 concurrent reads succeeded');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
} finally {
  await pool.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
  // Clean up WAL files
  ['-wal', '-shm'].forEach(ext => {
    const f = dbPath + ext;
    if (existsSync(f)) unlinkSync(f);
  });
}
