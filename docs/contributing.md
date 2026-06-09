---
layout:    default
title:     "Contributing"
nav_order: 16
permalink: /contributing/
description: "How to contribute to Street Framework — development setup, testing, pull request process."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Community</span>
<h1>Contributing</h1>
<p>How to set up the development environment, write tests, and submit pull requests.</p>
</div>

Contributions are welcome — bug fixes, documentation improvements, new features, and test coverage. This guide covers the development setup and pull request process.

---

## Development setup

### Prerequisites

- Node.js >= 20
- npm >= 9
- PostgreSQL >= 14 (for integration tests)
- Git

### Clone and install

```bash
git clone https://github.com/hassanmubiru/street.git
cd street
npm install
```

This is an npm workspaces monorepo. `npm install` at the root installs dependencies for both `packages/core` and `packages/cli`.

### Build

```bash
# Build both packages
npm run build

# Build only core
npm run build:core

# Build only CLI
npm run build:cli
```

### Run tests

```bash
# CLI unit tests (no database needed — fast)
npm run test:cli

# Core integration tests (requires PostgreSQL)
docker compose up -d postgres
npm run test:run

# All system tests
npm run test:system
```

---

## Project structure

```
street/
├── packages/
│   ├── core/                  # streetjs — framework runtime
│   │   ├── src/               # TypeScript source
│   │   │   ├── cache/         # LRU cache
│   │   │   ├── cli/           # CLI kernel
│   │   │   ├── cluster/       # Cluster coordinator
│   │   │   ├── core/          # DI container, decorators, context
│   │   │   ├── database/      # PostgreSQL wire driver, pool, repository
│   │   │   ├── http/          # HTTP server, router, exceptions, middleware
│   │   │   ├── multipart/     # File upload parser
│   │   │   ├── security/      # JWT, sessions, vault, rate limiter, XSS
│   │   │   ├── telemetry/     # Metrics tracker
│   │   │   ├── webhook/       # Webhook dispatcher
│   │   │   └── websocket/     # WebSocket server, SSE
│   │   └── tests/             # Integration and system tests
│   └── cli/                   # @streetjs/cli — CLI tool
│       ├── src/
│       │   ├── commands/      # create, dev, build, start, test, generate, migrate
│       │   └── tests/         # CLI unit tests
│       ├── bin/               # street.js entry point
│       └── templates/         # .hbs and .sql templates
├── docs/                      # GitHub Pages documentation (Jekyll)
├── scripts/                   # Release and validation scripts
└── .github/
    ├── actions/setup/         # Reusable checkout+install action
    └── workflows/ci-cd.yml    # CI/CD pipeline
```

---

## Code style

- **TypeScript strict mode** — `noImplicitAny`, `strictNullChecks`, `noUnusedLocals`
- **NodeNext ESM** — explicit `.js` extensions on all imports
- **No `any`** — use `unknown` and narrow with type guards
- **Explicit return types** on all public methods
- **Parameterized queries** — never string-interpolate SQL
- **Named functions** for event listeners (enables `removeListener`)
- **`const` over `let`** where possible

Run the linter:

```bash
npm run lint          # tsc --noEmit on core
npm run lint:workflows  # validate GitHub Actions YAML
```

---

## Testing requirements

All pull requests must:

1. Pass the existing test suite (`npm run test:cli`)
2. Include tests for new functionality
3. Not reduce code coverage below the thresholds (85% for CLI, 60% for core)

### Writing CLI tests

CLI tests use Node's built-in `node:test` runner and operate on temporary directories:

```typescript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CreateCommand } from '../commands/create.js';

describe('MyNewCommand', () => {
  it('does the right thing', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'street-test-'));
    try {
      // ... test logic
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
```

### Writing core tests

Core tests use the same `node:test` runner with a live PostgreSQL connection:

```typescript
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PgPool } from '../database/pool.js';

describe('MyFeature', () => {
  let pool: PgPool;

  before(async () => {
    pool = new PgPool({ /* test config */ });
    await pool.initialize();
  });

  after(async () => {
    await pool.close();
  });

  it('works correctly', async () => {
    const result = await pool.query('SELECT 1 AS n');
    assert.equal(result.rows[0]?.['n'], 1);
  });
});
```

---

## Pull request process

1. **Fork** the repository and create a branch from `main`
2. **Make your changes** — keep commits focused and atomic
3. **Run tests** — `npm run test:cli` must pass
4. **Run lint** — `npm run lint` must pass
5. **Update docs** — if you changed behaviour, update the relevant page in `docs/`
6. **Open a PR** against `main` with a clear description of what changed and why

### PR title format

```
fix: correct pluralization in generate command log message
feat: add street generate middleware command
docs: add WebSocket authentication example
chore: bump streetjs to 1.0.5
```

### What gets reviewed

- Correctness — does it do what it says?
- Memory safety — does it introduce unbounded allocations?
- Type safety — no `any`, no unsafe casts
- Test coverage — is the new code tested?
- Breaking changes — is the public API preserved?

---

## Reporting bugs

Open an issue at [github.com/hassanmubiru/issues](https://github.com/hassanmubiru/issues) with:

- Street version (`street --version`, `npm list streetjs`)
- Node.js version (`node --version`)
- Minimal reproduction (ideally a single file)
- Expected vs actual behaviour
- Error output / stack trace

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](https://github.com/hassanmubiru/blob/main/LICENSE).
