// packages/orm/src/orm.ts
// The Orm entry point: builds the validated entity registry and hands out
// relation-aware repositories bound to a pool.

import { EntityRegistry, type Ctor } from './metadata.js';
import { Repository, type QueryablePool } from './repository.js';
import { planMigration, introspectSchema, type MigrationPlan, type MigrationOptions } from './migrations.js';

export interface OrmOptions {
  pool: QueryablePool;
  entities: Ctor[];
}

export class Orm {
  readonly registry: EntityRegistry;
  private readonly pool: QueryablePool;
  private readonly repos = new Map<Ctor, Repository<object>>();

  constructor(opts: OrmOptions) {
    this.pool = opts.pool;
    this.registry = new EntityRegistry(opts.entities);
  }

  getRepository<T extends object>(ctor: new (...args: never[]) => T): Repository<T> {
    const key = ctor as unknown as Ctor;
    let repo = this.repos.get(key);
    if (!repo) {
      repo = new Repository<object>(this.registry, this.registry.get(key), this.pool);
      this.repos.set(key, repo);
    }
    return repo as unknown as Repository<T>;
  }

  /**
   * Generate a model-driven migration for one entity by diffing its metadata
   * against the live database schema. Returns up/down SQL; does not apply it.
   */
  async makeMigration(ctor: new (...args: never[]) => object, opts: MigrationOptions = {}): Promise<MigrationPlan> {
    const meta = this.registry.get(ctor as unknown as Ctor);
    const existing = await introspectSchema(this.pool, meta.table);
    return planMigration(meta, existing, opts);
  }
}
