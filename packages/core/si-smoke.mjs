import { SchemaInspector } from './dist/database/schema-inspector.js';
import { SqlitePool } from './dist/database/sqlite/pool.js';
const pool = new SqlitePool({ filePath: ':memory:' });
await pool.query('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
const schema = await SchemaInspector.inspect(pool);
console.log('OK', JSON.stringify({ tables: schema.tables.map((t) => t.name), pk: schema.tables[0].primaryKey, cols: schema.tables[0].columns.length }));
await pool.close();
