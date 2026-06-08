---
layout: default
title: Getting Started
nav_order: 2
---

# Getting Started with Street Framework

Street is a TypeScript-first, zero-dependency web framework for Node.js built around a clean HTTP server, type-safe routing, dependency injection, and first-class PostgreSQL support.

## Prerequisites

- Node.js >= 20
- PostgreSQL 16 (for database features)
- TypeScript >= 5.4

## Installation

```bash
npm install @streetjs/core @streetjs/cli
```

Or scaffold a new project using the CLI:

```bash
npx @streetjs/cli create my-app
cd my-app
npm install
```

## Project Structure

A scaffolded Street project has this layout:

```
my-app/
├── src/
│   ├── main.ts           # Entry point
│   ├── controllers/      # @Controller classes
│   ├── services/         # @Injectable services
│   ├── repositories/     # Database repositories
│   └── middleware/       # Custom middleware
├── migrations/           # SQL migration files
├── tests/                # Test suites
├── street.config.ts      # Framework configuration
├── tsconfig.json
└── package.json
```

## Your First Application

```typescript
import { streetApp, Controller, Get } from '@streetjs/core';

@Controller('/hello')
class HelloController {
  @Get('/')
  async greet(ctx) {
    ctx.json({ message: 'Hello from Street!' });
  }
}

const app = streetApp({ port: 3000 });
app.registerController(HelloController);
await app.listen();
```

## Running the Application

```bash
npm run dev     # Development mode with hot reload
npm start       # Production mode
npm test        # Run test suite
```

## Next Steps

- [User Guide](./user-guide.md) — Middleware, routing, authentication
- [API Reference](./api-reference.md) — Complete API documentation
- [CLI Reference](./cli-reference.md) — All CLI commands
- [Security Guide](./security.md) — JWT, sessions, RBAC
