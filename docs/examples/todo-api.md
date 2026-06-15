---
layout:    default
title:     "Todo API"
parent:    "Examples"
nav_order: 0
permalink: /examples/todo-api/
description: "The smallest end-to-end StreetJS example — a Todo REST API with PostgreSQL persistence, in three files. Perfect first build."
---

# Example: Todo API

The smallest useful StreetJS service: a Todo list with PostgreSQL persistence in
three files. If you have read [PostgreSQL Integration](/tutorials/postgresql/),
this assembles those pieces into a runnable app.

---

## 1. Scaffold + database

```bash
street create todo-api
cd todo-api && npm install
docker compose up -d postgres
```

## 2. Migration

```sql
-- migrations/20260101000000_create_todos.sql
CREATE TABLE todos (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  title      VARCHAR(200) NOT NULL,
  done       BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

```bash
street migrate:run
```

## 3. Repository

```typescript
// src/repositories/todo.repository.ts
import { Injectable, container, PgPool } from 'streetjs';
import type { PgRow } from 'streetjs';

export interface Todo { id: string; title: string; done: boolean; createdAt: Date; }
const toTodo = (r: PgRow): Todo => ({
  id: String(r['id']), title: String(r['title']),
  done: Boolean(r['done']), createdAt: new Date(String(r['created_at'])),
});

@Injectable()
export class TodoRepository {
  private readonly pool = container.resolve(PgPool);
  async list() { return (await this.pool.query('SELECT * FROM todos ORDER BY created_at DESC')).rows.map(toTodo); }
  async create(title: string) {
    return toTodo((await this.pool.query('INSERT INTO todos (title) VALUES ($1) RETURNING *', [title])).rows[0] as PgRow);
  }
  async toggle(id: string) { await this.pool.query('UPDATE todos SET done = NOT done WHERE id = $1', [id]); }
  async remove(id: string) { await this.pool.query('DELETE FROM todos WHERE id = $1', [id]); }
}
```

## 4. Controller

```typescript
// src/controllers/todo.controller.ts
import { Controller, Get, Post, Delete, Patch, Injectable, BadRequestException } from 'streetjs';
import type { StreetContext } from 'streetjs';
import { TodoRepository } from '../repositories/todo.repository.js';

@Injectable()
@Controller('/api/todos')
export class TodoController {
  constructor(private readonly repo: TodoRepository) {}

  @Get('/')
  async list(ctx: StreetContext) { ctx.json(await this.repo.list()); }

  @Post('/')
  async create(ctx: StreetContext) {
    const { title } = ctx.body as { title?: string };
    if (!title?.trim()) throw new BadRequestException('title is required');
    ctx.json(await this.repo.create(title.trim()), 201);
  }

  @Patch('/:id')
  async toggle(ctx: StreetContext) { await this.repo.toggle(ctx.params['id']!); ctx.send(204); }

  @Delete('/:id')
  async remove(ctx: StreetContext) { await this.repo.remove(ctx.params['id']!); ctx.send(204); }
}
```

Register `TodoController` in `src/main.ts` (next to the scaffolded controllers),
then `street dev`.

## Test it

```bash
curl -X POST localhost:3000/api/todos -H 'Content-Type: application/json' -d '{"title":"Ship StreetJS app"}'
curl localhost:3000/api/todos
curl -X PATCH localhost:3000/api/todos/<id>   # toggle done
curl -X DELETE localhost:3000/api/todos/<id>  # 204
```

## Next steps

- Add a typed React UI: `street create todo-api --frontend react` and use
  `useQuery`/`useMutation` (see [Full-Stack with React](/tutorials/fullstack-react/)).
- Add pagination, validation schemas, and OpenAPI — see the
  [REST API example](/examples/rest-api/).
