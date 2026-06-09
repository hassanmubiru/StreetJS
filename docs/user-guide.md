---
layout: default
title: User Guide
nav_order: 3
---

# User Guide

This guide covers the primary Street framework concepts: routing, middleware, dependency injection, authentication, and the database layer.

## Routing

Street uses decorator-based routing. Every controller is annotated with `@Controller(prefix)` and each handler with an HTTP method decorator.

```typescript
import { Controller, Get, Post, Put, Delete } from 'streetjs';

@Controller('/users')
class UserController {
  @Get('/')
  async list(ctx) { ctx.json([]); }

  @Get('/:id')
  async findOne(ctx) { ctx.json({ id: ctx.params.id }); }

  @Post('/')
  async create(ctx) { ctx.json(ctx.body, 201); }

  @Put('/:id')
  async update(ctx) { ctx.json({ updated: true }); }

  @Delete('/:id')
  async remove(ctx) { ctx.send(204); }
}
```

## Middleware

Middleware functions receive `(ctx, next)` and must call `next()` to pass control.

```typescript
import type { MiddlewareFn } from 'streetjs';

const loggingMiddleware: MiddlewareFn = async (ctx, next) => {
  console.log(`${ctx.method} ${ctx.path}`);
  await next();
  console.log(`Response: ${ctx.res.statusCode}`);
};

app.use(loggingMiddleware);
```

## Dependency Injection

Street ships a lightweight DI container. Mark classes with `@Injectable()` and resolve via `container.resolve(Class)`.

```typescript
import { Injectable, container } from 'streetjs';

@Injectable()
class UserService {
  async findAll() { return []; }
}

const service = container.resolve(UserService);
```

## Database Layer

### PostgreSQL Pool

```typescript
import { PgPool } from 'streetjs';

const pool = new PgPool({
  host: 'localhost',
  port: 5432,
  user: 'app',
  password: 'secret',
  database: 'myapp',
});

await pool.initialize();
const result = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
```

### Repository Pattern

```typescript
import { StreetPostgresRepository } from 'streetjs';

class UserRepository extends StreetPostgresRepository<User> {
  constructor(pool: PgPool) { super(pool, 'users'); }

  async findByEmail(email: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    return result.rows[0] as User ?? null;
  }
}
```

## Authentication

### JWT

```typescript
import { JwtService, authMiddleware } from 'streetjs';

const jwt = new JwtService(process.env.JWT_SECRET);
app.use(authMiddleware(jwt));
```

### RBAC

```typescript
import { RbacService, Roles, rbacGuard } from 'streetjs';

@Roles('admin')
@Controller('/admin')
class AdminController {
  @Get('/')
  @rbacGuard('admin:read')
  async dashboard(ctx) { ctx.json({ admin: true }); }
}
```

## Error Handling

Throw Street exceptions from handlers — they're automatically serialized:

```typescript
import { NotFoundException, BadRequestException } from 'streetjs';

async getUser(ctx) {
  const user = await userService.findById(ctx.params.id);
  if (!user) throw new NotFoundException('User not found');
  ctx.json(user);
}
```

## Multi-Tenancy

```typescript
import { tenantMiddleware, TenantPoolRegistry } from 'streetjs';

app.use(tenantMiddleware({ strategy: 'subdomain' }));
```

## WebSockets

```typescript
import { StreetWebSocketServer } from 'streetjs';

const wsServer = new StreetWebSocketServer({ maxConnections: 10_000 });
wsServer.on('connection', (socket) => {
  socket.send({ type: 'welcome' });
});
```

## Feature Flags (Enterprise)

```typescript
import { FeatureFlagService } from 'streetjs';

const flags = new FeatureFlagService(pool);
const enabled = await flags.isEnabled('new-dashboard', {
  userId: ctx.user?.id,
  role: ctx.user?.roles[0],
});
```
