// SQLite lifecycle + transaction probe (in-memory/file via worker_threads).
import { SqlitePool } from 'streetjs';

const pool = new SqlitePool({ filePath: ':memory:' });

const ping = await pool.query('SELECT 1 AS one');
console.log('query:', Number(ping.rows[0].one) === 1 ? 'OK' : 'FAIL');

await pool.query('CREATE TABLE IF NOT EXISTS probe (id INTEGER PRIMARY KEY, v INTEGER)');

const committed = await pool.transaction(async (q) => {
  await q('INSERT INTO probe (v) VALUES (?)', [42]);
  return q('SELECT v FROM probe');
});
console.log('transaction-commit:', Number(committed.rows[0]?.v) === 42 ? 'OK' : 'FAIL');

let rolledBack = false;
try {
  await pool.transaction(async (q) => { await q('INSERT INTO probe (v) VALUES (99)'); throw new Error('x'); });
} catch { rolledBack = true; }
const after = await pool.query('SELECT COUNT(*) AS n FROM probe');
console.log('rollback-safety:', rolledBack && Number(after.rows[0].n) === 1 ? 'OK' : 'FAIL');

await pool.close();
console.log('close: OK');
process.exit(0);
