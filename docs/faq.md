---
layout:    default
title:     "FAQ"
nav_order: 14
permalink: /faq/
description: "Frequently asked questions about Street Framework."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Reference</span>
<h1>FAQ</h1>
<p>Common questions about installation, TypeScript configuration, PostgreSQL, WebSockets, and deployment.</p>
</div>

---

## General

### What is Street Framework?

Street is a production-grade TypeScript backend framework built entirely on Node.js core modules. It provides an HTTP server, router, dependency injection container, PostgreSQL driver, WebSocket server, security primitives, and a CLI — all without Express, pg, Prisma, or other heavy abstractions.

### Why build another Node.js framework?

Most Node.js frameworks layer abstractions on top of abstractions. Street takes the opposite approach: implement each component directly on Node.js core, enforce strict memory bounds, and expose a clean TypeScript API. The result is a framework where you can read and understand every line of the runtime.

### Is Street production-ready?

Yes. Street is designed for production from the ground up — bounded memory, parameterized queries, SCRAM-SHA-256 PostgreSQL auth, AES-256-GCM sessions, and a comprehensive test suite including memory leak, wire protocol, load, fuzz, chaos, and security tests.

### What are the two dependencies?

- **`reflect-metadata`** — enables TypeScript's `emitDecoratorMetadata` for constructor injection
- **`ws`** — WebSocket framing protocol (Node.js `http.Server` handles upgrades but not framing)

Everything else — HTTP, TLS, streams, crypto, cluster — ships with Node.js.

---

## Installation

### What Node.js version is required?

Node.js **20 or higher**. Street uses `node:test`, top-level `await`, `crypto.randomUUID()`, and other Node 20 APIs.

### What TypeScript version is required?

TypeScript **5.0 or higher** with `NodeNext` module resolution.

### Do I need to install `reflect-metadata` separately?

Yes. Add it to your project:

```bash
npm install reflect-metadata
```

And import it as the **first line** of your entry point:

```typescript
import 'reflect-metadata';  // must be first
import { streetApp } from '@streetjs/core';
```

### Can I use Street without the CLI?

Yes. Install `@streetjs/core` directly and set up your project manually. The CLI (`@streetjs/cli`) is optional tooling.

---

## TypeScript

### Why does Street require `NodeNext` module resolution?

`NodeNext` is the correct module resolution mode for Node.js ESM. It requires explicit `.js` extensions on imports, which matches how Node.js resolves modules at runtime. Other modes (`bundler`, `node16`) have subtle differences that cause issues in production.

### Why do imports use `.js` extensions in `.ts` files?

This is required by `NodeNext` module resolution. TypeScript resolves `.ts` files when it encounters `.js` imports during compilation, but the compiled output uses `.js` — which is what Node.js needs at runtime.

```typescript
// Correct — TypeScript resolves this to user.service.ts during compilation
import { UserService } from './user.service.js';
```

### I'm getting `error TS1240: Unable to resolve signature of class decorator`

Add these to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

---

## Database

### Does Street support databases other than PostgreSQL?

The built-in driver is PostgreSQL-only (wire protocol v3). For other databases, use the database's official Node.js driver and register it manually with the container.

### Do I need to install `pg`?

No. Street implements the PostgreSQL wire protocol directly over `node:net`. There is no `pg` dependency.

### How do I run migrations?

```bash
# Using the CLI
street migrate:create create_users_table
street migrate:run

# Or directly
node dist/main.js migrate
```

### Does Street support connection pooling?

Yes. `PgPool` manages a bounded pool of connections with idle timeout, acquire timeout, and automatic dead connection replacement.

### Are queries safe from SQL injection?

Yes, when you use parameterized queries:

```typescript
// Safe — parameterized
await pool.query('SELECT * FROM users WHERE id = $1', [userId]);

// Unsafe — never do this
await pool.query(`SELECT * FROM users WHERE id = '${userId}'`);
```

---

## WebSockets

### How do I limit WebSocket connections?

Pass `maxConnections` to `StreetWebSocketServer`:

```typescript
const wss = new StreetWebSocketServer({ maxConnections: 10_000 });
```

Connections beyond the limit are rejected with close code 1013 (Try Again Later).

### How do I authenticate WebSocket connections?

Pass a JWT token as a query parameter and validate it in the connection handler:

```typescript
wss.on('connection', (socket, req) => {
  const url = new URL(req.url!, 'http://localhost');
  const token = url.searchParams.get('token');
  if (!token) { socket.close(4001, 'Unauthorized'); return; }
  // verify token...
});
```

---

## Performance

### How does Street handle memory?

Every component has explicit bounds:

| Component | Bound |
|---|---|
| HTTP body | 1 MB default (configurable) |
| File uploads | Disk only — ≤128 KB heap |
| DB results | 256 rows buffered |
| LRU cache | `maxEntries` cap |
| Rate limiter | 100K IPs, 1K timestamps/IP |
| WebSocket connections | `maxConnections` |

### Does Street support clustering?

Yes. Use `ClusterCoordinator` to spawn worker processes:

```typescript
import { ClusterCoordinator } from '@streetjs/core';

const coordinator = new ClusterCoordinator({ workers: 4 });
coordinator.start(() => bootstrap());
```

---

## Deployment

### Can I deploy Street with Docker?

Yes. The generated `Dockerfile` uses a multi-stage build:

```bash
docker build -t my-api .
docker run -p 3000:3000 --env-file .env my-api
```

### Does Street work behind a reverse proxy (nginx, Caddy)?

Yes. Set `HOST=0.0.0.0` and let the proxy handle TLS termination. Trust the `X-Forwarded-For` header for real IP detection in the rate limiter.

### What environment variables are required in production?

At minimum:
- `NODE_ENV=production`
- `JWT_SECRET` — at least 32 random characters
- `SESSION_KEY` — 64-character hex string
- `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, `PG_PASSWORD`

---

## Contributing

### How do I report a bug?

Open an issue at [github.com/hassanmubiru/issues](https://github.com/hassanmubiru/issues) with a minimal reproduction.

### How do I contribute code?

See the [Contributing Guide](/contributing/).

### Is there a roadmap?

See the [Roadmap](/roadmap/).
