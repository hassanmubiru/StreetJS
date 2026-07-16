# @streetjs/migrations

The StreetJS SQL migration runner and schema differ:

- **`StreetMigrationRunner`** — applies ordered, idempotent, **transactional**
  `.sql` migrations from a directory, tracked in a `street_migrations` table,
  with rollback support and path-traversal-safe filename handling.
- **`MigrationDiffer`** — compares your **entity metadata** against the **live
  database schema** (via `@streetjs/schema-inspector`) and reports **safe**
  (additive) vs. **destructive** DDL.

ESM, strict-TypeScript, `@Injectable`.

This is the standalone home of the migration tooling that also backs the
`streetjs` framework. The framework re-exports this package, so there is a
single source of truth.

## Install

```bash
npm install @streetjs/migrations @streetjs/pool @streetjs/schema-inspector reflect-metadata
```

## Running migrations

```ts
import { StreetMigrationRunner } from '@streetjs/migrations';

const runner = new StreetMigrationRunner(pool); // a PgPool

await runner.run('./migrations');      // apply all pending, in filename order
await runner.rollback('./migrations'); // roll back the most recent (needs *.rollback.sql)
```

- Each migration runs in a transaction and is recorded in `street_migrations`;
  already-applied files are skipped.
- Files are applied in **lexicographic order** — prefix them with a timestamp or
  zero-padded sequence (`001_init.sql`, `002_add_users.sql`, …).
- Filenames must match `^[A-Za-z0-9][A-Za-z0-9_\-.]*\.sql$`; anything with path
  separators or `..` is rejected.
- A rollback for `001_init.sql` looks for `001_init.rollback.sql`.

## Diffing entities against the database

```ts
import { MigrationDiffer } from '@streetjs/migrations';

const { safe, destructive } = await MigrationDiffer.diff(pool, [User, Post]);
// safe:        CREATE TABLE, ADD COLUMN (nullable/defaulted), CREATE INDEX
// destructive: DROP TABLE, DROP COLUMN, type changes, NOT NULL adds w/o default
```

The differ reads entity metadata from the `street:*` Reflect keys
(`street:table`, `street:columns`, `street:indexes`, `street:primaryKey`) that
the framework's `@Entity`/`@Column` decorators emit. Table names fall back to the
lowercased class name. Framework-managed tables (`street_*`, `sqlite_*`) are
never proposed for `DROP`. All identifiers, types, and defaults are validated to
prevent SQL injection through metadata.

### Safe vs. destructive

| Change | Bucket |
| ------ | ------ |
| Table missing | `safe` — `CREATE TABLE` (+ its indexes) |
| Nullable / defaulted column missing | `safe` — `ADD COLUMN` |
| `NOT NULL` column missing (no default) | `destructive` — would fail on a populated table |
| Column type change | `destructive` — `ALTER COLUMN … TYPE` |
| Column in DB, not in entity | `destructive` — `DROP COLUMN` |
| Missing index | `safe` — `CREATE INDEX` |
| Live table with no entity | `destructive` — `DROP TABLE` (except framework tables) |

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/migrations
```

## License

MIT — see [LICENSE](./LICENSE).
