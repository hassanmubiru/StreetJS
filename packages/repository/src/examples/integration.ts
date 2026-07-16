/**
 * @streetjs/repository — runnable integration example.
 *
 * Defines a concrete repository over an in-memory fake pool (no live database)
 * and exercises CRUD plus the ACID ledger service. In a real app you pass a
 * `PgPool` from `@streetjs/pool`.
 *
 * Run with: `npm run example -w packages/repository`
 */

import { StreetPostgresRepository, LedgerTransactionService } from '../index.js';
import type { PgPool } from '@streetjs/pool';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`example assertion failed: ${msg}`);
}

interface Row {
  rows: Record<string, string | null>[];
  rowCount: number;
  command: string;
}

// A tiny in-memory table backing a fake pool that understands enough SQL for
// the example. Not part of the public API — production code uses a real PgPool.
class InMemoryPool {
  private store = new Map<string, { id: string; name: string }>();
  private seq = 0;

  async query(sql: string, params: unknown[] = []): Promise<Row> {
    if (/^INSERT/.test(sql)) {
      const [id, name] = params as string[];
      this.store.set(id!, { id: id!, name: name! });
      return { rows: [{ id: id!, name: name! }], rowCount: 1, command: 'INSERT' };
    }
    if (/^SELECT \* FROM users WHERE id/.test(sql)) {
      const found = this.store.get(params[0] as string);
      return { rows: found ? [found] : [], rowCount: found ? 1 : 0, command: 'SELECT' };
    }
    if (/^SELECT COUNT/.test(sql)) {
      return { rows: [{ total: String(this.store.size) }], rowCount: 1, command: 'SELECT' };
    }
    if (/^UPDATE/.test(sql)) {
      const id = params[params.length - 1] as string;
      const existing = this.store.get(id);
      if (!existing) return { rows: [], rowCount: 0, command: 'UPDATE' };
      const updated = { ...existing, name: params[0] as string };
      this.store.set(id, updated);
      return { rows: [updated], rowCount: 1, command: 'UPDATE' };
    }
    if (/^DELETE/.test(sql)) {
      const existed = this.store.delete(params[0] as string);
      return { rows: [], rowCount: existed ? 1 : 0, command: 'DELETE' };
    }
    if (/^SELECT \* FROM users ORDER BY/.test(sql)) {
      return { rows: [...this.store.values()], rowCount: this.store.size, command: 'SELECT' };
    }
    return { rows: [], rowCount: 0, command: 'SELECT' };
  }

  async transaction<T>(fn: (conn: unknown) => Promise<T>): Promise<T> {
    return fn(this);
  }

  nextId(): string { return String(++this.seq); }
}

interface User { id: string; name: string }

class UserRepository extends StreetPostgresRepository<User> {
  protected readonly tableName = 'users';
  protected mapRow(row: Record<string, string | null>): User {
    return { id: row['id'] ?? '', name: row['name'] ?? '' };
  }
}

const pool = new InMemoryPool();
const users = new UserRepository(pool as unknown as PgPool);

const created = await users.create({ id: pool.nextId(), name: 'Ada' });
console.log('created:', created);
assert(created.name === 'Ada', 'create returns the row');

const fetched = await users.findById(created.id);
assert(fetched?.name === 'Ada', 'findById round-trips');

const updated = await users.update(created.id, { name: 'Ada Lovelace' });
assert(updated?.name === 'Ada Lovelace', 'update changes the name');
console.log('updated:', updated);

assert((await users.count()) === 1, 'count reflects one row');

const ledger = new LedgerTransactionService(pool as unknown as PgPool);
let ledgerRan = false;
await ledger.execute([async () => { ledgerRan = true; }], async () => 'committed');
assert(ledgerRan, 'ledger operations ran');

assert((await users.delete(created.id)) === true, 'delete succeeds');
assert((await users.findById(created.id)) === null, 'row is gone after delete');

console.log('\nAll @streetjs/repository example assertions passed.');
