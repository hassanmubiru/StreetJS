# @streetjs/repository

The StreetJS generic PostgreSQL repository: a typed CRUD base class over
[`@streetjs/pool`](https://www.npmjs.com/package/@streetjs/pool) with safe
identifier validation, pagination, streaming, transactions, and **optional
transparent field-level encryption**. Plus `LedgerTransactionService` for
running a sequence of operations atomically. ESM, strict-TypeScript.

This is the standalone home of the repository that also backs the
`streetjs/repository` subpath. The `streetjs` framework re-exports this package,
so there is a single source of truth.

## Install

```bash
npm install @streetjs/repository @streetjs/pool
```

## Usage

```ts
import { StreetPostgresRepository } from '@streetjs/repository';

interface User { id: string; name: string; email: string }

class UserRepository extends StreetPostgresRepository<User> {
  protected readonly tableName = 'users';
  protected mapRow(row: Record<string, string | null>): User {
    return { id: row.id!, name: row.name!, email: row.email! };
  }
}

const users = new UserRepository(pool); // a PgPool

await users.create({ id: '1', name: 'Ada', email: 'ada@x.dev' });
await users.findById('1');
await users.findAll(20, 0);      // limit clamped to [1, 1000], offset floored at 0
await users.update('1', { name: 'Ada L.' });
await users.count();
await users.delete('1');
```

Subclasses provide a `tableName` and a `mapRow` that turns a raw row into your
entity. All queries are parameterized; the table name is validated against
`^[a-zA-Z_][a-zA-Z0-9_.]*$` on first use to prevent SQL injection through a
mis-declared subclass.

## Transactions & streaming

```ts
// Run arbitrary work on a single connection in a transaction:
await users.withTransaction(async (conn) => {
  await conn.query('UPDATE users SET name = $1 WHERE id = $2', ['Neo', '1']);
});

// Stream a large result set with backpressure:
const stream = await users.streamAll('SELECT * FROM users');
```

`LedgerTransactionService` runs a list of operations and an optional success
callback atomically:

```ts
import { LedgerTransactionService } from '@streetjs/repository';

await new LedgerTransactionService(pool).execute(
  [
    (conn) => conn.query('INSERT INTO ledger ...'),
    (conn) => conn.query('UPDATE balances ...'),
  ],
  async () => 'committed',
);
```

## Transparent field-level encryption

Set `encryptor` and `encryptedEntity` on a subclass to automatically encrypt
`@Encrypt()`-annotated fields on write and decrypt them on read. The `encryptor`
is any object satisfying the `FieldEncryptor` interface
(`encryptEntity`/`decryptEntity`) — the framework's data-policy `FieldEncryptor`
qualifies:

```ts
class SecureUserRepo extends StreetPostgresRepository<User> {
  protected readonly tableName = 'users';
  protected readonly encryptor = myFieldEncryptor;
  protected readonly encryptedEntity = User;
  protected mapRow(row) { /* ... */ }
}
```

## API

| Member | Description |
| ------ | ----------- |
| `findById(id)` | Row by id, or `null`. |
| `findAll(limit?, offset?)` | Paginated rows (`ORDER BY created_at DESC`). |
| `create(data)` | Insert non-`undefined` fields, return the row. |
| `update(id, data)` | Patch fields; empty patch is a no-op read. |
| `delete(id)` | `true` if a row was deleted. |
| `count()` | Row count. |
| `withTransaction(fn)` | Run `fn(conn)` in a transaction. |
| `streamAll(sql, params?)` | Stream rows (non-parameterized only, for now). |

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/repository
```

## License

MIT — see [LICENSE](./LICENSE).
