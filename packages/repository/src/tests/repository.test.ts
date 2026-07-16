import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  StreetPostgresRepository,
  LedgerTransactionService,
  type FieldEncryptor,
} from '../index.js';
import type { PgPool } from '@streetjs/pool';

interface Row {
  rows: Record<string, string | null>[];
  rowCount: number;
  command: string;
}

/** A fake PgPool recording queries and returning scripted results. */
class FakePool {
  calls: { sql: string; params?: unknown[] }[] = [];
  private queue: Row[] = [];
  streamed: string[] = [];
  txRan = false;

  enqueue(...results: Row[]): this {
    this.queue.push(...results);
    return this;
  }

  async query(sql: string, params?: unknown[]): Promise<Row> {
    this.calls.push({ sql, params });
    return this.queue.shift() ?? { rows: [], rowCount: 0, command: sql.trim().split(/\s+/)[0]!.toUpperCase() };
  }

  async transaction<T>(fn: (conn: unknown) => Promise<T>): Promise<T> {
    this.txRan = true;
    return fn({ query: async () => ({ rows: [], rowCount: 0, command: 'SELECT' }) });
  }

  async stream(sql: string): Promise<unknown> {
    this.streamed.push(sql);
    return { streaming: true };
  }
}

interface User {
  id: string;
  name: string;
}

class UserRepo extends StreetPostgresRepository<User> {
  protected readonly tableName = 'users';
  protected mapRow(row: Record<string, string | null>): User {
    return { id: row['id'] ?? '', name: row['name'] ?? '' };
  }
}

function repo(pool: FakePool): UserRepo {
  return new UserRepo(pool as unknown as PgPool);
}

const rowOf = (u: User): Row => ({ rows: [{ id: u.id, name: u.name }], rowCount: 1, command: 'SELECT' });

test('findById returns a mapped row', async () => {
  const pool = new FakePool().enqueue(rowOf({ id: '1', name: 'Ada' }));
  const user = await repo(pool).findById('1');
  assert.deepEqual(user, { id: '1', name: 'Ada' });
  assert.match(pool.calls[0]!.sql, /SELECT \* FROM users WHERE id = \$1 LIMIT 1/);
  assert.deepEqual(pool.calls[0]!.params, ['1']);
});

test('findById returns null when there are no rows', async () => {
  const user = await repo(new FakePool()).findById('nope');
  assert.equal(user, null);
});

test('findAll clamps limit and offset into safe bounds', async () => {
  const pool = new FakePool().enqueue({ rows: [{ id: '1', name: 'a' }], rowCount: 1, command: 'SELECT' });
  await repo(pool).findAll(100_000, -5);
  assert.deepEqual(pool.calls[0]!.params, [1000, 0], 'limit capped at 1000, offset floored at 0');
});

test('findAll floors the minimum limit to 1', async () => {
  const pool = new FakePool().enqueue({ rows: [], rowCount: 0, command: 'SELECT' });
  await repo(pool).findAll(0, 3);
  assert.deepEqual(pool.calls[0]!.params, [1, 3]);
});

test('count parses the total', async () => {
  const pool = new FakePool().enqueue({ rows: [{ total: '42' }], rowCount: 1, command: 'SELECT' });
  assert.equal(await repo(pool).count(), 42);
});

test('count defaults to 0 when no row is returned', async () => {
  assert.equal(await repo(new FakePool()).count(), 0);
});

test('create inserts non-undefined fields and returns the mapped row', async () => {
  const pool = new FakePool().enqueue(rowOf({ id: '7', name: 'Grace' }));
  const created = await repo(pool).create({ id: '7', name: 'Grace', extra: undefined } as Partial<User>);
  assert.deepEqual(created, { id: '7', name: 'Grace' });
  assert.match(pool.calls[0]!.sql, /INSERT INTO users \("id", "name"\) VALUES \(\$1, \$2\) RETURNING \*/);
});

test('create throws when the insert returns no row', async () => {
  const pool = new FakePool().enqueue({ rows: [], rowCount: 0, command: 'INSERT' });
  await assert.rejects(() => repo(pool).create({ id: '1', name: 'x' }), /Insert returned no rows/);
});

test('update with no fields falls back to findById', async () => {
  const pool = new FakePool().enqueue(rowOf({ id: '1', name: 'Ada' }));
  const user = await repo(pool).update('1', {});
  assert.deepEqual(user, { id: '1', name: 'Ada' });
  assert.match(pool.calls[0]!.sql, /SELECT \* FROM users WHERE id = \$1/);
});

test('update builds a SET clause with the id as the final parameter', async () => {
  const pool = new FakePool().enqueue(rowOf({ id: '1', name: 'Neo' }));
  const user = await repo(pool).update('1', { name: 'Neo' });
  assert.deepEqual(user, { id: '1', name: 'Neo' });
  assert.match(pool.calls[0]!.sql, /UPDATE users SET "name" = \$1 WHERE id = \$2 RETURNING \*/);
  assert.deepEqual(pool.calls[0]!.params, ['Neo', '1']);
});

test('update returns null when the row does not exist', async () => {
  const pool = new FakePool().enqueue({ rows: [], rowCount: 0, command: 'UPDATE' });
  assert.equal(await repo(pool).update('404', { name: 'x' }), null);
});

test('delete returns true on a successful DELETE', async () => {
  const pool = new FakePool().enqueue({ rows: [], rowCount: 1, command: 'DELETE' });
  assert.equal(await repo(pool).delete('1'), true);
});

test('delete returns false when nothing was deleted', async () => {
  const pool = new FakePool().enqueue({ rows: [], rowCount: 0, command: 'DELETE' });
  assert.equal(await repo(pool).delete('1'), false);
});

test('an unsafe tableName is rejected at query time', async () => {
  class BadRepo extends StreetPostgresRepository<User> {
    protected readonly tableName = 'users; DROP TABLE users';
    protected mapRow(): User { return { id: '', name: '' }; }
  }
  const bad = new BadRepo(new FakePool() as unknown as PgPool);
  await assert.rejects(() => bad.findById('1'), /unsafe characters/);
});

test('transparent encryption wraps create and decryption wraps reads', async () => {
  const seen: string[] = [];
  const encryptor: FieldEncryptor = {
    encryptEntity(_c, obj) { seen.push('encrypt'); return { ...obj, name: `enc(${obj['name']})` }; },
    decryptEntity(_c, obj) { seen.push('decrypt'); return { ...obj, name: String(obj['name']).replace(/^enc\((.*)\)$/, '$1') }; },
  };
  class Secret {}
  class EncRepo extends StreetPostgresRepository<User> {
    protected readonly tableName = 'users';
    protected override readonly encryptor = encryptor;
    protected override readonly encryptedEntity = Secret;
    protected mapRow(row: Record<string, string | null>): User {
      return { id: row['id'] ?? '', name: row['name'] ?? '' };
    }
  }
  // create: the INSERT should carry the encrypted value; the returned row is decrypted.
  const pool = new FakePool().enqueue({ rows: [{ id: '1', name: 'enc(Ada)' }], rowCount: 1, command: 'SELECT' });
  const created = await new EncRepo(pool as unknown as PgPool).create({ id: '1', name: 'Ada' });
  assert.deepEqual(pool.calls[0]!.params, ['1', 'enc(Ada)'], 'value encrypted before insert');
  assert.equal(created.name, 'Ada', 'value decrypted on the way out');
  assert.deepEqual(seen, ['encrypt', 'decrypt']);
});

test('streamAll rejects parameterized queries and otherwise delegates to pool.stream', async () => {
  const pool = new FakePool();
  const r = repo(pool);
  // streamAll throws synchronously for parameterized queries (it is not async).
  assert.throws(() => r.streamAll('SELECT $1', ['x']), /does not yet support parameterized/);
  await r.streamAll('SELECT * FROM users');
  assert.deepEqual(pool.streamed, ['SELECT * FROM users']);
});

test('withTransaction delegates to the pool transaction', async () => {
  const pool = new FakePool();
  await repo(pool).withTransaction(async () => 'ok');
  assert.equal(pool.txRan, true);
});

test('LedgerTransactionService runs all operations then onSuccess inside a transaction', async () => {
  const pool = new FakePool();
  const order: string[] = [];
  const out = await new LedgerTransactionService(pool as unknown as PgPool).execute(
    [
      async () => { order.push('op1'); },
      async () => { order.push('op2'); },
    ],
    async () => { order.push('success'); return 'done'; },
  );
  assert.equal(pool.txRan, true);
  assert.deepEqual(order, ['op1', 'op2', 'success']);
  assert.equal(out, 'done');
});

test('LedgerTransactionService without onSuccess resolves to undefined', async () => {
  const pool = new FakePool();
  const out = await new LedgerTransactionService(pool as unknown as PgPool).execute([async () => {}]);
  assert.equal(out, undefined);
});
