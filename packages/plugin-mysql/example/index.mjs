// Runnable example for @streetjs/plugin-mysql.
// Prereq: MySQL/MariaDB on 127.0.0.1:3306 (native-password user). Then: node example/index.mjs

import { MysqlPool } from 'streetjs';

const mysql = new MysqlPool({
  host: '127.0.0.1', port: 3306,
  user: process.env.MYSQL_USER ?? 'streetnat',
  password: process.env.MYSQL_PASSWORD ?? 'natpass',
  database: process.env.MYSQL_DATABASE ?? 'street_test',
});

const r = await mysql.query('SELECT 1 AS ok', []);
console.log('query result:', r.rows[0]);

await mysql.close();
console.log('done');
