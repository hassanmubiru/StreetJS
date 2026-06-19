---
layout:      default
title:       "ORM"
permalink:   /orm/
nav_exclude: true
description:  "Data access in StreetJS — the native PostgreSQL wire driver, the repository pattern, and @streetjs/orm: entity/relation decorators, a safe parameterized query planner, eager/lazy loading, and model-driven migrations. No third-party ORM."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Capability</span>
<h1>Data &amp; ORM</h1>
<p>StreetJS talks to PostgreSQL over a native wire driver — no <code>pg</code>, no Prisma. Use the built-in repository pattern for direct, typed data access, or add <code>@streetjs/orm</code> for entity decorators, relations, and model-driven migrations.</p>
</div>

<style>
.cap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin:24px 0}
.cap-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--border);background:var(--elevated);border-radius:14px;padding:20px}
.cap-card h3{margin:0;font-size:16px}
.cap-card p{margin:0;color:var(--text-secondary);font-size:14px;line-height:1.6}
.cap-card a{font-weight:600;font-size:14px;margin-top:auto}
.cap-tag{align-self:flex-start;font-size:12px;font-weight:600;color:var(--accent);background:var(--accent-soft);border:1px solid var(--accent-line);border-radius:999px;padding:2px 10px}
.cap-note{border:1px solid var(--border);background:var(--elevated);border-radius:12px;padding:16px 18px;color:var(--text-secondary);margin:22px 0}
</style>

StreetJS offers two layers of data access, so you can start simple and add structure only when you need it.

## Two layers, one driver

<div class="cap-grid">

<div class="cap-card">
<span class="cap-tag">Built in</span>
<h3>Native PostgreSQL driver</h3>
<p>A from-scratch implementation of the PostgreSQL wire protocol with connection pooling — parameterized queries, no <code>pg</code> dependency.</p>
<a href="{{ '/database/postgres-wire-driver/' | relative_url }}">Driver docs →</a>
</div>

<div class="cap-card">
<span class="cap-tag">Built in</span>
<h3>Repository pattern</h3>
<p>Typed repositories for CRUD and custom queries, with parameter binding handled for you. The fastest path to data access.</p>
<a href="{{ '/database/repositories/' | relative_url }}">Repository docs →</a>
</div>

<div class="cap-card">
<span class="cap-tag">@streetjs/orm · 0.x</span>
<h3>Entity decorators &amp; relations</h3>
<p><code>@Entity</code>, <code>@Column</code>, <code>@HasMany</code>, <code>@HasOne</code>, <code>@BelongsTo</code>, <code>@ManyToMany</code> with eager (batched, N+1-safe) and lazy loading.</p>
<a href="https://www.npmjs.com/package/@streetjs/orm">npm →</a>
</div>

<div class="cap-card">
<span class="cap-tag">@streetjs/orm · 0.x</span>
<h3>Model-driven migrations</h3>
<p>Diff entity metadata against the live schema to generate idempotent up/down SQL. Additive by default; opt in to column drops.</p>
<a href="https://www.npmjs.com/package/@streetjs/orm">npm →</a>
</div>

</div>

## Define entities

```ts
import 'reflect-metadata';
import { Entity, PrimaryKey, Column, HasMany, BelongsTo } from '@streetjs/orm';

@Entity('users')
class User {
  @PrimaryKey() id!: number;
  @Column() email!: string;
  @HasMany(() => Post, 'authorId') posts?: Post[];
}

@Entity('posts')
class Post {
  @PrimaryKey() id!: number;
  @Column() authorId!: number;
  @Column() published!: boolean;
  @BelongsTo(() => User, 'authorId') author?: User;
}
```

The query planner is parameterized and validates SQL type tokens, so entity definitions never build SQL by string concatenation.

<div class="cap-note">
<strong>Status:</strong> <code>@streetjs/orm</code> is a <strong>0.x preview</strong>. Relations, eager/lazy loading, querying, and model-driven migration generation are implemented and tested (offline plus live PostgreSQL in CI). The native driver and repositories are stable and shipped in the core framework.
</div>

## Other databases

Need a different store? First-party plugins cover [MySQL](https://www.npmjs.com/package/@streetjs/plugin-mysql), [MongoDB](https://www.npmjs.com/package/@streetjs/plugin-mongodb), [Redis](https://www.npmjs.com/package/@streetjs/plugin-redis), and [Supabase](https://www.npmjs.com/package/@streetjs/plugin-supabase). See the [Plugins]({{ '/plugins/' | relative_url }}) page.

## Next steps

- Read the [Database guide]({{ '/database/' | relative_url }})
- Learn the [repository pattern]({{ '/database/repositories/' | relative_url }})
- Install [`@streetjs/orm`](https://www.npmjs.com/package/@streetjs/orm)
