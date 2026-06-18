import { SqlitePool } from 'streetjs';
const pool = new SqlitePool({ filePath: ':memory:' });
await pool.query('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)');
await pool.query('INSERT INTO items (name) VALUES (?)', ['hello']);
const r = await pool.query('SELECT * FROM items');
console.log('rows:', JSON.stringify(r.rows ?? r));
if (pool.close) await pool.close();
console.log('SQLITE SMOKE OK');
