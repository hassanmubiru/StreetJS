// Forensic repro F-1b: reproduce the SUITE ordering — a failing query
// immediately followed by a queryStream on the SAME connection, in a loop.
import { PgConnection } from './dist/src/database/wire.js';

let uncaught = 0;
process.on('uncaughtException', (e) => { uncaught++; console.log(`UNCAUGHT at iter ~unknown: ${e.message}`); });

const conn = await PgConnection.connect({
  host: '127.0.0.1', port: 55432, user: 'street', password: 'street_secret', database: 'street_test', connectTimeoutMs: 10000,
});

let empty = 0, ok = 0, other = 0;
const N = 300;
for (let i = 0; i < N; i++) {
  // 1) trigger an error (like "handles SQL errors gracefully")
  try { await conn.query('SELECT * FROM table_that_does_not_exist_xyz'); } catch { /* expected */ }
  // 2) immediately stream (like "executes streaming query row by row")
  const stream = conn.queryStream('SELECT generate_series(1,3) AS n');
  const rows = [];
  await new Promise((resolve, reject) => {
    const guard = setTimeout(() => resolve(), 1000); // detect hang
    stream.on('data', (r) => rows.push(r['n']));
    stream.on('end', () => { clearTimeout(guard); resolve(); });
    stream.on('error', () => { clearTimeout(guard); resolve(); });
  });
  if (i % 50 === 0) console.log(`  ...iter ${i} ok=${ok} empty=${empty} uncaught=${uncaught}`);
  if (rows.length === 3) ok++;
  else if (rows.length === 0) empty++;
  else other++;
}
console.log(`error-then-stream loop: N=${N} ok=${ok} empty=${empty} other=${other} uncaught=${uncaught}`);
await conn.close();
