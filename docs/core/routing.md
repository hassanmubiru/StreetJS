---
layout:    default
title:     "Routing"
parent:    "Core"
nav_order: 2
permalink: /core/routing/
description: "Type-safe HTTP routing in StreetJS — decorator-based controllers, route params and the request context API for TypeScript backends."
---

# Routing

street's router compiles route paths to regular expressions at registration time. At request time, matching is a single `RegExp.exec()` call per route — no string splitting, no path-segment walking, no tree traversal.

---

## How routing works

When you call `app.registerController(MyController)`, the framework:

1. Reads `@Controller(prefix)` metadata from the class
2. Reads `@Get`, `@Post`, etc. metadata from each method
3. Concatenates `prefix + routePath` to form the full path
4. Compiles the path to a `RegExp` and stores parameter names
5. Registers the compiled route with the middleware pipeline

At request time:
1. Iterate compiled routes in registration order
2. `regex.exec(requestPath)` — O(1) per route
3. Extract named parameters from capture groups
4. Run the middleware pipeline
5. Call the handler

---

## Route decorators

All route decorators take a path string and optional middleware functions:

```typescript
import { Get, Post, Put, Patch, Delete } from '../core/decorators.js';

@Controller('/api/products')
class ProductController {
  @Get('/')               // GET /api/products
  @Get('/:id')            // GET /api/products/:id
  @Post('/')              // POST /api/products
  @Put('/:id')            // PUT /api/products/:id
  @Patch('/:id')          // PATCH /api/products/:id
  @Delete('/:id')         // DELETE /api/products/:id
}
```

### With inline middleware

```typescript
import { Get } from '../core/decorators.js';
import { authMiddleware } from '../http/auth.middleware.js';
import { JwtService } from '../security/jwt.js';

const jwt = new JwtService(process.env['JWT_SECRET']!);

@Controller('/api/admin')
class AdminController {
  // Auth middleware runs before the handler
  @Get('/dashboard', authMiddleware(jwt))
  async dashboard(ctx: StreetContext): Promise<void> {
    ctx.json({ user: ctx.user });
  }

  // Multiple middleware — run left to right
  @Get('/secret', authMiddleware(jwt), requireRoles('admin'))
  async secret(ctx: StreetContext): Promise<void> {
    ctx.json({ secret: 'classified' });
  }
}
```

---

## Path parameters

Use `:paramName` syntax. Parameters are extracted and available on `ctx.params`:

```typescript
@Get('/:id')
async getOne(ctx: StreetContext): Promise<void> {
  const id = ctx.params['id'];  // always a string
  ctx.json({ id });
}

@Get('/:category/:slug')
async getBySlug(ctx: StreetContext): Promise<void> {
  const { category, slug } = ctx.params;
  ctx.json({ category, slug });
}
```

URL encoding is handled automatically — `%20` in a URL parameter becomes a space in `ctx.params`.

---

## Query parameters

Query string values are available on `ctx.query`. All values are strings:

```typescript
// GET /api/products?page=2&limit=20&sort=price
@Get('/')
async list(ctx: StreetContext): Promise<void> {
  const page = parseInt(ctx.query['page'] ?? '1', 10);
  const limit = Math.min(parseInt(ctx.query['limit'] ?? '20', 10), 100);
  const sort = ctx.query['sort'] ?? 'created_at';

  const result = await this.service.findAll(page, limit, sort);
  ctx.json(result);
}
```

---

## Path compilation

Understanding how paths compile to regex helps with debugging:

| Route path | Compiled regex | Notes |
|---|---|---|
| `/users` | `^\/users$` | Exact match |
| `/users/:id` | `^\/users\/([^/]+)$` | One segment captured |
| `/users/:id/posts/:postId` | `^\/users\/([^/]+)\/posts\/([^/]+)$` | Two segments |
| `/files/*` | `^\/files\/(.*)$` | Wildcard captures rest |

Parameter names are extracted in order and mapped to the capture groups. Special regex characters in path strings are escaped before conversion.

---

## Middleware pipeline

Middleware functions run in order before the handler. Each one calls `next()` to proceed:

```typescript
type MiddlewareFn = (ctx: StreetContext, next: () => Promise<void>) => Promise<void>;
```

### Controller-level middleware

Applies to every route in the controller:

```typescript
@Controller('/api/admin', authMiddleware(jwt), requireRoles('admin'))
class AdminController {
  // Every route in this controller requires admin auth
  @Get('/users')
  async listUsers(ctx: StreetContext): Promise<void> { /* ... */ }
}
```

### Route-level middleware

Applies only to a specific route:

```typescript
@Controller('/api/products')
class ProductController {
  // This route requires auth
  @Delete('/:id', authMiddleware(jwt))
  async remove(ctx: StreetContext): Promise<void> { /* ... */ }

  // This route does not
  @Get('/')
  async list(ctx: StreetContext): Promise<void> { /* ... */ }
}
```

### Pipeline execution order

For a request to `DELETE /api/products/:id`:

```
Global middleware (registered via app.use())
  → securityHeaders
  → corsMiddleware
  → xssMiddleware
  → telemetryMiddleware
  → rateLimiter.middleware()
Controller middleware (from @Controller)
  → authMiddleware
Route middleware (from @Delete)
  → (none in this example)
Validation middleware (@Validate, if present)
  → validateParams({ id: { type: 'uuid', required: true } })
Handler
  → ProductController.remove(ctx)
```

After the handler returns, the pipeline unwinds in reverse — middleware that awaited `next()` resumes.

### Middleware that modifies state

Use `ctx.state` to pass data between middleware and handlers:

```typescript
// Middleware: parse and attach tenant
async function tenantMiddleware(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const tenantId = ctx.headers['x-tenant-id'];
  if (!tenantId) throw new BadRequestException('Missing tenant ID');
  ctx.state['tenantId'] = tenantId;
  await next();
}

// Handler: read from state
@Get('/', tenantMiddleware)
async list(ctx: StreetContext): Promise<void> {
  const tenantId = ctx.state['tenantId'] as string;
  ctx.json({ tenantId });
}
```

---

## Global middleware

Register middleware that runs on every request via `app.use()`. Call this before `app.registerController()`:

```typescript
import { securityHeaders, corsMiddleware } from './http/auth.middleware.js';
import { xssMiddleware } from './security/xss.js';
import { telemetryMiddleware } from './telemetry/tracker.js';
import { RateLimiter } from './security/ratelimit.js';

const app = streetApp({ port: 3000 });

const rateLimiter = new RateLimiter({ windowMs: 60_000, maxRequests: 300 });

// Executed in registration order on every request
app.use(securityHeaders);
app.use(corsMiddleware(['https://app.example.com', 'https://admin.example.com']));
app.use(xssMiddleware);
app.use(telemetryMiddleware(telemetry));
app.use(rateLimiter.middleware());

// Controllers registered after middleware
app.registerController(UserController);
app.registerController(HealthController);
```

---

## 404 and error handling

If no route matches, the router's `notFoundHandler` throws `NotFoundException` automatically. The global error handler formats it as JSON.

You can override this behavior by registering a catch-all route:

```typescript
// Not directly supported — unmatched routes always get NotFoundException.
// Customize the error format in the global error handler instead.
```

---

## Route conflicts

Routes are matched in registration order. If two routes could match the same path, the first registered wins:

```typescript
// These two could conflict:
@Get('/users/me')    // Matches /users/me (exact)
@Get('/users/:id')   // Matches /users/me (param)

// Solution: register specific routes before parameterized ones.
// In street, routes within a controller are registered in method declaration order.
// Declare 'me' before ':id':

@Controller('/api')
class UserController {
  @Get('/users/me')   // registered first → wins for /users/me
  async me(ctx) { ... }

  @Get('/users/:id')  // registered second → only matches non-'me' values
  async getOne(ctx) { ... }
}
```

---

## OpenAPI integration

Every registered route is automatically included in the OpenAPI spec. Add metadata with `@ApiOperation`:

```typescript
import { ApiOperation } from '../core/decorators.js';

@Controller('/api/products')
class ProductController {
  @Get('/:id')
  @ApiOperation({
    summary: 'Get product by ID',
    description: 'Returns a single product. Returns 404 if not found.',
    tags: ['products'],
    responses: {
      '200': { description: 'Product found' },
      '404': { description: 'Product not found' },
    },
  })
  async getOne(ctx: StreetContext): Promise<void> { /* ... */ }
}
```

Access the generated spec:

```bash
curl http://localhost:3000/api/openapi.json
```
