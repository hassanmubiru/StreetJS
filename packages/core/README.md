# streetjs

**Production-grade, memory-safe TypeScript backend framework built on Node.js core modules.**

No Express. No `pg`. No Prisma. Street is built entirely from `node:http`, `node:net`, `node:crypto`, `node:stream`, and `node:cluster` — plus three carefully chosen dependencies (`reflect-metadata`, `ws`, and `zod` for runtime input validation). Every component enforces strict memory bounds and full type safety.

[![CI](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![npm version](https://img.shields.io/npm/v/streetjs)](https://www.npmjs.com/package/streetjs)
[![npm downloads](https://img.shields.io/npm/dm/streetjs)](https://www.npmjs.com/package/streetjs)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-%3E%3D5.0-blue)](https://www.typescriptlang.org)

---

## Install

```bash
npm install streetjs
```

> **Renamed from `@streetjs/core`.** The old package still works as a deprecated
> compatibility shim (`npm install @streetjs/core`) that re-exports `streetjs`
> unchanged — identical API. See the [migration guide](https://github.com/hassanmubiru/street/blob/main/docs/migration.md).

**Requirements:** Node.js >= 20, TypeScript >= 5.0, `"type": "module"` in your `package.json`.

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

---

## Scaffold a project (recommended)

The fastest way to start is with the CLI:

```bash
npm install -g @streetjs/cli
street create my-api
cd my-api
npm install
street dev
```

See [`@streetjs/cli`](https://www.npmjs.com/package/@streetjs/cli) for all CLI commands.

---

## tsconfig.json requirements

Street uses `NodeNext` module resolution and strict decorators. Your project needs:

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

## Core modules

### HTTP server

```typescript
import { streetApp, securityHeaders, corsMiddleware, xssMiddleware } from 'streetjs';

const app = streetApp({
  port: 3000,
  host: '0.0.0.0',
  requestTimeoutMs: 30_000,
  maxBodyBytes: 1_048_576,   // 1 MB
  uploadsDir: './uploads',
});

// Global middleware
app.use(securityHeaders);
app.use(corsMiddleware(['https://example.com']));
app.use(xssMiddleware);

app.registerController(MyController);
await app.listen();
```

### Routing and controllers

```typescript
import {
  Controller, Get, Post, Put, Delete,
  ApiOperation, Validate,
} from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api/items')
export class ItemController {
  @Get('/')
  @ApiOperation({ summary: 'List items', tags: ['items'] })
  async list(ctx: StreetContext): Promise<void> {
    const page  = parseInt(ctx.query['page']  ?? '1',  10);
    const limit = parseInt(ctx.query['limit'] ?? '20', 10);
    ctx.json({ items: [], total: 0, page, limit });
  }

  @Get('/:id')
  async findOne(ctx: StreetContext): Promise<void> {
    const id = ctx.params['id'];
    ctx.json({ id });
  }

  @Post('/')
  async create(ctx: StreetContext): Promise<void> {
    const body = ctx.body as Record<string, unknown>;
    ctx.json(body, 201);
  }

  @Delete('/:id')
  async remove(ctx: StreetContext): Promise<void> {
    ctx.send(204);
  }
}
```

### Dependency injection

```typescript
import { Injectable, container } from 'streetjs';

@Injectable()
class DatabaseService {
  query(sql: string) { /* ... */ }
}

@Injectable()
class UserService {
  // Constructor injection
  constructor(private readonly db: DatabaseService) {}

  async findAll() {
    return this.db.query('SELECT * FROM users');
  }
}

// Manual registration
container.register(DatabaseService, new DatabaseService());

// Resolution
const svc = container.resolve(UserService);
```

### PostgreSQL (wire protocol — no `pg` dependency)

```typescript
import { PgPool, StreetMigrationRunner, container } from 'streetjs';

const pool = new PgPool({
  host:           process.env['PG_HOST']     ?? 'localhost',
  port:           parseInt(process.env['PG_PORT'] ?? '5432', 10),
  user:           process.env['PG_USER']     ?? 'postgres',
  password:       process.env['PG_PASSWORD'] ?? '',
  database:       process.env['PG_DATABASE'] ?? 'mydb',
  minConnections: 2,
  maxConnections: 10,
  idleTimeoutMs:  30_000,
  acquireTimeoutMs: 5_000,
});

await pool.initialize();
container.register(PgPool, pool);

// Parameterized query
const result = await pool.query(
  'SELECT * FROM users WHERE id = $1',
  [userId]
);

// Run migrations
const runner = new StreetMigrationRunner(pool);
await runner.run('./migrations');
```

### Repository pattern

```typescript
import { Injectable, container, PgPool } from 'streetjs';
import type { PgRow } from 'streetjs';

interface User {
  id: string;
  email: string;
  createdAt: Date;
}

@Injectable()
export class UserRepository {
  private readonly pool = container.resolve(PgPool);

  async findById(id: string): Promise<User | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );
    const row = result.rows[0] as PgRow | undefined;
    if (!row) return null;
    return {
      id:        String(row['id']),
      email:     String(row['email']),
      createdAt: new Date(String(row['created_at'])),
    };
  }

  async create(user: User): Promise<void> {
    await this.pool.query(
      'INSERT INTO users (id, email, created_at) VALUES ($1, $2, $3)',
      [user.id, user.email, user.createdAt.toISOString()]
    );
  }
}
```

### Security

```typescript
import {
  JwtService,
  SessionManager,
  RateLimiter,
  authMiddleware,
  requireRoles,
} from 'streetjs';

// JWT
const jwt = new JwtService(process.env['JWT_SECRET'] ?? 'secret');
const token  = jwt.sign({ userId: '123', roles: ['admin'] }, '7d');
const payload = jwt.verify(token);

// Session (AES-256-GCM)
const sessions = new SessionManager(process.env['SESSION_KEY'] ?? 'key');
const encrypted = sessions.encrypt({ userId: '123' });
const decrypted = sessions.decrypt(encrypted);

// Rate limiting
const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });
app.use(limiter.middleware());

// Auth middleware
app.use(authMiddleware);
app.use(requireRoles('admin'));
```

### Consumer platform security

Hardened building blocks for high-risk consumer apps (dating, social, messaging, marketplaces) — all in the package root, built on `node:crypto` and the pluggable backing-store abstraction. See the full guide: [Consumer Platform Security](https://hassanmubiru.github.io/street/security/consumer-platform/).

```typescript
import { z } from 'zod';
import {
  validate, validated,                       // runtime input validation (rejects bad input before the handler)
  rateLimit,                                  // scoped rate limiting: global / per-IP / per-user
  securityHeadersMiddleware,                  // hardened default security headers
  UploadGuard,                                // magic-byte + size + malware + EXIF-strip upload guard
  Keyring, FieldCipher,                       // AES-256-GCM field-level encryption (envelope + key rotation)
  AbuseEngine,                                // login lockout, signup throttle, password-spray, scoring
  ModerationToolkit,                          // report / block / mute + append-only audit log
  GitHubSecretsProvider, requireSecrets,      // pluggable secret providers + redaction + startup gate
  PrivacyControls,                            // export / delete / retention / consent
} from 'streetjs';

// Validate every external input against a schema; the handler never runs on bad input.
const schemas = {
  body: z.object({ email: z.string().email(), age: z.number().int().min(18) }),
  params: z.object({ id: z.string().uuid() }),
};

router.post('/users/:id', validate(schemas), async (ctx) => {
  const { body, params } = validated(ctx, schemas);   // fully typed from the schemas
  await createUser(params.id, body.email, body.age);
});

// Scoped rate limiting with a human-readable window
router.use(rateLimit({ scope: 'ip', requests: 100, window: '1m' }));

// Field-level encryption at rest (envelope encryption; rotate by adding KEK versions)
const cipher = new FieldCipher(new Keyring([{ version: 1, kek: process.env.KEK_BYTES }]));
const enc = cipher.encrypt('+1-555-0100');
const plain = cipher.decrypt(enc);   // '+1-555-0100' — tamper throws, never returns plaintext
```

Included subsystems: **runtime input validation**, **scoped rate limiting** (in-memory or Redis-backed for multi-instance), **security headers**, **upload guard**, **field-level encryption**, **abuse prevention**, **moderation toolkit**, **pluggable secret providers**, and **privacy controls**. Official dating reference packages compose these primitives: [`@streetjs/dating-auth`](https://www.npmjs.com/package/@streetjs/dating-auth), [`@streetjs/dating-profiles`](https://www.npmjs.com/package/@streetjs/dating-profiles), [`@streetjs/dating-messaging`](https://www.npmjs.com/package/@streetjs/dating-messaging), and [`@streetjs/dating-moderation`](https://www.npmjs.com/package/@streetjs/dating-moderation).

### WebSocket

```typescript
import { StreetWebSocketServer, StreetSocket, container } from 'streetjs';

const wss = new StreetWebSocketServer({
  heartbeatIntervalMs: 30_000,
  maxConnections: 10_000,
});
container.register(StreetWebSocketServer, wss);

// Handle connections
wss.on('connection', (socket: StreetSocket) => {
  socket.on('message', (data: unknown) => {
    socket.emit('echo', data);
  });
});

// Broadcast to all clients
wss.broadcast('announcement', { text: 'Server restarting in 60s' });
```

### Server-Sent Events (SSE)

```typescript
import { createSse } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api/events')
class EventController {
  @Get('/stream')
  async stream(ctx: StreetContext): Promise<void> {
    const sse = createSse(ctx.res);

    const interval = setInterval(() => {
      sse.send({ time: new Date().toISOString() }, 'tick');
    }, 1000);

    ctx.req.once('close', () => {
      clearInterval(interval);
      sse.close();
    });
  }
}
```

### LRU cache

```typescript
import { LruCache } from 'streetjs';

const cache = new LruCache<string, User>({
  maxEntries: 1000,
  ttlMs: 60_000,   // 1 minute TTL
});

cache.set('user:123', user);
const cached = cache.get('user:123');  // User | undefined
cache.delete('user:123');
```

### Telemetry

```typescript
import { TelemetryTracker, telemetryMiddleware } from 'streetjs';

const telemetry = new TelemetryTracker(60_000);  // 1-minute window
app.use(telemetryMiddleware(telemetry));

// Access metrics
const metrics = telemetry.getMetrics();
// { requestCount, p50LatencyMs, p99LatencyMs, heapUsedMb, ... }
```

### Cluster (multi-core)

```typescript
import { ClusterCoordinator } from 'streetjs';

const coordinator = new ClusterCoordinator({
  workers: 4,                  // or os.cpus().length
  restartDelayMs: 1_000,
  maxRestarts: 10,
});

coordinator.start(() => {
  // This runs in each worker process
  bootstrap();
});
```

### Multipart file uploads

```typescript
import { MultipartParser } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Controller('/api/upload')
class UploadController {
  @Post('/')
  async upload(ctx: StreetContext): Promise<void> {
    const parser = new MultipartParser(ctx.req, './uploads');
    const { fields, files } = await parser.parse();
    ctx.json({ fields, files: files.map(f => f.filename) });
  }
}
```

### Webhook dispatcher

```typescript
import { WebhookDispatcher } from 'streetjs';

const dispatcher = new WebhookDispatcher();

await dispatcher.dispatch({
  url:     'https://example.com/webhook',
  secret:  process.env['WEBHOOK_SECRET'] ?? '',
  payload: { event: 'user.created', userId: '123' },
});
```

### OpenAPI spec generation

```typescript
// Auto-generated from @ApiOperation decorators
const spec = app.openApiSpec();

app.use(async (ctx, next) => {
  if (ctx.path === '/openapi.json' && ctx.method === 'GET') {
    ctx.json(spec);
    return;
  }
  await next();
});
```

---

## Middleware

```typescript
import type { StreetContext } from 'streetjs';

// Custom middleware signature
type Middleware = (ctx: StreetContext, next: () => Promise<void>) => Promise<void>;

// Request logger example
const logger: Middleware = async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(`${ctx.req.method} ${ctx.req.url} ${ctx.res.statusCode} ${Date.now() - start}ms`);
};

app.use(logger);
```

---

## Exceptions

```typescript
import {
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
  NotFoundException,
  ConflictException,
  InternalException,
} from 'streetjs';

// Throw from any controller or middleware — Street catches and formats them
throw new NotFoundException('User not found');
throw new BadRequestException('Invalid email address');
throw new UnauthorizedException('Token expired');
```

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP server port |
| `HOST` | `0.0.0.0` | HTTP server host |
| `PG_HOST` | `localhost` | PostgreSQL host |
| `PG_PORT` | `5432` | PostgreSQL port |
| `PG_DATABASE` | `street` | PostgreSQL database name |
| `PG_USER` | `postgres` | PostgreSQL user |
| `PG_PASSWORD` | — | PostgreSQL password |
| `JWT_SECRET` | — | JWT signing secret (min 32 chars in production) |
| `SESSION_KEY` | — | Session encryption key (min 32 chars in production) |
| `NODE_ENV` | `development` | Runtime environment |
| `UPLOADS_DIR` | `./uploads` | File upload directory |
| `MIGRATIONS_DIR` | `./migrations` | SQL migrations directory |

---

## Package exports

All subpath exports are available for tree-shaking:

```typescript
import { streetApp }             from 'streetjs';
import { PgPool }                from 'streetjs/pool';
import { StreetMigrationRunner } from 'streetjs/migrations';
import { JwtService }            from 'streetjs/security';
import { SessionManager }        from 'streetjs/session';
import { RateLimiter }           from 'streetjs/ratelimit';
import { StreetWebSocketServer } from 'streetjs/websocket';
import { LruCache }              from 'streetjs/cache';
import { TelemetryTracker }      from 'streetjs/telemetry';
import { ClusterCoordinator }    from 'streetjs/cluster';
import { MultipartParser }       from 'streetjs/multipart';
import { WebhookDispatcher }     from 'streetjs/webhook';
import { SseConnection }         from 'streetjs/sse';
```

---

## Links

- [Documentation](https://hassanmubiru.github.io/street)
- [GitHub](https://github.com/hassanmubiru/street)
- [npm — streetjs](https://www.npmjs.com/package/streetjs)
- [npm — @streetjs/cli](https://www.npmjs.com/package/@streetjs/cli)
- [Changelog](https://github.com/hassanmubiru/street/blob/main/CHANGELOG.md)
- [Contributing](https://github.com/hassanmubiru/street/blob/main/CONTRIBUTING.md)

## License

MIT © street contributors
