import 'reflect-metadata';
import { StreetMigrationRunner, MigrationDiffer } from './dist/database/migrations.js';
import { SqlitePool } from './dist/database/sqlite/pool.js';

console.log('runner', typeof StreetMigrationRunner, 'differ', typeof MigrationDiffer.diff);

const pool = new SqlitePool({ filePath: ':memory:' });
await pool.query('CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)');

class Post {}
Reflect.defineMetadata('street:table', 'posts', Post);
Reflect.defineMetadata('street:columns', [{ name: 'id', type: 'INTEGER', nullable: false }], Post);
Reflect.defineMetadata('street:primaryKey', ['id'], Post);

const diff = await MigrationDiffer.diff(pool, [Post]);
console.log('OK safe:', JSON.stringify(diff.safe), 'destructive:', JSON.stringify(diff.destructive));
await pool.close();
