---
layout:      home
title:       Home
nav_order:   1
permalink:   /
description: "Street Framework — production-grade, memory-safe TypeScript backend framework built on Node.js core modules. No Express. No pg. No Prisma."
---

<div style="text-align:center; padding: 3rem 1rem 2rem;">
  <h1 style="font-size:3rem; font-weight:800; margin-bottom:0.5rem;">Street Framework</h1>
  <p style="font-size:1.35rem; color:#8b949e; max-width:640px; margin:0 auto 2rem;">
    Memory-safe TypeScript backend framework built for production.<br>
    Native Node.js. No Express. No pg. No Prisma.
  </p>
  <div style="display:flex; gap:1rem; justify-content:center; flex-wrap:wrap;">
    <a href="/street/getting-started/installation/" class="btn btn-primary fs-5">Get Started →</a>
    <a href="https://github.com/hassanmubiru/street" class="btn fs-5" target="_blank">GitHub</a>
    <a href="https://www.npmjs.com/package/@streetjs/core" class="btn fs-5" target="_blank">npm</a>
  </div>
  <div style="margin-top:1.5rem; display:flex; gap:0.5rem; justify-content:center; flex-wrap:wrap;">
    <img src="https://img.shields.io/npm/v/@streetjs/core?label=%40streetjs%2Fcore&color=blue" alt="npm version">
    <img src="https://img.shields.io/npm/v/@streetjs/cli?label=%40streetjs%2Fcli&color=blue" alt="npm cli version">
    <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node.js">
    <img src="https://img.shields.io/badge/typescript-%3E%3D5.0-blue" alt="TypeScript">
    <img src="https://img.shields.io/badge/License-MIT-yellow" alt="MIT License">
    <img src="https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg" alt="CI">
  </div>
</div>

---

## Install and run in 60 seconds

```bash
# Install the CLI
npm install -g @streetjs/cli

# Scaffold a project
street create my-api
cd my-api
npm install

# Start the dev server
street dev
# [street] Listening on http://0.0.0.0:3000
```

```bash
curl http://localhost:3000/health
# {"status":"ok","uptime":1.2,"memory":{...}}
```

---

## Why Street?

Street is built entirely from Node.js core modules — `node:http`, `node:net`, `node:crypto`, `node:stream`, `node:cluster` — plus two carefully chosen dependencies (`reflect-metadata` and `ws`). Every component enforces strict memory bounds.

| What you get | How |
|---|---|
| **No Express** | Native `node:http` server with a compiled-regex router |
| **No `pg`** | PostgreSQL wire protocol v3 implemented from scratch over `node:net` |
| **No Prisma / Zod** | Parameterized queries, TypeScript types, `@Validate` decorator |
| **No `jsonwebtoken`** | HMAC-SHA256 via `node:crypto` with `timingSafeEqual` |
| **No `bcrypt`** | `scrypt` via `node:crypto` for password hashing |
| **No `multer`** | Streaming multipart parser — ≤128 KB heap regardless of file size |

---

## Features

<div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(260px,1fr)); gap:1.25rem; margin:1.5rem 0;">

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">🔷 TypeScript First</h3>
Strict mode, <code>NodeNext</code> ESM, decorator metadata, full type inference throughout. No <code>any</code> in the framework source.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">🛡️ Memory-Safe</h3>
Every component has explicit memory bounds — body size limits, bounded connection pools, ring-buffer telemetry, LRU eviction, WebSocket connection caps.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">🐘 Native PostgreSQL</h3>
Wire protocol v3 over <code>node:net</code>. SCRAM-SHA-256 auth. Streaming rows with socket-level backpressure. No <code>pg</code> dependency.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">💉 Dependency Injection</h3>
IoC container with constructor injection, singleton registry, and circular dependency detection — powered by <code>reflect-metadata</code>.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">🔌 WebSockets + SSE</h3>
Bounded WebSocket server with heartbeat and typed event emitter. Server-Sent Events with keep-alive and backpressure.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">🔐 Security Built-in</h3>
JWT (HMAC-SHA256), AES-256-GCM sessions, scrypt vault, sliding-window rate limiter, XSS sanitizer, security headers, CORS.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">📋 OpenAPI 3.1</h3>
Auto-generated spec from <code>@ApiOperation</code> decorators. No separate schema files. Served at <code>/openapi.json</code>.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">⚡ CLI Tooling</h3>
<code>street create</code>, <code>street dev</code>, <code>street generate</code>, <code>street migrate:create</code> — full project lifecycle from one binary.
</div>

<div style="border:1px solid #30363d; border-radius:8px; padding:1.25rem;">
<h3 style="margin-top:0">🔄 Clustering</h3>
<code>node:cluster</code> coordinator with IPC heartbeat, auto-restart on crash, and graceful shutdown.
</div>

</div>

---

## Quick example

```typescript
import 'reflect-metadata';
import {
  streetApp, Injectable, Controller, Get, Post, Delete,
  PgPool, container, securityHeaders, corsMiddleware,
  RateLimiter, JwtService,
} from '@streetjs/core';
import type { StreetContext } from '@streetjs/core';

@Injectable()
class ItemService {
  private items: { id: string; name: string }[] = [];

  findAll() { return this.items; }

  create(name: string) {
    const item = { id: crypto.randomUUID(), name };
    this.items.push(item);
    return item;
  }
}

@Controller('/api/items')
class ItemController {
  private readonly svc = container.resolve(ItemService);

  @Get('/')
  async list(ctx: StreetContext): Promise<void> {
    ctx.json({ items: this.svc.findAll() });
  }

  @Post('/')
  async create(ctx: StreetContext): Promise<void> {
    const { name } = ctx.body as { name: string };
    ctx.json(this.svc.create(name), 201);
  }
}

const app = streetApp({ port: 3000 });
const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });

app.use(securityHeaders);
app.use(corsMiddleware(['*']));
app.use(limiter.middleware());
app.registerController(ItemController);

await app.listen();
```

---

## Memory bounds at a glance

| Component | Bound | Mechanism |
|---|---|---|
| HTTP request body | 1 MB (configurable) | Stream abort on overflow |
| File uploads | Disk only | Streamed chunk-by-chunk, ≤128 KB heap |
| DB result buffer | 256 rows | Socket-level backpressure |
| LRU cache | `maxEntries` cap | O(1) LRU eviction |
| Rate limiter | 100K IPs, 1K timestamps/IP | Periodic stale sweep |
| Telemetry history | 1,440 samples | Ring buffer |
| WebSocket connections | `maxConnections` | Reject with 1013 |
| Connection pool | `maxConnections` | Bounded acquire queue |

---

## Packages

| Package | Version | Description |
|---|---|---|
| [`@streetjs/core`](https://www.npmjs.com/package/@streetjs/core) | [![npm](https://img.shields.io/npm/v/@streetjs/core)](https://www.npmjs.com/package/@streetjs/core) | Framework runtime — HTTP, router, DI, database, security, WebSocket, SSE, clustering |
| [`@streetjs/cli`](https://www.npmjs.com/package/@streetjs/cli) | [![npm](https://img.shields.io/npm/v/@streetjs/cli)](https://www.npmjs.com/package/@streetjs/cli) | CLI — scaffolding, code generation, dev server, migrations |

---

## Documentation

{: .fs-5 }

| Section | Description |
|---|---|
| [Getting Started](/street/getting-started/installation/) | Install, scaffold, configure, run |
| [CLI Reference](/street/cli/commands/) | All `street` commands |
| [Controllers](/street/core/controllers/) | HTTP handlers, routing, context API |
| [Services & DI](/street/core/dependency-injection/) | IoC container, constructor injection |
| [PostgreSQL](/street/database/postgres-wire-driver/) | Wire driver, pool, repositories, migrations |
| [Security](/street/security/) | JWT, sessions, rate limiting, XSS, vault |
| [WebSockets](/street/realtime/websocket/) | Real-time connections, gateways |
| [OpenAPI](/street/core/openapi/) | Auto-generated API spec |
| [Deployment](/street/deployment/docker/) | Docker, production, hosting |
| [Testing](/street/testing/) | Integration tests, test runner |
| [Examples](/street/examples/) | Complete, runnable examples for common use cases |
| [Use Cases](/street/use-cases/) | What can be built — 16 industry verticals with architecture diagrams |
| [FAQ](/street/faq/) | Common questions |

---

## Community

- [GitHub Issues](https://github.com/hassanmubiru/street/issues) — bug reports and feature requests
- [GitHub Discussions](https://github.com/hassanmubiru/street/discussions) — questions and ideas
- [Contributing Guide](/street/contributing/) — how to contribute
- [Changelog](/street/changelog/) — what changed in each release
