---
layout:    default
title:     "CLI Commands"
parent:    "CLI"
nav_order: 1
permalink: /cli/commands/
description: "Complete reference for all street CLI commands — create, dev, build, start, test, generate, migrate."
---

# CLI Commands

Install the CLI globally:

```bash
npm install -g @streetjs/cli
street --version   # street v1.0.3
```

---

## `street create <project-name>`

Scaffolds a complete, production-ready Street project.

```bash
street create my-api
street create my-api --install    # auto-install npm dependencies
street create my-api -i           # shorthand
```

**Generated structure:**

```
my-api/
├── src/
│   ├── main.ts
│   ├── controllers/
│   │   ├── example.controller.ts
│   │   └── health.controller.ts
│   ├── services/
│   │   └── example.service.ts
│   ├── repositories/
│   │   └── example.repository.ts
│   ├── middleware/
│   │   └── auth.ts
│   └── gateways/
│       └── chat.gateway.ts
├── tests/
│   └── integration.test.ts
├── migrations/
├── uploads/
├── docker-init/
│   └── 001_enable_pgcrypto.sql
├── package.json
├── tsconfig.json
├── street.config.ts
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

The generated project includes:
- Strict TypeScript with `NodeNext` ESM
- Full CRUD REST API with OpenAPI annotations
- JWT authentication middleware
- WebSocket gateway
- PostgreSQL repository with parameterized queries
- Multi-stage Dockerfile
- Docker Compose with PostgreSQL

---

## `street dev`

Starts the development server with hot-reload.

```bash
cd my-api
street dev
# [street] Starting development server...
# [street] Listening on http://0.0.0.0:3000
# [street] Watching for file changes...
```

- Compiles TypeScript on startup
- Watches `src/` for changes (300ms debounce)
- Recompiles and restarts automatically on save
- Handles `SIGTERM`/`SIGINT` for clean shutdown

---

## `street build`

Compiles TypeScript for production.

```bash
cd my-api
street build
# [street] Building project for production...
# [street] Build completed in 2.1s
# [street] Output: ./dist/
```

Uses the project's `tsconfig.json`. Output goes to `./dist/`.

---

## `street start`

Starts the production server from compiled output.

```bash
cd my-api
street build
street start
# [street] Starting production server...
# [street] Node env: production
```

Requires `dist/main.js` to exist. Run `street build` first.

---

## `street test`

Runs the project's test suite using Node's built-in test runner.

```bash
cd my-api
street test
```

- Compiles TypeScript first
- Discovers `*.test.js` files in `dist/tests/`
- Runs with `node --test`

---

## `street generate <type> <name>`

Generates a controller, service, or repository with full boilerplate.

```bash
street generate controller users
# [street] Generated controller: src/controllers/users.controller.ts

street generate service users
# [street] Generated service: src/services/users.service.ts

street generate repository users
# [street] Generated repository: src/repositories/users.repository.ts
```

**Valid types:** `controller`, `service`, `repository`

**Name conventions:**

| Input | Class | File | Route (controller) |
|---|---|---|---|
| `users` | `Users` | `users` | `/api/users` |
| `blog-post` | `BlogPost` | `blog-post` | `/api/blog-posts` |
| `user_profile` | `UserProfile` | `user-profile` | `/api/user-profiles` |
| `category` | `Category` | `category` | `/api/categories` |

Generated controllers include full CRUD endpoints (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`) with `@ApiOperation` annotations.

---

## `street migrate:create <name>`

Creates a timestamped SQL migration file pair.

```bash
street migrate:create create_users_table
# [street] Created migration: 20260101120000_create_users_table.sql
# [street] Created rollback:  20260101120000_create_users_table.rollback.sql
```

Files are created in `migrations/` with a UTC timestamp prefix for deterministic ordering.

**Generated up migration:**

```sql
-- Migration: create_users_table
-- Created: 2026-01-01T12:00:00.000Z
-- Description:

-- Write your SQL migration here.
-- Example:
--   CREATE TABLE create_users_table (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   );
```

---

## `street migrate:run`

Runs all pending SQL migrations in order.

```bash
cd my-api
street build
street migrate:run
```

- Connects to PostgreSQL using environment variables
- Tracks applied migrations in a `street_migrations` table
- Skips already-applied migrations (idempotent)
- Runs `.sql` files in timestamp order

**Required environment variables:**

```bash
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=mydb
PG_USER=postgres
PG_PASSWORD=secret
```

---

## Global flags

```bash
street --version    # street v1.0.3
street --help       # show all commands
street -v           # shorthand version
street -h           # shorthand help
```

---

## Using in CI/CD

```yaml
# .github/workflows/deploy.yml
- name: Build
  run: npm run build

- name: Run migrations
  run: street migrate:run
  env:
    PG_HOST: ${{ secrets.PG_HOST }}
    PG_DATABASE: ${{ secrets.PG_DATABASE }}
    PG_USER: ${{ secrets.PG_USER }}
    PG_PASSWORD: ${{ secrets.PG_PASSWORD }}

- name: Start server
  run: street start &
```

---

## Docker entrypoint

```bash
#!/bin/sh
# docker-entrypoint.sh
set -e
echo "Running migrations..."
street migrate:run
echo "Starting server..."
exec street start
```
