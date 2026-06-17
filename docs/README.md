---
layout: default
title: "StreetJS"
nav_exclude: true
description: "StreetJS — the production-grade, memory-safe TypeScript backend framework for Node.js."
---

# StreetJS

**Production-grade, memory-safe TypeScript backend framework built on Node.js core modules.**

[![CI](https://github.com/hassanmubiru/StreetJS/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/StreetJS/actions)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node.js-20+-green)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

---

## What is StreetJS?

StreetJS is a full-stack TypeScript backend framework that gives you everything needed to build production APIs — without reaching for a single third-party abstraction library. It is built entirely from Node.js core modules (`node:http`, `node:net`, `node:crypto`, `node:stream`, `node:cluster`) plus two carefully chosen dependencies: `reflect-metadata` for decorator metadata and `ws` for WebSocket support.

Every system in StreetJS is engineered with one overriding principle: **bounded memory at all times**. Buffers are capped. Caches are evicted. Streams apply backpressure. Connections are pooled. Secrets are never persisted. This makes StreetJS suitable for long-running production servers without memory leak anxiety.

---

## Key Features

| Feature | Implementation |
|---|---|
| **IoC Container** | Constructor injection, singleton registry, circular dep detection |
| **HTTP Router** | Compiled regex routes, param extraction, pipeline middleware |
| **PostgreSQL Driver** | Pure wire-protocol v3 (no `pg`), streaming row-by-row, backpressure |
| **Repository Pattern** | Generic typed repositories, ACID transactions, migration runner |
| **JWT (HMAC-SHA256)** | Pure `node:crypto`, timing-safe verification |
| **AES-256-GCM Sessions** | Per-request IV, tamper-detection, no plaintext on disk |
| **Vault Mode** | KEK-based config decryption via scrypt + AES-256-GCM |
| **Multipart Uploads** | Streams directly to disk, ≤30 MB heap regardless of file size |
| **WebSocket Server** | Heartbeat, bounded connections, clean teardown |
| **Server-Sent Events** | Heartbeat keep-alive, safe close |
| **LRU Cache** | TTL expiry, bounded count, periodic sweep |
| **Sliding Window Rate Limiter** | BigInt nanosecond precision, stale-entry sweep |
| **XSS Sanitizer** | Recursive deep object sanitization |
| **Telemetry** | Ring-buffer history, P50/P99 latency, heap profiling |
| **Cluster Coordinator** | IPC heartbeat, auto-restart, `node:cluster` only |
| **Webhook Dispatcher** | HMAC-SHA256 signed, retry with exponential backoff |
| **CLI Kernel** | `@Command` decorator, argv parser, DI integration |
| **OpenAPI Generator** | Auto-generated spec from route decorators |

---

## Architecture Philosophy

### Why no `express`, `pg`, `zod`, or `prisma`?

Each abstraction you add is a leak surface, a version conflict, and a maintenance burden. StreetJS trades familiar API comfort for **total control**:

- **No ORM** — You write SQL. The driver executes it row-by-row with backpressure.
- **No validation library** — Schema rules are plain TypeScript objects validated inline.
- **No body-parser** — The server's own stream parser enforces byte caps and never buffers fully.
- **No JWT library** — HMAC-SHA256 with `node:crypto` is 15 lines, not a CVE surface.

### Memory safety is not optional

Every component enforces an upper bound on memory:

- HTTP bodies capped at 1 MB (configurable)
- Upload streams written chunk-by-chunk to disk
- Database results streamed row-by-row, never buffered
- Rate limiter logs bounded per-IP
- Telemetry uses a ring buffer, not an append-only array
- LRU cache evicts LRU on overflow
- WebSocket connections capped at a configurable max
- Webhook queue bounded at 10,000 items

---

## Installation

### Prerequisites

- Node.js ≥ 20
- PostgreSQL ≥ 14
- npm ≥ 9

### Quick install

```bash
git clone https://github.com/hassanmubiru/StreetJS.git my-app
cd my-app
cd packages/core && npm install && npx tsc
```

Or manually:

```bash
npm install
npx tsc
```

### Environment setup

Copy the example env and fill in your values:

```bash
cp .env.example .env
```

```bash
# .env
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=myapp
PG_USER=myapp
PG_PASSWORD=secret

JWT_SECRET=change-this-to-a-random-32-char-minimum-secret
SESSION_KEY=0000000000000000000000000000000000000000000000000000000000000000  # 64 hex chars

# Optional: Vault Mode encrypted config
KEK=my-key-encryption-key
```

---

## Quick Start

A minimal API server in 20 lines:

```typescript
// src/main.ts
import 'reflect-metadata';
import { streetApp } from './http/server.js';
import { container } from './core/container.js';
import { Injectable } from './core/container.js';
import { Controller, Get } from './core/decorators.js';
import type { StreetContext } from './core/context.js';

@Injectable()
@Controller('/api')
class HelloController {
  @Get('/hello')
  async hello(ctx: StreetContext): Promise<void> {
    ctx.json({ message: 'Hello from street!' });
  }
}

const app = streetApp({ port: 3000 });
app.registerController(HelloController);
await app.listen();
```

```bash
npx tsc && node dist/main.js
# [street] Listening on http://0.0.0.0:3000

curl http://localhost:3000/api/hello
# {"message":"Hello from street!"}
```

---

## CLI Usage

street ships with a built-in CLI kernel. Commands run when `process.argv` contains a known command name; otherwise the HTTP server boots.

```bash
# Run database migrations
node dist/main.js migrate

# Create a user
node dist/main.js user:create --email alice@example.com --name Alice --password secret123

# List users
node dist/main.js user:list --page 1 --limit 10

# Show help
node dist/main.js --help
```

---

## Docker Deployment

```bash
# Build
docker build -t my-app:latest .

# Run
docker run -d \
  -p 3000:3000 \
  -e PG_HOST=db \
  -e PG_DATABASE=myapp \
  -e PG_USER=myapp \
  -e PG_PASSWORD=secret \
  -e JWT_SECRET=my-jwt-secret-at-least-32-chars \
  -e SESSION_KEY=64hexchars... \
  my-app:latest
```

The Dockerfile uses a **distroless Node 20** runtime image. The process runs as `nonroot` (UID 65532). No shell, no package manager, minimal attack surface.

---

## Example API

The bundled example implements a full user management API:

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/users` | List users (paginated) |
| `GET` | `/api/users/:id` | Get user by UUID |
| `POST` | `/api/users` | Register new user |
| `POST` | `/api/users/login` | Login, returns JWT |
| `PUT` | `/api/users/:id` | Update user |
| `DELETE` | `/api/users/:id` | Delete user |
| `GET` | `/api/users/:id/stream` | SSE event stream |
| `POST` | `/api/users/upload` | Multipart file upload |
| `GET` | `/api/health` | Health + telemetry |
| `GET` | `/api/metrics` | Latency history |
| `GET` | `/api/openapi.json` | OpenAPI 3.1 spec |

---

## Documentation

| Section | Contents |
|---|---|
| [Getting Started](getting-started/installation.md) | Install, configure, first server |
| [Dependency Injection](core/dependency-injection.md) | `@Injectable`, container, resolution |
| [Routing](core/routing.md) | Route decorators, params, middleware |
| [Controllers](core/controllers.md) | `@Controller`, full handler patterns |
| Validation | Schema validation, field rules (covered in Getting Started) |
| Exception Handling | Typed exceptions, global error handler (covered in First Server) |
| [PostgreSQL Driver](database/postgres-wire-driver.md) | Wire protocol, queries, streaming |
| [Repositories](database/repositories.md) | Generic repository, typed rows |
| Transactions | ACID, `BEGIN`/`COMMIT`/`ROLLBACK` (covered in Repositories) |
| Streaming Results | Backpressure, row-by-row streaming (covered in PostgreSQL Driver) |
| Migrations | SQL migrations, idempotency (covered in CLI) |
| [JWT](security/jwt.md) | Sign, verify, timing-safe |
| Sessions | AES-256-GCM, tamper detection (covered in JWT) |
| Vault Mode | KEK, scrypt key derivation (covered in Configuration) |
| Rate Limiting | Sliding window, BigInt timing |
| XSS Protection | Deep sanitization |
| [WebSocket](realtime/websocket.md) | Events, broadcast, heartbeat |
| SSE | Server-Sent Events, keep-alive (covered in WebSocket) |
| [File Uploads](storage/multipart-uploads.md) | Streaming to disk, cleanup |
| [Telemetry](performance/telemetry.md) | Heap, latency, request tracking |
| Caching | LRU, TTL, eviction |
| Clustering | Workers, IPC heartbeat, restart (covered in Docker) |
| Memory Safety | Principles, bounded behavior (covered in Docker) |
| [CLI](cli/commands.md) | `@Command`, argv, flags |
| [Docker](deployment/docker.md) | Distroless, multi-stage, CI/CD |
| Production | Env vars, security hardening (covered in Docker) |
| CI/CD | GitHub Actions, single workflow (covered in Docker) |
| [Integration Tests](testing/integration-tests.md) | `node:test`, live DB, cleanup |
| [User API Example](examples/user-api.md) | Full CRUD walkthrough |
| [Streaming Query](examples/streaming-query.md) | Large dataset streaming |
| Secure Auth Example | JWT + session auth (covered in User API) |
| WebSocket Chat | Real-time messaging (covered in WebSocket) |
| File Upload Service | Multipart upload (covered in File Uploads) |

---

## License

MIT © street contributors
