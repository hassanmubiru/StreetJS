# Street Framework

**Production-grade, memory-safe TypeScript backend framework built on Node.js core modules.**

Street is built entirely from Node.js core — `node:http`, `node:net`, `node:crypto`, `node:stream`, `node:cluster` — plus two carefully chosen dependencies. **No Express. No pg. No Zod. No Prisma.** Every component enforces strict memory bounds and full type safety.

```bash
npm install streetjs
```

> Previously published as `@streetjs/core`. That package still works as a
> deprecated compatibility shim (`npm install @streetjs/core`) that re-exports
> `streetjs` unchanged. See [Migration Guide](docs/migration.md).

```typescript
import 'reflect-metadata';
import { streetApp, Injectable, Controller, Get } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Injectable()
@Controller('/api')
class HelloController {
  @Get('/hello')
  async hello(ctx: StreetContext) {
    ctx.json({ message: 'Hello from street!' });
  }
}

const app = streetApp({ port: 3000 });
app.registerController(HelloController);
await app.listen();
// [street] Listening on http://0.0.0.0:3000
```

```bash
curl http://localhost:3000/api/hello
# {"message":"Hello from street!"}
```

[![CI](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![Core Tests](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?job=build-and-test)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![CLI Tests](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?job=migration-integration)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![Memory Leak Tests](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?job=memory-leak)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![System Tests](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?job=system-tests)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)

[![Security Lint](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?job=security-lint)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![Docker Build](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?job=docker-build)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![Publish](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml/badge.svg?job=test-and-publish)](https://github.com/hassanmubiru/street/actions/workflows/ci-cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub stars](https://img.shields.io/github/stars/hassanmubiru/street)](https://github.com/hassanmubiru/street)
[![npm version](https://img.shields.io/npm/v/@streetjs/core)](https://www.npmjs.com/package/@streetjs/core)
[![npm downloads](https://img.shields.io/npm/dm/@streetjs/core)](https://www.npmjs.com/package/@streetjs/core)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/typescript-%3E%3D5.0-blue)](https://www.typescriptlang.org)
[![package size](https://img.shields.io/bundlephobia/min/@streetjs/core)](https://bundlephobia.com/package/@streetjs/core)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/hassanmubiru/street/badge)](https://securityscorecards.dev/viewer/?uri=github.com/hassanmubiru/street)

## Documentation

[📖 Full documentation site](https://hassanmubiru.github.io/street) — hosted Jekyll site with guides, examples, and API reference.

| Category | Key Pages |
|---|---|
| **Getting started** | [Installation & setup](docs/getting-started/installation.md) · [Your first server](docs/getting-started/first-server.md) · [Configuration](docs/getting-started/configuration.md) · [Project structure](docs/getting-started/project-structure.md) |
| **Core** | [Dependency injection](docs/core/dependency-injection.md) · [Routing](docs/core/routing.md) · [Controllers](docs/core/controllers.md) · [Middleware](docs/core/middleware.md) |
| **Database** | [PostgreSQL wire driver](docs/database/postgres-wire-driver.md) · [Repositories](docs/database/repositories.md) |
| **Security** | [JWT](docs/security/jwt.md) · [Sessions, vault, rate limiter, XSS](docs/security/) |
| **Realtime** | [WebSocket](docs/realtime/websocket.md) · SSE streaming |
| **Performance** | [Telemetry](docs/performance/telemetry.md) · LRU cache · Cluster coordinator |
| **Storage** | [Multipart uploads](docs/storage/multipart-uploads.md) |
| **CLI** | [Commands](docs/cli/commands.md) |
| **Testing** | [Integration tests](docs/testing/integration-tests.md) |
| **Deployment** | [Docker](docs/deployment/docker.md) · [Hosting guide](docs/deployment/hosting-guide.md) |
| **Examples** | [User API](docs/examples/user-api.md) · [Streaming query](docs/examples/streaming-query.md) |

## Monorepo Structure

This repository is an npm workspaces monorepo containing two packages:

| Package | npm | Description |
|---|---|---|
| `packages/core` | [`streetjs`](https://www.npmjs.com/package/streetjs) | Framework library — HTTP server, router, DI container, database driver, security, WebSocket, SSE, clustering, telemetry, caching, multipart uploads |
| `packages/core-compat` | [`@streetjs/core`](https://www.npmjs.com/package/@streetjs/core) | **Deprecated** — backward-compatibility shim that re-exports `streetjs` |
| `packages/cli` | [`@streetjs/cli`](https://www.npmjs.com/package/@streetjs/cli) | CLI tool — project scaffolding, code generation, dev server, build pipeline, migration management |

### Root-level scripts

| Command | Description |
|---|---|
| `npm run build` | Build both packages (core first, then CLI) |
| `npm run build:core` | Build only `packages/core` |
| `npm run build:cli` | Build only `packages/cli` |
| `npm test` | Run core integration tests (requires PostgreSQL) |
| `npm run test:cli` | Run CLI unit tests (no database needed) |
| `npm run coverage:cli` | Run CLI tests with code coverage reporting |
| `npm run lint` | TypeScript type-check on core package |
| `npm run clean` | Clean build output from both packages |
| `npm run lint:workflows` | Validate GitHub Actions YAML syntax |
| `npm run lint:security` | Run zizmor security audit on workflows |

### packages/core

The framework library — the runtime your Street application depends on. Built entirely on Node.js core modules with only two dependencies (`reflect-metadata` and `ws`).

```bash
npm install streetjs
```

Key modules:

| Module | File | Purpose |
|---|---|---|
| **HTTP server** | `src/http/server.ts` | Request/response lifecycle, body parsing, streaming |
| **Router** | `src/router/router.ts` | Path matching, parameters, middleware chain |
| **DI container** | `src/core/container.ts` | Dependency injection with `@Injectable()` decorator |
| **Database** | `src/database/` | PostgreSQL wire protocol, connection pool, repository pattern, migrations |
| **Security** | `src/security/` | JWT, session management, AES-256-GCM vault, rate limiter, XSS sanitization |
| **Realtime** | `src/websocket/` | WebSocket server, SSE streaming |
| **Cluster** | `src/cluster/coordinator.ts` | Multi-core process management |
| **Telemetry** | `src/telemetry/tracker.ts` | Request metrics, memory monitoring |
| **Cache** | `src/cache/lru.ts` | Bounded LRU cache with TTL |
| **Multipart** | `src/multipart/parser.ts` | Streaming file upload parser |
| **Webhook** | `src/webhook/dispatcher.ts` | Outbound webhook delivery |

### packages/cli

The CLI tool for scaffolding, running, and managing Street projects. Installed globally or used via `npx`.

```bash
# Install globally
npm install -g @streetjs/cli

# Or use without installing
npx @streetjs/cli <command>
```

All commands are documented in the [CLI Commands](#cli-commands) section below.

---

## CLI Commands

### `street create <project-name>`

Scaffolds a complete Street project with a production-ready structure.

```bash
street create my-api
cd my-api
npm install
street dev
```

**Options:**

| Flag | Description |
|---|---|
| `--install`, `-i` | Auto-install dependencies after scaffolding |

**Generated structure:**

```
my-api/
├── src/
│   ├── main.ts              # Application entry point
│   ├── controllers/         # HTTP request handlers
│   │   ├── example.controller.ts
│   │   └── health.controller.ts
│   ├── services/            # Business logic layer
│   │   └── example.service.ts
│   ├── repositories/        # Data access layer
│   │   └── example.repository.ts
│   ├── middleware/          # Custom middleware
│   │   └── auth.ts
│   ├── gateways/            # WebSocket handlers
│   │   └── chat.gateway.ts
│   └── tests/               # Test files
│       └── integration.test.ts
├── migrations/              # SQL migrations
├── uploads/                 # File upload storage
├── docker-init/             # PostgreSQL init scripts
├── package.json
├── tsconfig.json
├── street.config.ts
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

---

### `street build`

Compiles TypeScript to JavaScript for production deployment.

```bash
cd my-api
street build
# [street] Building project for production...
# [street] Build completed in 2.3s
# [street] Output: ./dist/
```

Uses the project's `tsconfig.json` and outputs to `./dist/`.

---

### `street dev`

Starts the development server with file watching and hot-reload.

```bash
cd my-api
street dev
```

- Compiles TypeScript on startup
- Starts the server on the configured port (default: `3000`)
- Watches `src/` for file changes
- Automatically recompiles and restarts the server on changes
- Handles `SIGTERM`/`SIGINT` for graceful shutdown

---

### `street start`

Starts the production server from compiled output.

```bash
cd my-api
street build
street start
```

Requires `dist/main.js` to exist (run `street build` first). Sets `NODE_ENV` to `production` by default.

---

### `street test`

Runs the project's test suite using Node's built-in test runner.

```bash
cd my-api
street test
```

- Compiles TypeScript first
- Discovers test files in `dist/tests/`
- Runs tests with `node --test`
- Supports all `node:test` features (TAP output, concurrency, coverage)

---

### `street generate <type> <name>`

Generates controllers, services, and repositories with boilerplate code.

```bash
street generate controller users
street generate service users
street generate repository users
```

**Valid types:** `controller`, `service`, `repository`

**Generated files:**

| Type | Output | Route (controller) |
|---|---|---|
| `controller` | `src/controllers/<name>.controller.ts` | `/api/<plural-name>` |
| `service` | `src/services/<name>.service.ts` | — |
| `repository` | `src/repositories/<name>.repository.ts` | — |

**Name conventions:**

| Input | Class name | File name | Route |
|---|---|---|---|
| `users` | `Users` | `users` | `/api/users` |
| `blog-post` | `BlogPost` | `blog-post` | `/api/blog-posts` |
| `user_profile` | `UserProfile` | `user-profile` | `/api/user-profiles` |

Generated controllers include full CRUD endpoints (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`) with OpenAPI annotations.

---

### `street migrate:create <name>`

Creates a pair of timestamped SQL migration files (up and rollback).

```bash
street migrate:create create_users_table
# [street] Created migration: 20260101120000_create_users_table.sql
# [street] Created rollback:  20260101120000_create_users_table.rollback.sql
```

Migration files are created in the `migrations/` directory with a UTC timestamp prefix for ordering.

---

### `street migrate:run`

Runs all pending SQL migrations in order.

```bash
street migrate:run
```

- Connects to PostgreSQL using environment variables (`PG_HOST`, `PG_PORT`, `PG_DATABASE`, etc.)
- Requires `dist/main.js` to exist (run `street build` first)
- Discovers `.sql` files in `migrations/` directory
- Uses `StreetMigrationRunner` to track applied migrations
- Skips already-applied migrations

---

### Global flags

| Flag | Description |
|---|---|
| `--help`, `-h` | Show help message with all commands |
| `--version`, `-v` | Show CLI version |

---

## Testing

### CLI tests (no database needed)

```bash
# Run all CLI tests (68 tests across 5 suites)
npm run test -w packages/cli

# With code coverage
npm run coverage -w packages/cli
```

All CLI tests are fast unit tests that operate on temporary directories — no PostgreSQL or external services required. Coverage reports are generated in `packages/cli/coverage/` (text, lcov, and HTML formats).

### Core integration tests (requires PostgreSQL)

To run the core integration tests locally:

```bash
./scripts/test-setup.sh
```

Or manually:

```bash
docker-compose up -d postgres
# wait until healthy
PG_HOST=127.0.0.1 PG_PORT=55432 PG_USER=street PG_PASSWORD=street_secret PG_DATABASE=street_test npm run test:run
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete test suite reference, including wire protocol, stress, memory leak, and system tests.
