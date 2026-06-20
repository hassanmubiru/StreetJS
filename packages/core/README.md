<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="120" height="120">
</p>

<h1 align="center">streetjs</h1>

<p align="center">
  <strong>The TypeScript backend framework — built on Node.js core, not on a pile of dependencies.</strong>
</p>

<p align="center">
  Auth, realtime, native database drivers, jobs, messaging and OpenAPI, included by default.<br>
  No Express. No <code>pg</code>. No Prisma. Just three runtime dependencies (<code>reflect-metadata</code>, <code>ws</code>, <code>zod</code>).
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/streetjs"><img src="https://img.shields.io/npm/v/streetjs?color=2563EB" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/streetjs"><img src="https://img.shields.io/npm/dm/streetjs?color=2563EB" alt="npm downloads"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/license-MIT-64748B.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/node-%3E%3D20-3C873A" alt="Node.js"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/typescript-%3E%3D5.0-3178C6" alt="TypeScript"></a>
</p>

---

## Install

```bash
npm install streetjs
```

**Requirements:** Node.js ≥ 20, TypeScript ≥ 5.0, and `"type": "module"` in your `package.json`.

> Renamed from `@streetjs/core`. The old package still works as a deprecated shim that re-exports `streetjs` unchanged. See the [migration guide](https://hassanmubiru.github.io/StreetJS/migration/).

---

## Quick start

```typescript
import 'reflect-metadata';
import { streetApp, Injectable, Controller, Get, container } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Injectable()
class GreetingService {
  greet(name: string) {
    return `Hello, ${name}!`;
  }
}

@Controller('/api')
class HelloController {
  private readonly svc = container.resolve(GreetingService);

  @Get('/hello')
  async hello(ctx: StreetContext): Promise<void> {
    ctx.json({ message: this.svc.greet('world') });
  }
}

const app = streetApp({ port: 3000, host: '0.0.0.0' });
app.registerController(HelloController);
await app.listen();
// [street] Listening on http://0.0.0.0:3000
```

```bash
curl http://localhost:3000/api/hello
# {"message":"Hello, world!"}
```

### Scaffold a full project (recommended)

```bash
npm install -g @streetjs/cli
street create my-api
cd my-api && npm install && street dev
```

---

## tsconfig.json

StreetJS uses `NodeNext` module resolution and decorator metadata:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true
  }
}
```

---

## Features

Everything below ships in the `streetjs` package — no extra installs.

| Area | Included |
|---|---|
| **Core** | HTTP server, router, dependency injection, middleware, typed context, OpenAPI 3.1 generation, exceptions |
| **Data** | Native PostgreSQL wire driver (SCRAM-SHA-256), native MySQL, SQLite, connection pool, repositories, migrations |
| **Security** | JWT, AES-256-GCM sessions, scrypt vault, RBAC, rate limiting, XSS sanitizer, field-level encryption, runtime input validation (`zod`) |
| **Realtime** | Bounded WebSocket server, Server-Sent Events |
| **Performance** | LRU cache, telemetry (P50/P99), cluster coordinator |
| **I/O** | Streaming multipart uploads, webhook dispatcher |

A first-party ORM ([`@streetjs/orm`](https://www.npmjs.com/package/@streetjs/orm)), messaging transports, observability, and 19 official signed plugins are available across the ecosystem.

---

## A few essentials

**Dependency injection**

```typescript
import { Injectable, container } from 'streetjs';

@Injectable()
class UserService {
  constructor(private readonly db: DatabaseService) {}
}

const svc = container.resolve(UserService);
```

**PostgreSQL (no `pg` dependency)**

```typescript
import { PgPool, container } from 'streetjs';

const pool = new PgPool({
  host: process.env.PG_HOST, port: 5432,
  user: process.env.PG_USER, password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE, maxConnections: 10,
});
await pool.initialize();
container.register(PgPool, pool);

const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
```

**Security**

```typescript
import { JwtService, RateLimiter, authMiddleware, requireRoles } from 'streetjs';

const jwt = new JwtService(process.env.JWT_SECRET!);
const token = jwt.sign({ userId: '123', roles: ['admin'] }, '7d');

app.use(new RateLimiter({ windowMs: 60_000, maxRequests: 100 }).middleware());
app.use(authMiddleware);
app.use(requireRoles('admin'));
```

**WebSocket & SSE**

```typescript
import { StreetWebSocketServer, createSse } from 'streetjs';

const wss = new StreetWebSocketServer({ heartbeatIntervalMs: 30_000, maxConnections: 10_000 });
wss.on('connection', (socket) => socket.on('message', (d) => socket.emit('echo', d)));
wss.broadcast('announcement', { text: 'Hello everyone' });
```

**Exceptions** — throw from anywhere; StreetJS formats the response:

```typescript
import { NotFoundException, BadRequestException } from 'streetjs';
throw new NotFoundException('User not found');
```

---

## Subpath exports (tree-shakeable)

```typescript
import { streetApp }             from 'streetjs';
import { PgPool }                from 'streetjs/pool';
import { JwtService }            from 'streetjs/security';
import { StreetWebSocketServer } from 'streetjs/websocket';
import { LruCache }              from 'streetjs/cache';
import { ClusterCoordinator }    from 'streetjs/cluster';
```

---

## Common environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `PG_HOST` / `PG_PORT` | `localhost` / `5432` | PostgreSQL connection |
| `PG_DATABASE` / `PG_USER` / `PG_PASSWORD` | — | PostgreSQL credentials |
| `JWT_SECRET` | — | JWT signing secret (≥ 32 chars in production) |
| `SESSION_KEY` | — | Session encryption key (≥ 32 chars in production) |
| `NODE_ENV` | `development` | Runtime environment |

---

## Documentation & links

- 📖 [Documentation](https://hassanmubiru.github.io/StreetJS/)
- 🚀 [Getting Started](https://hassanmubiru.github.io/StreetJS/getting-started/)
- 🧩 [Plugins](https://hassanmubiru.github.io/StreetJS/plugins/)
- ⚖️ [Compare vs Express / Fastify / NestJS](https://hassanmubiru.github.io/StreetJS/compare/)
- 💬 [GitHub & Discussions](https://github.com/hassanmubiru/StreetJS)
- 📦 [`@streetjs/cli`](https://www.npmjs.com/package/@streetjs/cli) · [Changelog](https://github.com/hassanmubiru/StreetJS/blob/main/CHANGELOG.md)

## License

MIT © street contributors
