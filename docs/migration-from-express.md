---
layout: default
title: Migrating from Express
nav_order: 8
permalink: /migration-from-express/
description: "Move an Express app to StreetJS — side-by-side routing, middleware, error handling, and body parsing with runnable examples."
---

# Migrating from Express

StreetJS replaces the Express runtime entirely — there is no `express()` app and no
`pg`/`body-parser`/`cors` middleware stack to wire up. Routing is decorator-based,
JSON body parsing is built in, and security headers / CORS / auth ship as
first-class middleware. This guide maps the Express concepts you know onto StreetJS.

> All snippets use the real public API: `streetApp`, `@Controller/@Get/@Post`,
> `@Injectable`, `StreetContext`, and the built-in exception classes.

## Mental-model mapping

| Express | StreetJS |
|---------|----------|
| `const app = express()` | `const app = streetApp({ port: 3000 })` |
| `app.get('/x', handler)` | `@Get('/x')` method on a `@Controller` class |
| `app.use(express.json())` | built in — JSON bodies parse automatically |
| `app.use(cors())` | `corsMiddleware(...)` |
| `helmet()` | `securityHeaders(...)` |
| `req` / `res` | a single `ctx: StreetContext` |
| `res.json(obj)` | `ctx.json(obj)` |
| `res.status(404).json(...)` | `throw new NotFoundException(...)` |
| `next(err)` | `throw` a `StreetException` (centralized handler) |
| service singletons (manual) | `@Injectable()` + DI container |

## Routing

**Express**
```js
const express = require('express');
const app = express();
app.use(express.json());

app.get('/api/users/:id', (req, res) => {
  res.json({ id: req.params.id });
});

app.post('/api/users', (req, res) => {
  res.status(201).json({ created: req.body.name });
});

app.listen(3000);
```

**StreetJS**
```typescript
import 'reflect-metadata';
import { streetApp, Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api/users')
class UserController {
  @Get('/:id')
  async getOne(ctx: StreetContext) {
    ctx.json({ id: ctx.params.id });
  }

  @Post('/')
  async create(ctx: StreetContext) {
    const body = ctx.body as { name: string };
    ctx.status(201).json({ created: body.name });
  }
}

const app = streetApp({ port: 3000 });
app.registerController(UserController);
await app.listen();
```

## Middleware

**Express**
```js
app.use(cors({ origin: 'https://app.example.com' }));
app.use(helmet());

function auth(req, res, next) {
  if (!req.headers.authorization) return res.status(401).end();
  next();
}
app.get('/private', auth, handler);
```

**StreetJS** — CORS, security headers, and auth are built-in middleware:
```typescript
import { streetApp, corsMiddleware, securityHeaders, authMiddleware, requireRoles } from 'streetjs';

const app = streetApp({ port: 3000 });
app.use(corsMiddleware({ origin: 'https://app.example.com' }));
app.use(securityHeaders());

// Route-level authorization via decorator metadata / middleware:
app.use(authMiddleware({ /* jwt verification options */ }));
// then guard specific roles with requireRoles('admin') on the route/controller
```

## Error handling

Express uses error-first middleware; StreetJS uses typed exceptions caught by a
central handler that produces a safe JSON response (no stack-trace leakage).

**Express**
```js
app.get('/x', (req, res, next) => {
  const item = find(req.params.id);
  if (!item) return next(new Error('not found'));
  res.json(item);
});
app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
```

**StreetJS**
```typescript
import { Controller, Get, NotFoundException } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/x')
class XController {
  @Get('/:id')
  async getOne(ctx: StreetContext) {
    const item = find(ctx.params.id);
    if (!item) throw new NotFoundException('item not found'); // → 404 JSON
    ctx.json(item);
  }
}
```

Available exceptions: `BadRequestException` (400), `UnauthorizedException` (401),
`ForbiddenException` (403), `NotFoundException` (404), `ConflictException` (409),
and the base `StreetException`.

## Dependency injection (replacing manual singletons)

**Express** — you new-up and pass services manually. **StreetJS** — annotate with
`@Injectable()` and the container wires constructor dependencies:

```typescript
import { Injectable, Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Injectable()
class UserService {
  list() { return [{ id: 1 }]; }
}

@Controller('/users')
class UserController {
  constructor(private readonly users: UserService) {}

  @Get('/')
  async list(ctx: StreetContext) {
    ctx.json(this.users.list());
  }
}
```

## Database (no `pg`)

Express apps typically add `pg`. StreetJS ships a native PostgreSQL wire driver:

```typescript
import { PgPool } from 'streetjs';

const pool = new PgPool({ host: 'localhost', database: 'app', user: 'app', password: '...' });
const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]); // parameterized
```

## Checklist

- [ ] Replace `express()` with `streetApp({ port })`.
- [ ] Convert route handlers to `@Controller` classes with `@Get/@Post/...`.
- [ ] Drop `body-parser` — JSON parses automatically via `ctx.body`.
- [ ] Replace `cors()`/`helmet()` with `corsMiddleware`/`securityHeaders`.
- [ ] Replace `next(err)` with thrown `StreetException` subclasses.
- [ ] Replace manual service wiring with `@Injectable()` + constructor injection.
- [ ] Replace `pg` with `PgPool`.

See also: [Migrating from NestJS](migration-from-nestjs.md) · [Migrating from Fastify](migration-from-fastify.md).
