---
layout:    default
title:     "PostgreSQL Integration"
parent:    "Tutorials"
nav_order: 3
permalink: /tutorials/postgresql/
description: "Connect StreetJS to PostgreSQL with the native driver — pool setup, migrations, parameterized queries, and the repository pattern."
---

# PostgreSQL Integration

**Level:** Beginner · **Time:** ~20 minutes · **Prerequisites:** [Your First API](/tutorials/first-api/), a running PostgreSQL

StreetJS ships a **native PostgreSQL wire driver** (SCRAM-SHA-256 auth, pooling)
— no `pg` dependency. This tutorial wires a pool, runs migrations, and reads/writes
data with the repository pattern.

---

## 1. Start PostgreSQL

The scaffold includes a `docker-compose.yml` with Postgres:

```bash
docker compose up -d postgres
```

Set credentials in `.env` (copy from `.env.example`):

```bash
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=street
PG_USER=street
PG_PASSWORD=street_pass
```

---

## 2. Create the pool

`PgPool` manages connections. Register it in the container so repositories can
resolve it:

```typescript
// src/main.ts
import { PgPool, container } from 'streetjs';

const pool = new PgPool({
  host: process.env['PG_HOST'] ?? 'localhost',
  port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
  user: process.env['PG_USER'] ?? 'postgres',
  password: process.env['PG_PASSWORD'] ?? '',
  database: process.env['PG_DATABASE'] ?? 'street',
  minConnections: 2,
  maxConnections: 10,
  idleTimeoutMs: 30_000,
  acquireTimeoutMs: 5_000,
});
await pool.initialize();        // warm up min connections
container.register(PgPool, pool);
```

---

## 3. Write a migration

Migrations are plain SQL files in `migrations/`, applied in filename order. Create
`migrations/20260101000000_create_tasks.sql`:

```sql
CREATE TABLE tasks (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title      VARCHAR(200) NOT NULL,
  done       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX tasks_created_at_idx ON tasks (created_at DESC);
```

Run migrations on startup:

```typescript
import { StreetMigrationRunner } from 'streetjs';

const runner = new StreetMigrationRunner(pool);
await runner.run('./migrations');
```

…or from the CLI:

```bash
street migrate:run
street migrate:create add_priority_to_tasks   # scaffolds a timestamped file
```

> **Note — `gen_random_uuid()`** requires the `pgcrypto` extension. The scaffold
> enables it via `docker-init/001_enable_pgcrypto.sql`. On a managed database run
> `CREATE EXTENSION IF NOT EXISTS pgcrypto;` once.

---

## 4. The repository pattern

Repositories own data access. Always use **parameterized queries** (`$1`, `$2`)
— never string interpolation — to stay injection-safe.

```typescript
// src/repositories/task.repository.ts
import { Injectable, container, PgPool } from 'streetjs';
import type { PgRow } from 'streetjs';

export interface Task { id: string; title: string; done: boolean; createdAt: Date; }

function rowToTask(row: PgRow): Task {
  return {
    id: String(row['id']),
    title: String(row['title']),
    done: Boolean(row['done']),
    createdAt: new Date(String(row['created_at'])),
  };
}

@Injectable()
export class TaskRepository {
  private readonly pool = container.resolve(PgPool);

  async list(): Promise<Task[]> {
    const res = await this.pool.query('SELECT * FROM tasks ORDER BY created_at DESC');
    return res.rows.map(rowToTask);
  }

  async create(title: string): Promise<Task> {
    const res = await this.pool.query(
      'INSERT INTO tasks (title) VALUES ($1) RETURNING *',
      [title],
    );
    return rowToTask(res.rows[0] as PgRow);
  }

  async setDone(id: string, done: boolean): Promise<void> {
    await this.pool.query('UPDATE tasks SET done = $1 WHERE id = $2', [done, id]);
  }

  async remove(id: string): Promise<void> {
    await this.pool.query('DELETE FROM tasks WHERE id = $1', [id]);
  }
}
```

> **Tip — integer columns.** The native driver returns some numeric/`COUNT(*)`
> columns as strings. Coerce explicitly with `Number(...)` / `parseInt(...)` when
> you need a number (e.g. `parseInt(String(row['total']), 10)`).

---

## 5. Use it from a service + controller

```typescript
import { Injectable } from 'streetjs';
import { TaskRepository } from '../repositories/task.repository.js';

@Injectable()
export class TaskService {
  constructor(private readonly repo: TaskRepository) {}
  list() { return this.repo.list(); }
  add(title: string) { return this.repo.create(title); }
}
```

The controller follows the same pattern as the
[REST API example](/examples/rest-api/), which shows full CRUD, pagination, and
OpenAPI generation end to end.

---

## Going further: the ORM

For relations and model-driven migrations, add
[`@streetjs/orm`](https://www.npmjs.com/package/@streetjs/orm): entity decorators
(`@Entity`, `@Column`, `@HasMany`, …), eager loading (N+1-safe), and
`Orm.makeMigration` to diff your models against the live schema.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `password authentication failed` | Check `.env` credentials match the running Postgres. |
| `function gen_random_uuid() does not exist` | Run `CREATE EXTENSION IF NOT EXISTS pgcrypto;`. |
| A count comes back as `"42"` (string) | Expected — coerce with `parseInt(String(value), 10)`. |
| Pool acquire timeouts under load | Raise `maxConnections` or lower `acquireTimeoutMs` and add backpressure. |
