---
layout:    default
title:     "Installation"
parent:    "Getting Started"
nav_order: 1
permalink: /getting-started/installation/
description: "Install StreetJS and scaffold a production TypeScript backend in 60 seconds — npm install streetjs, with PostgreSQL, JWT and Docker included."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Getting Started</span>
<h1>Installation</h1>
<p>Get StreetJS running in under 60 seconds — prerequisites, install, configure, and run.</p>
</div>

This guide walks you through getting a street server running from zero, explains every configuration decision, and prepares you for production deployment.

---

## Prerequisites

| Requirement | Minimum Version | Notes |
|---|---|---|
| Node.js | 20.0.0 | Uses `node:test`, `--test`, top-level `await` |
| npm | 9.0.0 | Workspaces support |
| TypeScript | 5.4.0 | `NodeNext` module resolution |
| PostgreSQL | 14.0 | Wire protocol v3 (used since PG 7.4) |

Check your versions:

```bash
node --version   # v20.x.x or higher
npm --version    # 9.x.x or higher
psql --version   # psql (PostgreSQL) 14.x or higher
```

---

## Step 1: Clone or scaffold

### From the repository

```bash
git clone https://github.com/hassanmubiru/StreetJS.git my-api
cd my-api
```

### From scratch (manual setup)

```bash
mkdir my-api && cd my-api
npm init -y
```

Then copy `package.json` and `tsconfig.json` from this repo.

---

## Step 2: Install dependencies

street has exactly **three runtime dependencies**:

```bash
npm install reflect-metadata ws zod
npm install --save-dev typescript @types/node @types/ws
```

Why only three? Everything else — HTTP server, TLS, streams, crypto, cluster — ships with Node.js. External abstractions introduce version skew and CVE surfaces. street keeps the dependency tree auditable at a glance.

**`reflect-metadata`** — Enables TypeScript's `emitDecoratorMetadata` to record constructor parameter types at runtime. This is the only way to perform constructor injection without explicit token registration.

**`ws`** — A battle-tested, low-level WebSocket implementation. Node's built-in `http.Server` supports upgrades but not the WebSocket framing protocol itself.

**`zod`** — Runtime schema validation. Provides type-safe parsing/validation of untrusted input (request bodies, config, env) that TypeScript's compile-time types cannot enforce at runtime.

---

## Step 3: Build

```bash
# Using the provided script (recommended)
npm install && npx tsc

# Or manually
npx tsc
```

The framework ships with a `street-build.sh` script that runs `npm ci` and `npx tsc`. You can use it from the core package:

```bash
cd packages/core
bash street-build.sh
```

Or build manually:

```bash
npm ci
npx tsc
mkdir -p dist/uploads
```

### What gets compiled

TypeScript source in `src/` and `tests/` is compiled to `dist/`. The output mirrors the source directory:

```
src/main.ts           → dist/main.js
src/http/server.ts    → dist/http/server.js
tests/integration.test.ts → dist/tests/integration.test.js
```

All imports use `.js` extensions even in `.ts` source files — this is required by the `NodeNext` module resolution standard. The TypeScript compiler resolves `.ts` files when encountering `.js` imports during compilation.

---

## Step 4: Configure environment

Create a `.env` file (never commit this):

```bash
# Server
PORT=3000
HOST=0.0.0.0
NODE_ENV=development

# Database
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=myapp_dev
PG_USER=myapp
PG_PASSWORD=your-database-password

# Security — MUST be changed in production
JWT_SECRET=replace-with-random-32-plus-char-string-here!!
SESSION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# Optional directories
UPLOADS_DIR=./uploads
MIGRATIONS_DIR=./migrations
```

Load it before starting:

```bash
# Using dotenv (dev only, not required in production)
node --env-file=.env dist/main.js

# Or export manually
export $(cat .env | xargs) && node dist/main.js
```

### Generating a SESSION_KEY

The session key must be a 64-character hex string representing 32 random bytes:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# e.g.: a3f8c2d1e9b047623a5f18d7e4c0b291f8e3a72d10c5b468f92e1d3a07b4c985
```

### Generating a JWT_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## Step 5: Create the database

```bash
createdb myapp_dev
# or
psql -c "CREATE DATABASE myapp_dev;"
```

Run migrations to create the schema:

```bash
node dist/main.js migrate
# [migrations] Applying: 001_create_users.sql
# [migrations] Applied: 001_create_users.sql
# [migrations] Applying: 002_create_sessions_webhooks.sql
# [migrations] Applying: 002_create_sessions_webhooks.sql
# [migrations] All migrations complete.
```

---

## Step 6: Start the server

```bash
node dist/main.js
# [street] Listening on http://0.0.0.0:3000
```

Test it:

```bash
curl http://localhost:3000/api/health
# {"status":"ok","uptime":2.1,"pid":12345,...}
```

---

## Development workflow

During development, rebuild on every save:

```bash
# Terminal 1: Watch TypeScript
npx tsc --watch

# Terminal 2: Run server (auto-restarts with Node 22 --watch)
node --watch dist/src/main.js
```

Or combine with a single command:

```bash
npx tsc && node dist/src/main.js
```

---

## TypeScript configuration explained

The `tsconfig.json` uses strict settings that enforce production-quality code:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUnusedLocals": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

| Option | Why it matters |
|---|---|
| `"module": "NodeNext"` | Enables ESM with explicit `.js` extensions — matches Node 22 native ESM |
| `"moduleResolution": "NodeNext"` | Required companion to `NodeNext` module |
| `"strict": true` | Enables all strict checks as a group |
| `"noUnusedLocals": true` | Prevents dead code accumulation |
| `"experimentalDecorators": true` | Required for `@Controller`, `@Injectable` etc. |
| `"emitDecoratorMetadata": true` | Emits `design:paramtypes` metadata — required for constructor injection |

**Why `emitDecoratorMetadata` matters:** Without it, `Reflect.getMetadata('design:paramtypes', MyService)` returns `undefined` and the IoC container cannot resolve constructor dependencies automatically.

---

## Verifying the installation

Run the integration test suite against a live PostgreSQL instance:

```bash
PG_HOST=localhost PG_USER=myapp PG_PASSWORD=secret PG_DATABASE=myapp_dev \
  JWT_SECRET=test-secret-at-least-32-chars-here \
  SESSION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  node --test dist/tests/integration.test.js
```

Expected output:

```
▶ IoC Container
  ✔ resolves a class with no dependencies (1.2ms)
  ✔ resolves nested dependencies (0.8ms)
  ✔ returns singleton on repeated resolve (0.3ms)
  ...
▶ PostgreSQL Wire Protocol
  ✔ connects to PostgreSQL (45ms)
  ✔ executes a simple query (3ms)
  ...
```

All 13 test suites should pass.

---

## Common installation issues

### `Cannot find module 'reflect-metadata'`

```bash
npm install reflect-metadata
```

Make sure `import 'reflect-metadata'` is the **first** line of your entry point (`src/main.ts`). It must execute before any decorator runs.

### `SyntaxError: Cannot use import statement`

Your code is running as CommonJS. Check:
1. `package.json` has `"type": "module"`
2. `tsconfig.json` has `"module": "NodeNext"`
3. You are running `node dist/...` not `ts-node` without ESM config

### `Error: PostgreSQL connection timeout`

Check that PostgreSQL is running and the credentials match:

```bash
psql -h localhost -U myapp -d myapp_dev -c "SELECT 1"
```

If connecting to Docker:

```bash
docker run -d \
  --name pg \
  -e POSTGRES_USER=myapp \
  -e POSTGRES_PASSWORD=secret \
  -e POSTGRES_DB=myapp_dev \
  -p 5432:5432 \
  postgres:16-alpine
```

### `error TS2339: Property 'defineMetadata' does not exist on type 'typeof Reflect'`

Add the reflect-metadata type shim. Create `src/reflect-shim.d.ts`:

```typescript
declare namespace Reflect {
  function defineMetadata(key: unknown, value: unknown, target: object): void;
  function getMetadata(key: unknown, target: object): unknown;
}
```

This is included in the framework source and loaded automatically via `tsconfig.json`'s `include` glob.
