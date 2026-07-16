/**
 * @streetjs/migrations — the StreetJS SQL migration runner and schema differ.
 *
 * `StreetMigrationRunner` applies ordered, idempotent, transactional `.sql`
 * migrations from a directory (tracked in a `street_migrations` table) and can
 * roll them back. `MigrationDiffer` compares the live database schema (via
 * `@streetjs/schema-inspector`) against entity metadata and reports safe
 * (additive) vs. destructive DDL. Public API only.
 *
 * ```ts
 * import { StreetMigrationRunner, MigrationDiffer } from '@streetjs/migrations';
 *
 * await new StreetMigrationRunner(pool).run('./migrations');
 * const { safe, destructive } = await MigrationDiffer.diff(pool, [User, Post]);
 * ```
 *
 * > This is the standalone home of the migration tooling that also backs the
 * > `streetjs` framework; the framework re-exports it, so there is a single
 * > implementation.
 */

export { StreetMigrationRunner, MigrationDiffer } from './migrations.js';
export type {
  MigrationDiff,
  EntityColumnMeta,
  EntityIndexMeta,
} from './migrations.js';
