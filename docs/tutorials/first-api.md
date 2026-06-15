---
layout:    default
title:     "Your First StreetJS API"
parent:    "Tutorials"
nav_order: 1
permalink: /tutorials/first-api/
description: "Build your first StreetJS API in minutes — install the CLI, scaffold a project, and learn routing, controllers, services, and dependency injection."
---

# Your First StreetJS API

**Level:** Beginner · **Time:** ~15 minutes · **Prerequisites:** Node.js ≥ 20

By the end you will have a running HTTP API with a controller, a service, and
dependency injection — built on Node.js core, no Express.

---

## 1. Install and scaffold

```bash
npm install -g @streetjs/cli
street create hello-street
cd hello-street
npm install
```

This generates a complete project: `src/main.ts`, example controllers, a health
check, Docker files, and a `street.config.ts`. Start it:

```bash
street dev
# [street] Listening on http://0.0.0.0:3000
```

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":1.2,...}
```

---

## 2. Add a controller

Controllers group routes under a path prefix. Create `src/controllers/greeting.controller.ts`:

```typescript
import { Controller, Get, Post } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api/greet')
export class GreetingController {
  @Get('/')
  async hello(ctx: StreetContext): Promise<void> {
    ctx.json({ message: 'Hello from StreetJS!' });
  }

  @Get('/:name')
  async helloName(ctx: StreetContext): Promise<void> {
    const name = ctx.params['name'] ?? 'stranger';
    ctx.json({ message: `Hello, ${name}!` });
  }

  @Post('/')
  async echo(ctx: StreetContext): Promise<void> {
    ctx.json({ received: ctx.body }, 201);
  }
}
```

Register it in `src/main.ts` next to the existing controllers:

```typescript
import { GreetingController } from './controllers/greeting.controller.js';
// ...
app.registerController(GreetingController);
```

Restart and test:

```bash
curl http://localhost:3000/api/greet
# {"message":"Hello from StreetJS!"}

curl http://localhost:3000/api/greet/Alice
# {"message":"Hello, Alice!"}
```

---

## 3. Add a service + dependency injection

Business logic belongs in services. Mark them `@Injectable()` and the IoC
container wires them into controllers automatically. Create
`src/services/greeter.service.ts`:

```typescript
import { Injectable } from 'streetjs';

@Injectable()
export class GreeterService {
  greet(name: string): string {
    return `Hello, ${name}! The time is ${new Date().toISOString()}.`;
  }
}
```

Inject it through the controller constructor:

```typescript
import { Controller, Get, Injectable } from 'streetjs';
import type { StreetContext } from 'streetjs';
import { GreeterService } from '../services/greeter.service.js';

@Injectable()
@Controller('/api/greet')
export class GreetingController {
  constructor(private readonly greeter: GreeterService) {}

  @Get('/:name')
  async helloName(ctx: StreetContext): Promise<void> {
    ctx.json({ message: this.greeter.greet(ctx.params['name'] ?? 'stranger') });
  }
}
```

No manual wiring needed — `app.registerController(GreetingController)` resolves
`GreeterService` from constructor metadata.

> **Important — keep `import 'reflect-metadata'` at the very top of `main.ts`.**
> The metadata polyfill must load before any decorated class, or DI silently
> fails. The scaffold already does this for you.

---

## 4. Read requests, write responses

`StreetContext` is your request/response handle:

```typescript
@Get('/search')
async search(ctx: StreetContext): Promise<void> {
  const q = ctx.query['q'] ?? '';              // ?q=...
  const id = ctx.params['id'];                  // /:id route param
  const auth = ctx.headers['authorization'];    // lowercased header keys
  const body = ctx.body;                        // parsed JSON body

  ctx.json({ q });                              // JSON (default 200)
  // ctx.text('pong');                          // plain text
  // ctx.send(204);                             // empty response
  // ctx.setHeader('X-Request-Id', '...');
}
```

---

## 5. Next steps

- [Building a REST API](/examples/rest-api/) — CRUD, validation, pagination, OpenAPI
- [PostgreSQL Integration](/tutorials/postgresql/) — persist your data
- [Authentication & Authorization](/tutorials/auth/) — JWT, sessions, RBAC, MFA

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `Reflect.getMetadata is not a function` | `import 'reflect-metadata'` is missing or not first in `main.ts`. |
| Controller routes 404 | You forgot `app.registerController(...)`, or the `@Controller` prefix differs from the URL you call. |
| `Cannot resolve <Service>` | The service is not `@Injectable()`, or a circular dependency exists. |
