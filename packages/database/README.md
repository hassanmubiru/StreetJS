# @streetjs/database

The StreetJS **database meta-package**: a single import that re-exports the whole
StreetJS data layer. Use it when you want one dependency instead of five; depend
on the individual packages directly when you want a narrower surface.

This package contains **no logic of its own** — it is a stable aggregate entry
point over:

| Re-exported package | What it provides |
| ------------------- | ---------------- |
| [`@streetjs/postgres`](https://www.npmjs.com/package/@streetjs/postgres) | Dependency-free PostgreSQL wire driver (SCRAM auth, extended query protocol, streaming) + HA client. |
| [`@streetjs/pool`](https://www.npmjs.com/package/@streetjs/pool) | Bounded connection pool with backpressure, health checks, transactions. |
| [`@streetjs/schema-inspector`](https://www.npmjs.com/package/@streetjs/schema-inspector) | Unified PG/MySQL/SQLite schema introspection. |
| [`@streetjs/migrations`](https://www.npmjs.com/package/@streetjs/migrations) | Transactional SQL migration runner + entity/DB schema differ. |
| [`@streetjs/repository`](https://www.npmjs.com/package/@streetjs/repository) | Generic typed CRUD repository + ledger transactions. |

## Install

```bash
npm install @streetjs/database
```

The five underlying packages come along as dependencies — no need to install
them separately.

## Usage

```ts
import {
  PgPool,
  StreetPostgresRepository,
  SchemaInspector,
  StreetMigrationRunner,
} from '@streetjs/database';

const pool = new PgPool({ host, port: 5432, user, password, database });

class UserRepository extends StreetPostgresRepository<User> {
  protected readonly tableName = 'users';
  protected mapRow(row) { return { id: row.id!, name: row.name! }; }
}

await new StreetMigrationRunner(pool).run('./migrations');
const schema = await SchemaInspector.inspect(pool);
const users = await new UserRepository(pool).findAll(20, 0);
```

Every public export of the five packages — `PgConnection`, `PgPool`,
`PgHaClient`, `SchemaInspector`, `StreetMigrationRunner`, `MigrationDiffer`,
`StreetPostgresRepository`, `LedgerTransactionService`, the low-level wire
builders, and all their types — is available directly from `@streetjs/database`.

## When to use the individual packages instead

Prefer depending on a single package (e.g. just `@streetjs/pool`) when you don't
need the whole layer — it keeps your dependency graph and install size smaller.
`@streetjs/database` is purely a convenience aggregate; it pulls in all five.

## Relationship to the `streetjs/database` subpath

The `streetjs` framework's `streetjs/database` subpath resolves to the wire
driver (`@streetjs/postgres`). This package is the broader aggregate of the
entire data layer under one name.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/database
```

## License

MIT — see [LICENSE](./LICENSE).
