---
rfc: 0001
title: First-party ORM — relations, eager/lazy loading, and model-driven migrations
status: Accepted        # Draft | Proposed | FCP | Accepted | Implemented | Declined | Withdrawn
authors: ["@hassanmubiru"]
created: 2026-06-14
tracking-issue:
---

# RFC 0001 — First-party ORM (`@streetjs/orm`)

> **Implementation status (0.1.0 preview):** relations (1:1/1:N/N:M), eager
> (batched, N+1-safe) + lazy loading, relation filtering, and the safe
> parameterized query planner are **implemented and tested** — 23 offline unit
> tests + 4 live-PostgreSQL integration tests (CI: `orm-integration.yml`).
> **Model-driven migration generation remains the next milestone** (not yet
> implemented).

## Summary

Add an optional, first-party ORM layer (`@streetjs/orm`) on top of the existing
verified data primitives (`QueryBuilder`, `StreetPostgresRepository`,
`MigrationDiffer`, `schema-inspector`). It provides entity/relation decorators,
relation-aware queries (eager + lazy), and model-driven migration generation —
closing the most common head-to-head feature gap versus Prisma, TypeORM, and
Eloquent. It ships as a **separate package** so core stays minimal and stable.

## Motivation

Evidence (from the StreetJS readiness assessment and full report): the data layer
is a query-builder + repository with **no relations DSL, eager/lazy loading, or
model→migration generation**. This is repeatedly the deciding factor in framework
evaluations against Prisma/TypeORM/Eloquent. Closing it is the highest-impact
*engineering* lever on adoption (the non-engineering levers are community and
production proof, tracked separately).

Non-goals: replacing raw SQL access (still first-class), supporting every
database immediately (Postgres first; MySQL second; Mongo is document-store, out
of scope for the relational ORM).

## Guide-level explanation

```typescript
import 'reflect-metadata';
import { Entity, PrimaryKey, Column, HasMany, HasOne, BelongsTo, ManyToMany, Orm } from '@streetjs/orm';
import { PgPool } from 'streetjs';

@Entity('users')
class User {
  @PrimaryKey() id!: number;
  @Column() email!: string;
  @HasMany(() => Post, 'authorId') posts?: Post[];     // one-to-many
  @HasOne(() => Profile, 'userId') profile?: Profile;  // one-to-one
}

@Entity('posts')
class Post {
  @PrimaryKey() id!: number;
  @Column() authorId!: number;
  @Column() published!: boolean;
  @BelongsTo(() => User, 'authorId') author?: User;
  @ManyToMany(() => Tag, { through: 'post_tags' }) tags?: Tag[]; // many-to-many
}

const orm = new Orm({ pool: new PgPool({ /* ... */ }), entities: [User, Post, Tag, Profile] });
const users = orm.getRepository(User);

// Eager loading (single planned query / batched joins):
const u = await users.findOne({ where: { id: 1 }, with: ['posts', 'profile'] });

// Relation filtering:
const authors = await users.find({ with: { posts: { where: { published: true } } } });

// Lazy loading (deferred, N+1-safe via batching):
const tags = await u!.posts![0].$load('tags');
```

Model-driven migrations:

```bash
street db:make-migration add_posts   # diffs entity metadata vs live schema
street db:migrate                    # applies pending migrations (existing runner)
```

## Reference-level explanation

- **Metadata:** decorators write entity/column/relation descriptors into
  `reflect-metadata`. An `EntityRegistry` builds a relation graph and validates
  it at `Orm` construction (fail-fast on bad foreign keys / missing inverse).
- **Query planning:** eager `with` compiles to parameterized `JOIN`s (or batched
  `IN (...)` follow-up queries for collections, to avoid row-explosion). Lazy
  `$load` uses a per-request dataloader-style batch to prevent N+1.
- **Repository:** extends the existing `StreetPostgresRepository`; raw query
  access remains available.
- **Migrations:** `MigrationDiffer` (exists) compares `EntityRegistry` metadata
  against `schema-inspector` output to emit `up`/`down` SQL; reuses the existing
  `StreetMigrationRunner`.
- **Dialects:** a `Dialect` interface (Postgres first). MySQL via the existing
  `MysqlPool`. SQLite for tests.

## Backward compatibility

Additive and opt-in. Nothing in `streetjs` core changes; `@streetjs/orm` is a new
package depending on `streetjs`. Existing `PgPool`/repository code keeps working.
Semver: new minor for the package; core unaffected.

## Security considerations

- All generated SQL is **parameterized**; identifiers (table/column names) come
  only from compile-time entity metadata, never user input.
- Relation filters validate column references against the registry before use.
- No raw string interpolation in the query planner (CodeQL-gated).

## Testing & verification

- **Property-based tests** for the SQL generator: for any entity graph + query
  spec, generated SQL is parameterized, references only known columns, and
  round-trips through a parser.
- **Live PostgreSQL integration suite** (service container in CI, like the new
  MongoDB job) covering 1:1, 1:N, N:M, eager, lazy, and relation filtering.
- **Migration tests**: model change → generated migration → apply → schema
  matches; `down` reverses it.
- GA gate: all of the above green in CI before the package leaves `0.x`.

## Alternatives considered

- **Wrap an existing ORM (Prisma/TypeORM):** rejected — adds heavy third-party
  dependencies, contradicting the two-dependency philosophy and the native-driver
  design.
- **Codegen-only (Prisma-style schema file):** rejected for v1 — decorators reuse
  the existing decorator/DI conventions already in StreetJS; a schema-file mode
  can be added later.
- **Keep repository-only:** rejected — this is the documented adoption blocker.

## Unresolved questions

- Default loading strategy (eager-by-`with` vs lazy) and the lazy `$load` ergonomics.
- Composite primary keys and polymorphic relations in v1 vs later.
- Whether migration generation should be interactive (review/edit) by default.
