/**
 * @streetjs/repository — the StreetJS generic PostgreSQL repository.
 *
 * `StreetPostgresRepository<T>` is a typed CRUD base class over `@streetjs/pool`
 * with safe identifier validation, pagination, streaming, transactions, and
 * optional transparent field-level encryption. `LedgerTransactionService` runs a
 * sequence of operations atomically. Public API only.
 *
 * ```ts
 * import { StreetPostgresRepository } from '@streetjs/repository';
 *
 * class UserRepository extends StreetPostgresRepository<User> {
 *   protected readonly tableName = 'users';
 *   protected mapRow(row): User { return { id: row.id!, name: row.name! }; }
 * }
 * const users = new UserRepository(pool);
 * await users.findById('42');
 * ```
 *
 * > This is the standalone home of the repository that also backs the
 * > `streetjs/repository` subpath; the `streetjs` framework re-exports it, so
 * > there is a single implementation.
 */

export {
  StreetPostgresRepository,
  LedgerTransactionService,
} from './repository.js';
export type { IRepository, FieldEncryptor } from './repository.js';
