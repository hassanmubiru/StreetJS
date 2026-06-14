---
layout: default
title: Migrating from NestJS
nav_order: 9
description: "Move a NestJS app to StreetJS — decorators, DI, guards, and exceptions map almost one-to-one, with no module boilerplate."
---

# Migrating from NestJS

If you already use NestJS you will feel at home: StreetJS is decorator-first with a
DI container, controllers, and HTTP exceptions. The biggest simplifications are
**no `@Module` graph to maintain** and **no provider arrays** — `@Injectable()`
classes are resolved directly, and controllers are registered on the app.

## Mental-model mapping

| NestJS | StreetJS |
|--------|----------|
| `@Module({ controllers, providers })` | none — register controllers on the app |
| `@Controller('users')` | `@Controller('/users')` |
| `@Get(':id')` | `@Get('/:id')` |
| `@Injectable()` provider | `@Injectable()` (same idea) |
| constructor injection | constructor injection (same) |
| `@Body()` / `@Param()` param decorators | read `ctx.body` / `ctx.params` |
| `NotFoundException` etc. | `NotFoundException` etc. (same names) |
| `CanActivate` guard | `requireRoles(...)` / auth middleware |
| `main.ts` `NestFactory.create` | `streetApp({ port })` |

## Controllers & providers

**NestJS**
```typescript
@Injectable()
export class UsersService {
  findOne(id: string) { return { id }; }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
```

**StreetJS** — drop the module; register the controller:
```typescript
import 'reflect-metadata';
import { streetApp, Injectable, Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Injectable()
class UsersService {
  findOne(id: string) { return { id }; }
}

@Controller('/users')
class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('/:id')
  async findOne(ctx: StreetContext) {
    ctx.json(this.users.findOne(ctx.params.id));
  }
}

const app = streetApp({ port: 3000 });
app.registerController(UsersController);
await app.listen();
```

## Request data: param decorators → context

Nest injects `@Body()`, `@Param()`, `@Query()`. StreetJS exposes them on `ctx`:

```typescript
@Post('/')
async create(ctx: StreetContext) {
  const dto = ctx.body as CreateUserDto; // @Body()
  const id  = ctx.params.id;             // @Param('id')
  const q   = ctx.query.search;          // @Query('search')
  ctx.status(201).json({ id, dto, q });
}
```

## Validation

Nest uses `class-validator` + `ValidationPipe`. StreetJS provides a built-in
`@Validate` decorator / `validate()` helper with schema-based input validation
(rejecting invalid input with a safe 400 before the handler runs):

```typescript
import { Controller, Post, Validate } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/users')
class UsersController {
  @Post('/')
  @Validate({ body: { name: { type: 'string', min: 1 }, age: { type: 'number' } } })
  async create(ctx: StreetContext) {
    ctx.status(201).json(ctx.body);
  }
}
```

## Guards → role checks

**NestJS**
```typescript
@UseGuards(RolesGuard)
@Roles('admin')
@Get('admin')
adminOnly() {}
```

**StreetJS** — `authMiddleware` populates the authenticated user; `requireRoles`
enforces authorization:
```typescript
import { requireRoles } from 'streetjs';
// apply as middleware on the route/controller; requireRoles('admin') returns
// 403 for users lacking the role.
```

## Exceptions

Exception class names match Nest almost exactly: `BadRequestException`,
`UnauthorizedException`, `ForbiddenException`, `NotFoundException`,
`ConflictException`. Throw them anywhere in a handler and the central handler
emits a safe JSON error response.

## What you no longer need

- `@nestjs/*` packages and the module dependency graph.
- A separate ORM (`@nestjs/typeorm`) — use `PgPool` / `StreetPostgresRepository`.
- `@nestjs/config` — use the built-in `Config` decorator / `loadConfig`.
- Most `@nestjs/platform-*` adapters — HTTP and WebSockets are built in.

## Checklist

- [ ] Delete `@Module` classes; register controllers via `app.registerController`.
- [ ] Keep `@Injectable()` services — constructor DI works the same.
- [ ] Replace param decorators with `ctx.body` / `ctx.params` / `ctx.query`.
- [ ] Replace `ValidationPipe` with `@Validate` / `validate()`.
- [ ] Replace guards with `authMiddleware` + `requireRoles`.
- [ ] Replace TypeORM with `PgPool` / repository.

See also: [Migrating from Express](migration-from-express.md) · [Migrating from Fastify](migration-from-fastify.md).
