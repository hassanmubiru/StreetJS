<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/orm

First-party ORM for StreetJS (RFC 0001) — entity/relation decorators, a **safe
parameterized query planner**, and a relation-aware repository with **eager
(batched, N+1-safe) and lazy loading**. Built on the native `streetjs` PostgreSQL
driver; no third-party ORM.

> **Status: 0.x preview.** Relations + eager/lazy loading + querying + **model-driven
> migration generation** are implemented and tested (offline + live Postgres in CI).

## Migrations (model-driven)

```ts
// Diff entity metadata against the live schema → up/down SQL (does not apply it):
const plan = await orm.makeMigration(User);          // { up: string[], down: string[] }
for (const sql of plan.up) await pool.query(sql, []); // apply when ready
// Re-running against the updated schema yields an empty plan (idempotent).
```

`@Column`/`@PrimaryKey` accept an optional SQL type: `@Column('age', { type: 'integer' })`
(default `text` for columns, `integer` for primary keys). Types are validated as
safe tokens. By default migrations are **additive** (CREATE TABLE, ADD COLUMN);
pass `{ dropColumns: true }` to also drop columns the model no longer declares.

## Install

```bash
npm install @streetjs/orm
```

## Define entities

```ts
import 'reflect-metadata';
import { Entity, PrimaryKey, Column, HasMany, HasOne, BelongsTo, ManyToMany } from '@streetjs/orm';

@Entity('users')
class User {
  @PrimaryKey() id!: number;
  @Column() email!: string;
  @HasMany(() => Post, 'authorId') posts?: Post[];
  @HasOne(() => Profile, 'userId') profile?: Profile;
}

@Entity('posts')
class Post {
  @PrimaryKey() id!: number;
  @Column() authorId!: number;
  @Column() published!: boolean;
  @BelongsTo(() => User, 'authorId') author?: User;
  @ManyToMany(() => Tag, { through: 'post_tags', ownerKey: 'postId', targetKey: 'tagId' }) tags?: Tag[];
}
```

## Query

```ts
import { Orm } from '@streetjs/orm';
import { PgPool } from 'streetjs';

const orm = new Orm({ pool: new PgPool({ /* ... */ }), entities: [User, Post, Profile, Tag] });
const users = orm.getRepository(User);

// Eager loading — one batched query per relation (N+1-safe):
const list = await users.find({ where: { id: 1 }, with: ['posts', 'profile'] });

// Relation filtering:
const authors = await users.find({ with: { posts: { where: { published: true } } } });

// Lazy loading — fetch a relation on demand:
const u = await users.findOne({ where: { id: 1 } });
const posts = await users.loadRelation(u, 'posts');
```

## Safety

- **Every value is a positional parameter** (`$1`, `$2`, …) — never interpolated.
- **Identifiers** (table/column/FK/join names) come only from decorator metadata
  and are validated as bare-word identifiers (`isSafeIdentifier`); the planner
  re-checks before quoting. User input never reaches an identifier position.
- Filter columns are validated against the entity's registered columns.

## Supported relations

`@HasOne` (1:1) · `@HasMany` (1:N) · `@BelongsTo` (inverse) · `@ManyToMany`
(through a join table). Eager loads use a single batched `IN (...)` query per
relation; many-to-many joins the through table and groups by the owner key.

## License

MIT
