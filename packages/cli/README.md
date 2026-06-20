<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/cli

**CLI for the StreetJS framework — scaffold projects, generate code, run dev server, manage migrations.**

[![CI](https://github.com/hassanmubiru/StreetJS/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/StreetJS/actions/workflows/ci-cd.yml)
[![npm version](https://img.shields.io/npm/v/@streetjs/cli)](https://www.npmjs.com/package/@streetjs/cli)
[![npm downloads](https://img.shields.io/npm/dm/@streetjs/cli)](https://www.npmjs.com/package/@streetjs/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

---

## Install

```bash
npm install -g @streetjs/cli
```

Or use without installing:

```bash
npx @streetjs/cli create my-api
```

---

## Quick start

```bash
street create my-api
cd my-api
npm install
street dev
# [street] Starting development server...
# [street] Listening on http://0.0.0.0:3000
```

---

## Commands

### `street create <project-name>`

Scaffolds a complete, production-ready StreetJS project.

```bash
street create my-api
street create my-api --install    # auto-install dependencies
street create my-api -i           # shorthand
```

**Generated structure:**

```
my-api/
├── src/
│   ├── main.ts                        # Application entry point
│   ├── controllers/
│   │   ├── example.controller.ts      # Example CRUD controller
│   │   └── health.controller.ts       # Health check endpoint
│   ├── services/
│   │   └── example.service.ts         # Business logic layer
│   ├── repositories/
│   │   └── example.repository.ts      # Data access layer
│   ├── middleware/
│   │   └── auth.ts                    # JWT auth + role middleware
│   └── gateways/
│       └── chat.gateway.ts            # WebSocket gateway example
├── tests/
│   └── integration.test.ts            # Integration test suite
├── migrations/                        # SQL migration files
├── uploads/                           # File upload storage
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
- Strict TypeScript with `NodeNext` module resolution
- Full CRUD REST API with OpenAPI annotations
- JWT authentication middleware
- WebSocket gateway
- PostgreSQL repository with parameterized queries
- Multi-stage Dockerfile
- Docker Compose with PostgreSQL
- Integration test scaffold

---

### `street dev`

Starts the development server with hot-reload.

```bash
cd my-api
street dev
```

- Compiles TypeScript on startup
- Starts the server (default port `3000`)
- Watches `src/` for changes with 300ms debounce
- Recompiles and restarts automatically on save
- Handles `SIGTERM`/`SIGINT` for clean shutdown

---

### `street build`

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

### `street start`

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

### `street test`

Runs the project's test suite using Node's built-in test runner.

```bash
cd my-api
street test
```

- Compiles TypeScript first
- Discovers `*.test.js` files in `dist/tests/`
- Runs with `node --test`
- No external test framework required

---

### `street generate <type> <name>`

Generates a controller, service, or repository with full boilerplate.

```bash
street generate controller users
street generate service    users
street generate repository users
```

**Valid types:** `controller`, `service`, `repository`

**Example — `street generate controller users`:**

```typescript
// src/controllers/users.controller.ts
@Controller('/api/users')
export class UsersController {
  @Get('/')    async findAll(ctx: StreetContext): Promise<void> { ... }
  @Get('/:id') async findById(ctx: StreetContext): Promise<void> { ... }
  @Post('/')   async create(ctx: StreetContext): Promise<void> { ... }
  @Put('/:id') async update(ctx: StreetContext): Promise<void> { ... }
  @Delete('/:id') async delete(ctx: StreetContext): Promise<void> { ... }
}
```

**Name conventions:**

| Input | Class | File | Route |
|---|---|---|---|
| `users` | `Users` | `users` | `/api/users` |
| `blog-post` | `BlogPost` | `blog-post` | `/api/blog-posts` |
| `user_profile` | `UserProfile` | `user-profile` | `/api/user-profiles` |
| `category` | `Category` | `category` | `/api/categories` |

---

### `street migrate:create <name>`

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

-- Write your SQL migration here.
-- Example:
--   CREATE TABLE create_users_table (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
--   );
```

---

### `street migrate:run`

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

### Global flags

```bash
street --version    # street v1.0.2
street --help       # show all commands
street -v           # shorthand version
street -h           # shorthand help
```

---

## Generated project — getting started

After `street create my-api`:

```bash
cd my-api

# 1. Copy environment file
cp .env.example .env
# Edit .env with your database credentials

# 2. Start PostgreSQL (Docker)
docker compose up -d postgres

# 3. Install dependencies
npm install

# 4. Run migrations
street migrate:run

# 5. Start dev server
street dev
# → http://localhost:3000

# 6. Test endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api/items
curl http://localhost:3000/openapi.json
```

---

## Generated project — available scripts

| Script | Command | Description |
|---|---|---|
| `npm run dev` | `street dev` | Development server with hot-reload |
| `npm run build` | `street build` | Compile for production |
| `npm run start` | `street start` | Start production server |
| `npm run test` | `street test` | Run test suite |
| `npm run migrate` | `street migrate:run` | Run pending migrations |
| `npm run migrate:create` | `street migrate:create` | Create new migration |

---

## Docker

The generated `Dockerfile` uses a multi-stage build:

```bash
# Build and run with Docker
docker build -t my-api .
docker run -p 3000:3000 --env-file .env my-api

# Or with Docker Compose (includes PostgreSQL)
docker compose up
```

---

## Links

- [Documentation](https://hassanmubiru.github.io/StreetJS)
- [GitHub](https://github.com/hassanmubiru/StreetJS)
- [npm — @streetjs/cli](https://www.npmjs.com/package/@streetjs/cli)
- [npm — streetjs](https://www.npmjs.com/package/streetjs)
- [Changelog](https://github.com/hassanmubiru/StreetJS/blob/main/CHANGELOG.md)

## License

MIT © street contributors
