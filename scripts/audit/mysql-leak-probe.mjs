import { MysqlPool } from 'streetjs';
function snap(label) {
  const hs = process._getActiveHandles();
  const sockets = hs.filter((h) => h?.constructor?.name === 'Socket');
  console.log(`${label}: total=${hs.length} sockets=${sockets.length}`);
  return sockets.length;
}
snap('baseline');
const pool = new MysqlPool({
  host: '127.0.0.1', port: 3306, user: 'root', password: 'testpass',
  database: 'street_test', minConnections: 2, maxConnections: 5,
});
await pool.query('SELECT 1');
snap('after-query');
await pool.close();
await new Promise((r) => setTimeout(r, 2000));
const n = snap('after-close+2s');
console.log(n === 0 ? 'RESULT: NO SOCKET LEAK' : `RESULT: ${n} SOCKET(S) STILL OPEN AFTER CLOSE`);
process.exit(0);
