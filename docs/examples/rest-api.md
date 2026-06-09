---
layout:    default
title:     "REST API"
parent:    "Examples"
nav_order: 1
permalink: /examples/rest-api/
description: "Complete REST API example with Street Framework — CRUD endpoints, PostgreSQL, JWT authentication, pagination."
---

# Example: REST API

A complete REST API with CRUD operations, PostgreSQL persistence, JWT authentication, and pagination.

---

## Project structure

```
src/
├── main.ts
├── controllers/
│   └── items.controller.ts
├── services/
│   └── items.service.ts
└── repositories/
    └── items.repository.ts
migrations/
└── 20260101000000_create_items.sql
```

---

## Migration

```sql
-- migrations/20260101000000_create_items.sql
CREATE TABLE items (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(255) NOT NULL,
  description TEXT         NOT NULL DEFAULT '',
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX items_created_at_idx ON items (created_at DESC);
```

---

## Repository

```typescript
// src/repositories/items.repository.ts
import { Injectable, container, PgPool } from 'streetjs';
import type { PgRow } from 'streetjs';

export interface Item {
  id: string;
  name: string;
  description: string;
  price: number;
  createdAt: Date;
  updatedAt: Date;
}

function rowToItem(row: PgRow): Item {
  return {
    id:          String(row['id']),
    name:        String(row['name']),
    description: String(row['description'] ?? ''),
    price:       parseFloat(String(row['price'] ?? '0')),
    createdAt:   new Date(String(row['created_at'])),
    updatedAt:   new Date(String(row['updated_at'])),
  };
}

@Injectable()
export class ItemRepository {
  private readonly pool = container.resolve(PgPool);

  async findAll(limit: number, offset: number): Promise<{ items: Item[]; total: number }> {
    const [data, count] = await Promise.all([
      this.pool.query(
        'SELECT * FROM items ORDER BY created_at DESC LIMIT $1 OFFSET $2',
        [limit, offset]
      ),
      this.pool.query('SELECT COUNT(*) AS total FROM items'),
    ]);
    return {
      items: data.rows.map(rowToItem),
      total: parseInt(String(count.rows[0]?.['total'] ?? '0'), 10),
    };
  }

  async findById(id: string): Promise<Item | null> {
    const result = await this.pool.query(
      'SELECT * FROM items WHERE id = $1', [id]
    );
    return result.rows[0] ? rowToItem(result.rows[0] as PgRow) : null;
  }

  async create(item: Item): Promise<void> {
    await this.pool.query(
      `INSERT INTO items (id, name, description, price, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [item.id, item.name, item.description, item.price,
       item.createdAt.toISOString(), item.updatedAt.toISOString()]
    );
  }

  async update(item: Item): Promise<void> {
    await this.pool.query(
      `UPDATE items SET name=$1, description=$2, price=$3, updated_at=$4
       WHERE id=$5`,
      [item.name, item.description, item.price,
       item.updatedAt.toISOString(), item.id]
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM items WHERE id = $1', [id]);
  }
}
```

---

## Service

```typescript
// src/services/items.service.ts
import { Injectable, NotFoundException, BadRequestException } from 'streetjs';
import { ItemRepository } from '../repositories/items.repository.js';
import type { Item } from '../repositories/items.repository.js';

export interface CreateItemInput { name: string; description?: string; price: number; }
export interface UpdateItemInput { name?: string; description?: string; price?: number; }

@Injectable()
export class ItemService {
  constructor(private readonly repo: ItemRepository) {}

  async findAll(page: number, limit: number) {
    const offset = (page - 1) * limit;
    const { items, total } = await this.repo.findAll(limit, offset);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<Item> {
    const item = await this.repo.findById(id);
    if (!item) throw new NotFoundException(`Item ${id} not found`);
    return item;
  }

  async create(input: CreateItemInput): Promise<Item> {
    if (!input.name?.trim()) throw new BadRequestException('name is required');
    if (input.price < 0)     throw new BadRequestException('price must be >= 0');
    const now = new Date();
    const item: Item = {
      id: crypto.randomUUID(), name: input.name.trim(),
      description: input.description ?? '', price: input.price,
      createdAt: now, updatedAt: now,
    };
    await this.repo.create(item);
    return item;
  }

  async update(id: string, input: UpdateItemInput): Promise<Item> {
    const existing = await this.findById(id);
    const updated: Item = { ...existing, ...input, updatedAt: new Date() };
    await this.repo.update(updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    await this.findById(id);
    await this.repo.delete(id);
  }
}
```

---

## Controller

```typescript
// src/controllers/items.controller.ts
import {
  Controller, Get, Post, Put, Delete,
  ApiOperation, container,
} from 'streetjs';
import type { StreetContext } from 'streetjs';
import { ItemService } from '../services/items.service.js';
import type { CreateItemInput, UpdateItemInput } from '../services/items.service.js';

@Controller('/api/items')
export class ItemController {
  private readonly svc = container.resolve(ItemService);

  @Get('/')
  @ApiOperation({ summary: 'List items', tags: ['items'] })
  async list(ctx: StreetContext): Promise<void> {
    const page  = Math.max(1, parseInt(ctx.query['page']  ?? '1',  10));
    const limit = Math.min(100, parseInt(ctx.query['limit'] ?? '20', 10));
    ctx.json(await this.svc.findAll(page, limit));
  }

  @Get('/:id')
  @ApiOperation({ summary: 'Get item by ID', tags: ['items'] })
  async getOne(ctx: StreetContext): Promise<void> {
    ctx.json(await this.svc.findById(ctx.params['id']!));
  }

  @Post('/')
  @ApiOperation({ summary: 'Create item', tags: ['items'] })
  async create(ctx: StreetContext): Promise<void> {
    const body = ctx.body as CreateItemInput;
    ctx.json(await this.svc.create(body), 201);
  }

  @Put('/:id')
  @ApiOperation({ summary: 'Update item', tags: ['items'] })
  async update(ctx: StreetContext): Promise<void> {
    const body = ctx.body as UpdateItemInput;
    ctx.json(await this.svc.update(ctx.params['id']!, body));
  }

  @Delete('/:id')
  @ApiOperation({ summary: 'Delete item', tags: ['items'] })
  async remove(ctx: StreetContext): Promise<void> {
    await this.svc.delete(ctx.params['id']!);
    ctx.send(204);
  }
}
```

---

## Entry point

```typescript
// src/main.ts
import 'reflect-metadata';
import {
  streetApp, PgPool, StreetMigrationRunner, container,
  securityHeaders, corsMiddleware, xssMiddleware,
  RateLimiter, TelemetryTracker, telemetryMiddleware,
} from 'streetjs';
import { ItemController } from './controllers/items.controller.js';

async function bootstrap() {
  const pool = new PgPool({
    host: process.env['PG_HOST'] ?? 'localhost',
    port: parseInt(process.env['PG_PORT'] ?? '5432', 10),
    user: process.env['PG_USER'] ?? 'postgres',
    password: process.env['PG_PASSWORD'] ?? '',
    database: process.env['PG_DATABASE'] ?? 'mydb',
    minConnections: 2, maxConnections: 10,
    idleTimeoutMs: 30_000, acquireTimeoutMs: 5_000,
  });
  await pool.initialize();
  container.register(PgPool, pool);

  // Run migrations on startup
  const runner = new StreetMigrationRunner(pool);
  await runner.run('./migrations');

  const telemetry = new TelemetryTracker(60_000);
  const limiter   = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });
  const app       = streetApp({ port: 3000 });

  app.use(securityHeaders);
  app.use(corsMiddleware(['*']));
  app.use(xssMiddleware);
  app.use(telemetryMiddleware(telemetry));
  app.use(limiter.middleware());
  app.registerController(ItemController);

  const spec = app.openApiSpec();
  app.use(async (ctx, next) => {
    if (ctx.path === '/openapi.json') { ctx.json(spec); return; }
    await next();
  });

  await app.listen();

  process.once('SIGTERM', async () => {
    await app.close();
    await pool.close();
    limiter.destroy();
    process.exit(0);
  });
}

bootstrap().catch((err) => { console.error(err); process.exit(1); });
```

---

## Test it

```bash
# Create
curl -X POST http://localhost:3000/api/items \
  -H 'Content-Type: application/json' \
  -d '{"name":"Widget","description":"A useful widget","price":9.99}'
# {"id":"...","name":"Widget","price":9.99,...}

# List
curl 'http://localhost:3000/api/items?page=1&limit=10'
# {"items":[...],"total":1,"page":1,"limit":10,"pages":1}

# Get one
curl http://localhost:3000/api/items/<id>

# Update
curl -X PUT http://localhost:3000/api/items/<id> \
  -H 'Content-Type: application/json' \
  -d '{"price":12.99}'

# Delete
curl -X DELETE http://localhost:3000/api/items/<id>
# 204 No Content

# OpenAPI spec
curl http://localhost:3000/openapi.json | jq .paths
```
