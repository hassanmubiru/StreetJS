---
layout:    default
title:     "Middleware & Validation"
parent:    "Core"
nav_order: 4
permalink: /core/middleware/
description: "Middleware in StreetJS — a composable request pipeline with CORS, security headers, rate limiting and auth for TypeScript Node.js APIs."
---

# Middleware

Middleware functions intercept every request before it reaches a handler. They are the right place for authentication, logging, rate limiting, header injection, and request transformation.

---

## Middleware signature

```typescript
type MiddlewareFn = (
  ctx: StreetContext,
  next: () => Promise<void>
) => Promise<void>;
```

A middleware either:
- Calls `next()` to continue the pipeline
- Throws an exception to abort the pipeline
- Writes a response directly (bypassing remaining middleware)

---

## Built-in middleware

### Security headers

```typescript
import { securityHeaders } from './http/auth.middleware.js';
app.use(securityHeaders);
```

Sets `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`.

### CORS

```typescript
import { corsMiddleware } from './http/auth.middleware.js';
app.use(corsMiddleware(['https://app.example.com']));  // Specific origins
app.use(corsMiddleware(['*']));                          // Any origin (dev only)
```

Handles preflight `OPTIONS` requests automatically. Returns 204 for preflight.

### XSS sanitization

```typescript
import { xssMiddleware } from './security/xss.js';
app.use(xssMiddleware);
```

Recursively sanitizes all string values in `ctx.body` before the handler sees them. Strips HTML tags, `javascript:` protocol, `onerror=` attributes, and null bytes.

### JWT authentication

```typescript
import { authMiddleware } from './http/auth.middleware.js';
import { JwtService } from './security/jwt.js';

const jwt = new JwtService(config.jwtSecret);
const auth = authMiddleware(jwt);

// Global (all routes require auth)
app.use(auth);

// Controller-level (all routes in this controller)
@Controller('/api/admin', auth)

// Route-level (only this route)
@Delete('/:id', auth)
```

On success, sets `ctx.user = { id, email, roles }`.
On failure, throws `UnauthorizedException`.

### Role guard

```typescript
import { requireRoles } from './http/auth.middleware.js';

@Get('/admin', authMiddleware(jwt), requireRoles('admin'))
async adminOnly(ctx: StreetContext): Promise<void> {
  ctx.json({ secret: true });
}
```

### Telemetry

```typescript
import { telemetryMiddleware } from './telemetry/tracker.js';
app.use(telemetryMiddleware(telemetry));
```

Records request latency (nanosecond precision) and error count.

### Rate limiting

```typescript
import { RateLimiter } from './security/ratelimit.js';

const limiter = new RateLimiter({
  windowMs: 60_000,      // 1-minute sliding window
  maxRequests: 100,      // per IP
});
app.use(limiter.middleware());
```

---

## Writing custom middleware

### Logging middleware

```typescript
import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';

export const requestLogger: MiddlewareFn = async (ctx, next) => {
  const start = process.hrtime.bigint();
  await next();
  const ms = Number(process.hrtime.bigint() - start) / 1_000_000;
  console.log(`${ctx.method} ${ctx.path} ${ctx.res.statusCode} ${ms.toFixed(1)}ms`);
};
```

### Request ID middleware

```typescript
import { randomBytes } from 'node:crypto';

export const requestId: MiddlewareFn = async (ctx, next) => {
  const id = randomBytes(8).toString('hex');
  ctx.setHeader('X-Request-Id', id);
  ctx.state['requestId'] = id;
  await next();
};
```

### Tenant isolation middleware

```typescript
export const tenantMiddleware: MiddlewareFn = async (ctx, next) => {
  const tenantId = ctx.headers['x-tenant-id'];
  if (!tenantId) throw new BadRequestException('Missing X-Tenant-Id header');

  // Validate tenant exists (could query DB)
  ctx.state['tenantId'] = tenantId;
  await next();
};
```

### Middleware that runs after the handler

```typescript
export const responseTimer: MiddlewareFn = async (ctx, next) => {
  const start = Date.now();
  await next();                          // Handler runs here
  const elapsed = Date.now() - start;    // Runs after handler
  ctx.setHeader('X-Response-Time', `${elapsed}ms`);
};
```

---

# Validation

The `@Validate` decorator attaches schema validation to any route. Validation runs as middleware — before the handler, after authentication.

---

## ValidationSchema structure

```typescript
interface ValidationSchema {
  body?:   Record<string, FieldRule>;
  query?:  Record<string, FieldRule>;
  params?: Record<string, FieldRule>;
}

interface FieldRule {
  type:      'string' | 'number' | 'boolean' | 'email' | 'uuid';
  required?: boolean;     // default: false
  min?:      number;      // min string length or numeric value
  max?:      number;      // max string length or numeric value
  pattern?:  RegExp;      // must match this regex
}
```

---

## Validation examples

### Validating a request body

```typescript
const registerSchema: ValidationSchema = {
  body: {
    email:    { type: 'email',  required: true,  max: 320 },
    name:     { type: 'string', required: true,  min: 1,  max: 100 },
    password: { type: 'string', required: true,  min: 8,  max: 128 },
    age:      { type: 'number', required: false, min: 18, max: 120 },
  },
};

@Post('/')
@Validate(registerSchema)
async register(ctx: StreetContext): Promise<void> {
  // Validation passed — body is safe to cast
  const dto = ctx.body as CreateUserDto;
  ctx.json(await this.service.register(dto), 201);
}
```

### Validating route params

```typescript
const byIdSchema: ValidationSchema = {
  params: {
    id: { type: 'uuid', required: true },
  },
};

@Get('/:id')
@Validate(byIdSchema)
async getOne(ctx: StreetContext): Promise<void> {
  const id = ctx.params['id']!;  // Guaranteed to be a valid UUID string
  ctx.json(await this.service.findById(id));
}
```

### Validating query strings

```typescript
@Get('/')
@Validate({
  query: {
    page:  { type: 'number', required: false },
    limit: { type: 'number', required: false },
    sort:  { type: 'string', required: false, pattern: /^(name|price|date)$/ },
  },
})
async list(ctx: StreetContext): Promise<void> {
  // ...
}
```

### Error response format

When validation fails, the handler does not run. The response is:

```json
{
  "error": "BadRequestException",
  "message": "Validation failed",
  "status": 400,
  "details": [
    "body.email is required",
    "body.password must be at least 8 chars",
    "body.age must be a number"
  ]
}
```

All validation errors are collected before returning — you get all failures at once, not just the first.

---

# Exception Handling

Throw a `StreetException` subclass from any handler or middleware. The global error handler catches it and formats the JSON response automatically.

---

## Available exceptions

```typescript
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  UnprocessableException,
  InternalException,
  ServiceUnavailableException,
} from '../http/exceptions.js';
```

| Class | HTTP Status | When to use |
|---|---|---|
| `BadRequestException` | 400 | Malformed input, missing required field |
| `UnauthorizedException` | 401 | Missing or invalid authentication |
| `ForbiddenException` | 403 | Authenticated but lacks permission |
| `NotFoundException` | 404 | Resource does not exist |
| `ConflictException` | 409 | Duplicate resource, state conflict |
| `UnprocessableException` | 422 | Structurally valid but semantically wrong |
| `InternalException` | 500 | Unexpected server error |
| `ServiceUnavailableException` | 503 | Dependency (DB, cache) is down |

---

## Throwing with details

```typescript
// Simple message
throw new NotFoundException('User not found');

// With structured details
throw new ConflictException('Email already registered', {
  field: 'email',
  value: 'alice@example.com',
});

// Access the JSON shape
const ex = new BadRequestException('Bad input', ['field.name is required']);
ex.toJSON();
// { error: 'BadRequestException', message: 'Bad input', status: 400, details: [...] }
```

---

## Handling database errors

Wrap database operations and convert errors:

```typescript
@Post('/')
async create(ctx: StreetContext): Promise<void> {
  try {
    const product = await this.products.create(ctx.body as CreateProductDto);
    ctx.json(product, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('unique')) {
      throw new ConflictException('Product with this SKU already exists');
    }
    throw err;  // Re-throw unknown errors — global handler catches them
  }
}
```

---

# OpenAPI

street generates an OpenAPI 3.1 spec from your registered routes automatically. No separate spec file to maintain.

---

## Accessing the spec

```bash
curl http://localhost:3000/api/openapi.json | jq
```

The `HealthController` exposes this endpoint at `/api/openapi.json`. The spec is generated once at startup and cached in `ctx.state`.

---

## Adding operation metadata

```typescript
import { ApiOperation } from '../core/decorators.js';

@Get('/:id')
@ApiOperation({
  summary: 'Get user by ID',
  description: 'Returns a single user object. Returns 404 if the user does not exist.',
  tags: ['users'],
  responses: {
    '200': { description: 'User found',     schema: { $ref: '#/components/schemas/User' } },
    '404': { description: 'User not found', schema: { $ref: '#/components/schemas/Error' } },
  },
})
async getOne(ctx: StreetContext): Promise<void> { /* ... */ }
```

---

## Example generated spec (excerpt)

```json
{
  "openapi": "3.1.0",
  "info": { "title": "Street API", "version": "1.0.0" },
  "paths": {
    "/api/users/{id}": {
      "get": {
        "summary": "Get user by ID",
        "tags": ["users"],
        "parameters": [
          { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
        ],
        "responses": {
          "200": { "description": "User found" },
          "404": { "description": "User not found" }
        }
      }
    }
  }
}
```

Path parameters (`:id` style) are automatically converted to `{id}` style in the spec.
