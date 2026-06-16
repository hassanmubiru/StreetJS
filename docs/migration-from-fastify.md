---
layout: default
title: Migrating from Fastify
nav_order: 10
permalink: /migration-from-fastify/
description: "Move a Fastify app to StreetJS — routes, hooks, schema validation, and plugins mapped to decorators and built-in middleware."
---

# Migrating from Fastify

Fastify users choose it for speed and built-in schema validation. StreetJS keeps
those properties — a native HTTP server on `node:http`, built-in input validation,
and bounded-memory streaming — while moving routing to a decorator model and
replacing the plugin-encapsulation system with a DI container plus middleware.

## Mental-model mapping

| Fastify | StreetJS |
|---------|----------|
| `const app = Fastify()` | `const app = streetApp({ port })` |
| `app.get('/x', opts, handler)` | `@Get('/x')` on a `@Controller` |
| `request` / `reply` | a single `ctx: StreetContext` |
| `reply.send(obj)` | `ctx.json(obj)` |
| `reply.code(201).send(...)` | `ctx.status(201).json(...)` |
| route `schema: { body, params }` | `@Validate({ body, params })` |
| `app.addHook('onRequest', ...)` | `app.use(middleware)` |
| `app.register(plugin)` | `@Injectable()` services + `app.use(...)` |
| `@fastify/cors` | `corsMiddleware(...)` |
| `@fastify/helmet` | `securityHeaders(...)` |
| `@fastify/jwt` | `JwtService` + `authMiddleware` |

## Routing

**Fastify**
```js
const app = require('fastify')();

app.get('/api/items/:id', async (request, reply) => {
  return { id: request.params.id };
});

app.post('/api/items', async (request, reply) => {
  reply.code(201);
  return { created: request.body.name };
});

app.listen({ port: 3000 });
```

**StreetJS**
```typescript
import 'reflect-metadata';
import { streetApp, Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api/items')
class ItemController {
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
app.registerController(ItemController);
await app.listen();
```

## Schema validation

Fastify validates via JSON Schema on the route. StreetJS uses the `@Validate`
decorator, which rejects invalid input with a safe 400 **before** the handler runs:

**Fastify**
```js
app.post('/users', {
  schema: {
    body: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, age: { type: 'integer' } },
    },
  },
}, handler);
```

**StreetJS**
```typescript
import { Controller, Post, Validate } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/users')
class UserController {
  @Post('/')
  @Validate({ body: { name: { type: 'string', min: 1 }, age: { type: 'number' } } })
  async create(ctx: StreetContext) {
    ctx.status(201).json(ctx.body);
  }
}
```

## Hooks → middleware

Fastify lifecycle hooks (`onRequest`, `preHandler`) map to StreetJS middleware
registered with `app.use(...)`:

```typescript
import { streetApp, corsMiddleware, securityHeaders } from 'streetjs';

const app = streetApp({ port: 3000 });
app.use(corsMiddleware({ origin: true }));   // ~ @fastify/cors
app.use(securityHeaders());                   // ~ @fastify/helmet
app.use(async (ctx, next) => {                // ~ onRequest hook
  const start = Date.now();
  await next();
  ctx.res.setHeader('x-response-time', String(Date.now() - start));
});
```

## Plugins → DI + middleware

Fastify's `register()` encapsulation becomes plain `@Injectable()` services
resolved by the container, plus middleware for cross-cutting concerns. Shared
infrastructure (Redis, Stripe, S3, etc.) is available as official StreetJS plugins
through the signed plugin registry rather than Fastify plugins.

## JWT auth

**Fastify** (`@fastify/jwt`) → **StreetJS** (`JwtService` + `authMiddleware`):
```typescript
import { JwtService, authMiddleware, requireRoles } from 'streetjs';

const jwt = new JwtService({ secret: process.env.JWT_SECRET! });
const token = await jwt.sign({ sub: userId, roles: ['admin'] });

app.use(authMiddleware({ /* verification options */ }));
// guard routes with requireRoles('admin')
```

## Checklist

- [ ] Replace `Fastify()` with `streetApp({ port })` and `listen({port})` with `listen()`.
- [ ] Convert routes to `@Controller` classes with `@Get/@Post/...`.
- [ ] Move `request`/`reply` logic onto `ctx` (`ctx.params`, `ctx.body`, `ctx.json`, `ctx.status`).
- [ ] Convert route `schema` to `@Validate({...})`.
- [ ] Convert hooks to `app.use(...)` middleware.
- [ ] Replace `@fastify/*` plugins with built-in middleware + official StreetJS plugins.

See also: [Migrating from Express](migration-from-express.md) · [Migrating from NestJS](migration-from-nestjs.md).
