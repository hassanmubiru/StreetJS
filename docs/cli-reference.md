---
layout: default
title: CLI Reference
nav_order: 5
description: "StreetJS CLI reference — create, dev, generate and migrate commands for scaffolding TypeScript backend projects."
---

# CLI Reference

The `@streetjs/cli` package provides the `street` command for scaffolding, migrations, and administrative tasks.

## Installation

```bash
npm install -g @streetjs/cli
# or use npx
npx @streetjs/cli <command>
```

## Commands

### Project Scaffolding

#### `street create <name>`

Scaffold a new Street project.

```bash
street create my-app
street create my-app --template minimal
```

### Database Migrations

#### `street migrate:run`

Run all pending migrations.

```bash
street migrate:run
street migrate:run --dry-run
```

#### `street migrate:rollback`

Roll back the last applied migration.

```bash
street migrate:rollback
```

#### `street migrate:status`

Show migration status.

```bash
street migrate:status
```

#### `street migrate:diff`

Show the diff between current schema and expected entity schema.

```bash
street migrate:diff
```

### Database Seeding

#### `street seed`

Run database seeders.

```bash
street seed
street seed --env development
```

### User Management

#### `street user:create`

Create a new user.

```bash
street user:create --email admin@example.com --role admin
```

### Backup & Restore

#### `street restore --backup-id <id>`

Restore a database backup by ID. Exits with code 1 if checksum verification fails.

```bash
street restore --backup-id 550e8400-e29b-41d4-a716-446655440000
street restore --backup-id <id> --target-url postgres://...
```

### Compliance

#### `street compliance:report`

Generate a compliance report of all entity data annotations.

```bash
street compliance:report
street compliance:report --format json
```

### Audit Log

#### `street audit:export`

Export audit log entries for a date range.

```bash
street audit:export --from 2024-01-01 --to 2024-01-31 --format jsonl
street audit:export --from 2024-01-01 --to 2024-01-31 --format csv > audit.csv
```

### Plugin Management

#### `street plugin:install <name>@<version>`

Install a plugin from the marketplace with signature and checksum verification.

```bash
street plugin:install @streetjs/auth-plugin@1.0.0
```

#### `street plugin:list`

List installed plugins with their load and verification status.

```bash
street plugin:list
```

### Network Plugin Registry

Publish to and install from the [Network Plugin Registry](./plugin-registry.md)
over its `/api/v1` REST API. The registry URL comes from `--registry <url>`, the
`STREET_REGISTRY_URL` environment variable, or defaults to
`http://localhost:8787`. See the
[Publishing Guide](./registry-publishing-guide.md) and the
[Installation Guide](./registry-installation-guide.md) for the full workflow.

#### `street registry publish`

Sign a manifest with an Ed25519 key and publish it (requires a publisher bearer
token via `--token` or `STREET_REGISTRY_TOKEN`).

```bash
street registry publish --manifest ./manifest.json --tarball ./plugin.tgz \
  --key ./publisher.key.pem --token "$STREET_REGISTRY_TOKEN"
```

#### `street registry install <name>[@<version>]`

Download a plugin and verify its manifest checksum, Ed25519 signature, and
tarball checksum before writing it to disk (defaults to the latest version).

```bash
street registry install acme/widgets@1.2.0 --out ./vendor/acme-widgets
```

#### `street registry search [query]` / `street registry list`

Discover plugins with optional `--category`, `--tag`, `--page`, and
`--page-size` filters.

```bash
street registry search widget --category ui
street registry list --page 1 --page-size 25
```

## Global Options

| Flag | Description |
|------|-------------|
| `--help`, `-h` | Show help |
| `--version`, `-v` | Show CLI version |
| `--env <name>` | Set NODE_ENV for the command |
| `--config <path>` | Path to street.config.ts |

## Configuration

The CLI reads `street.config.ts` (or `street.config.js`) in the project root:

```typescript
import { defineConfig } from 'streetjs';

export default defineConfig({
  database: {
    host: process.env.PG_HOST ?? 'localhost',
    port: Number(process.env.PG_PORT ?? 5432),
    database: process.env.PG_DATABASE ?? 'myapp',
    user: process.env.PG_USER ?? 'postgres',
    password: process.env.PG_PASSWORD ?? '',
  },
});
```
