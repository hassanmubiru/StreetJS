// MySQL connection-lifecycle + transaction + cleanup probe against the live
// street_test_mysql container (host :3306). Uses the native driver from streetjs.
import { MysqlPool } from 'streetjs';

const pool = new MysqlPool({
  host: process.env.MYSQL_HOST ?? '127.0.0.1',
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? 'root',
  password: process.env.MYSQL_PASSWORD ?? 'testpass',
  database: process.env.MYSQL_DATABASE ?? 'street_test',
  minConnections: 2, maxConnections: 5,
});

function openSockets() {
  return process._getActiveHandles().filter((h) => h?.constructor?.name === 'Socket').length;
}

const ping = await pool.query('SELECT 1 AS one');
console.log('query:', Number(ping.rows[0].one) === 1 ? 'OK' : 'FAIL');

await pool.query('CREATE TABLE IF NOT EXISTS _audit_probe (id INT AUTO_INCREMENT PRIMARY KEY, v INT)');
await pool.query('TRUNCATE _audit_probe');

await pool.transaction(async (conn) => {
  await conn.query('INSERT INTO _audit_probe (v) VALUES (?)', [42]);
});
const committed = await pool.query('SELECT v FROM _audit_probe');
console.log('transaction-commit:', Number(committed.rows[0]?.v) === 42 ? 'OK' : 'FAIL');

let rolledBack = false;
try {
  await pool.transaction(async (conn) => {
    await conn.query('INSERT INTO _audit_probe (v) VALUES (99)');
    throw new Error('intentional');
  });
} catch { rolledBack = true; }
const after = await pool.query('SELECT COUNT(*) AS n FROM _audit_probe');
console.log('rollback-safety:', rolledBack && Number(after.rows[0].n) === 1 ? 'OK' : 'FAIL');

const before = openSockets();
await pool.query('DROP TABLE _audit_probe');
await pool.close();
await new Promise((r) => setTimeout(r, 1000));
const remaining = openSockets();
console.log(`open sockets: during=${before} after-close=${remaining}`, remaining === 0 ? 'NO-LEAK' : 'POSSIBLE-LEAK');
process.exit(0);
