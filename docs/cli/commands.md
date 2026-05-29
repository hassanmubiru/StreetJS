---
layout:    default
title:     "CLI Commands"
parent:    "CLI"
nav_order: 1
permalink: /cli/commands/
---

# CLI Commands

street's CLI kernel enables the same binary to serve as both an HTTP server and a command-line tool. Commands are registered with the `@Command` decorator and resolved through the IoC container.

---

## How dual-mode works

`src/main.ts` inspects `process.argv` at startup:

```typescript
const args = parseArgv(process.argv);

if (args.command !== null) {
  // CLI mode: run the command, then exit
  const cli = new CliKernel({ appName: 'street', version: '1.0.0' });
  cli.register(MigrateCommand);
  cli.register(UserCommand);
  await cli.run(args);
  await pool.close();
  return;
}

// HTTP mode: boot the server
await app.listen();
```

If `argv[2]` matches a registered command name, CLI mode runs. Otherwise, the HTTP server starts. No separate binary needed.

---

## Built-in commands

### `migrate`

Run all pending migrations:

```bash
node dist/main.js migrate
node dist/main.js migrate --dir ./migrations
```

| Flag | Default | Description |
|---|---|---|
| `--dir` | `./migrations` | Path to migrations directory |

Output:

```
[cli] Running migrations from: ./migrations
[migrations] Applying: 001_create_users.sql
[migrations] Applied: 001_create_users.sql
[migrations] Applying: 002_create_sessions_webhooks.sql
[migrations] Applied: 002_create_sessions_webhooks.sql
[migrations] All migrations complete.
[cli] Migrations complete.
```

### `migrate:rollback`

Roll back the last N migrations:

```bash
node dist/main.js migrate:rollback
node dist/main.js migrate:rollback --steps 2
```

| Flag | Default | Description |
|---|---|---|
| `--steps` | `1` | Number of migrations to roll back |
| `--dir` | `./migrations` | Path to migrations directory |

### `user:create`

Create a new user directly:

```bash
node dist/main.js user:create \
  --email alice@example.com \
  --name "Alice Smith" \
  --password "s3cure-p@ssword!"
```

Output:

```
[cli] User created: {
  "id": "a1b2c3d4-...",
  "email": "alice@example.com",
  "name": "Alice Smith",
  "roles": ["user"],
  "createdAt": "2024-01-15T10:23:45.123Z"
}
```

### `user:list`

List all users with pagination:

```bash
node dist/main.js user:list
node dist/main.js user:list --page 2 --limit 10
```

Output:

```
[cli] Users (page 1, total 42):
  a1b2c3d4-... | alice@example.com | Alice Smith
  b2c3d4e5-... | bob@example.com   | Bob Jones
```

### `user:delete`

Delete a user by UUID:

```bash
node dist/main.js user:delete --id a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

---

## Argument parsing

`parseArgv` converts `process.argv` into a structured object:

```typescript
interface ParsedArgs {
  command: string | null;           // First positional argument
  positional: string[];             // Remaining positional arguments
  flags: Record<string, string | boolean>;  // --flag=value or --flag value
}
```

### Examples

```bash
node app.js migrate --dir ./migrations --verbose
# → { command: 'migrate', positional: [], flags: { dir: './migrations', verbose: true } }

node app.js user:create --email a@b.com --name "Alice"
# → { command: 'user:create', positional: [], flags: { email: 'a@b.com', name: 'Alice' } }

node app.js                      # No command → HTTP server mode
# → { command: null, positional: [], flags: {} }

node app.js --version            # Version flag
# → { command: null, positional: [], flags: { version: true } }
```

### Flag parsing rules

| Input | Result |
|---|---|
| `--flag` | `{ flag: true }` |
| `--flag value` | `{ flag: 'value' }` |
| `--flag=value` | `{ flag: 'value' }` |
| `-f` | `{ f: true }` |
| `-f value` | `{ f: 'value' }` |
| `--flag --other` | `{ flag: true, other: true }` |

---

## Writing a custom command

### Step 1: Define the command class

```typescript
// src/cli/commands.ts
import { Injectable } from '../core/container.js';
import { Command } from '../core/decorators.js';
import type { ParsedArgs } from './kernel.js';
import { UserService } from '../services/user.service.js';

@Injectable()
export class ReportCommand {
  constructor(private readonly userService: UserService) {}

  @Command('report:users', 'Generate a user count report by role')
  async userReport(args: ParsedArgs): Promise<void> {
    const format = String(args.flags['format'] ?? 'text');
    const result = await this.userService.findAll(1, 1000);

    const byRole: Record<string, number> = {};
    for (const user of result.items) {
      for (const role of user.roles) {
        byRole[role] = (byRole[role] ?? 0) + 1;
      }
    }

    if (format === 'json') {
      console.log(JSON.stringify({ total: result.total, byRole }, null, 2));
    } else {
      console.log(`Total users: ${result.total}`);
      for (const [role, count] of Object.entries(byRole)) {
        console.log(`  ${role.padEnd(20)} ${count}`);
      }
    }
  }

  @Command('report:health', 'Print database health status')
  async healthReport(args: ParsedArgs): Promise<void> {
    const verbose = Boolean(args.flags['verbose']);
    const pool = container.resolve(PgPool);
    const result = await pool.query('SELECT NOW() AS db_time, version() AS pg_version');
    const row = result.rows[0]!;

    console.log(`Database time: ${row['db_time']}`);
    if (verbose) console.log(`PostgreSQL: ${row['pg_version']}`);
  }
}
```

### Step 2: Register in `main.ts`

```typescript
cli.register(MigrateCommand);
cli.register(UserCommand);
cli.register(ReportCommand);    // ← add your new class
```

### Step 3: Run it

```bash
node dist/main.js report:users
# Total users: 42
#   user                 40
#   admin                2

node dist/main.js report:users --format json
# { "total": 42, "byRole": { "user": 40, "admin": 2 } }

node dist/main.js report:health --verbose
# Database time: 2024-01-15T10:23:45.123Z
# PostgreSQL: PostgreSQL 16.1 on x86_64-pc-linux-gnu, ...
```

---

## Help output

`--help` prints all registered commands:

```bash
node dist/main.js --help

# street v1.0.0
#
# Commands:
#
#   migrate              Run pending database migrations
#   migrate:rollback     Rollback the last N migrations
#   user:create          Create a new user (--email --name --password)
#   user:list            List all users (--page --limit)
#   user:delete          Delete a user by ID (--id <uuid>)
#   report:users         Generate a user count report by role
#   report:health        Print database health status
#
# Flags:
#
#   --help, -h           Show this help
#   --version, -v        Show version
```

---

## Using the CLI in CI/CD

Run migrations as part of the deployment pipeline:

```yaml
# .github/workflows/ci-cd.yml
- name: Run migrations
  run: |
    node dist/main.js migrate
  env:
    PG_HOST: localhost
    PG_DATABASE: myapp
    PG_USER: myapp
    PG_PASSWORD: ${{ secrets.PG_PASSWORD }}
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
    SESSION_KEY: ${{ secrets.SESSION_KEY }}
```

Or in a Docker entrypoint:

```bash
#!/bin/sh
# docker-entrypoint.sh
set -e

echo "Running migrations..."
node dist/main.js migrate

echo "Starting server..."
exec node dist/main.js
```

---

## Environment-aware commands

Commands run with full access to `AppConfig` and all injected services. They follow the same boot sequence as the HTTP server (config loading, pool initialization) — so database connectivity is always available:

```typescript
@Command('seed:demo', 'Seed demo data for development')
async seedDemo(args: ParsedArgs): Promise<void> {
  const config = container.resolve(AppConfig);

  if (config.isProduction) {
    console.error('[cli] Refusing to seed demo data in production!');
    process.exitCode = 1;
    return;
  }

  await this.userService.register({
    email: 'demo@example.com',
    name: 'Demo User',
    password: 'demo-password-123',
  });

  console.log('[cli] Demo data seeded successfully.');
}
```
