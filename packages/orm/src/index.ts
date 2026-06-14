// packages/orm/src/index.ts
// @streetjs/orm — first-party ORM for StreetJS (RFC 0001).
//
// Decorators + a validated entity registry + a safe, parameterized query planner
// + a relation-aware repository with eager (batched, N+1-safe) and lazy loading.
// Status: 0.x preview. Model-driven migration generation is the next milestone.

export {
  Entity, Column, PrimaryKey, HasMany, HasOne, BelongsTo, ManyToMany,
  EntityRegistry, OrmError, isSafeIdentifier, isSafeSqlType,
} from './metadata.js';
export type {
  Ctor, RelationKind, ColumnMeta, RelationMeta, EntityMeta,
} from './metadata.js';

export { buildSelect, buildRelationLoad } from './dialect.js';
export type { SqlQuery } from './dialect.js';

export { planMigration, introspectSchema } from './migrations.js';
export type { ExistingSchema, MigrationPlan, MigrationOptions } from './migrations.js';

export { Repository } from './repository.js';
export type { QueryablePool, FindOptions, WithSpec } from './repository.js';

export { Orm } from './orm.js';
export type { OrmOptions } from './orm.js';
