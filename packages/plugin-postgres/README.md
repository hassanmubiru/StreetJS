<p align="center">
  <img src="https://raw.githubusercontent.com/hassanmubiru/StreetJS/main/docs/assets/images/logo-512.png" alt="StreetJS logo" width="100" height="100">
</p>

# @streetjs/plugin-postgres

Official StreetJS plugin: **PostgreSQL** connection pool.

Wraps the native, dependency-free `PgPool` shipped by `streetjs` — a from-scratch
PostgreSQL wire-protocol v3 client with SCRAM-SHA-256 auth (**no `pg`**). The
plugin validates connection config and injects a ready pool into each request.

## Install

```bash
npm install @streetjs/plugin-postgres
# or: street add postgres-plugin
```

## Configuration

```ts
import { PostgresPlugin } from '@streetjs/plugin-postgres';

const plugin = new PostgresPlugin({
  host: '127.0.0.1', port: 5432,
  user: 'app', password: process.env.PGPASSWORD, database: 'app',
  maxConnections: 10,   // optional pool tuning
  stateKey: 'pg',       // ctx.state key (default 'pg')
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `host` / `port` / `user` / `password` / `database` | — | yes | connection |
| `connectTimeoutMs` | number | no | connect timeout |
| `minConnections` / `maxConnections` | number | no | pool sizing |
| `idleTimeoutMs` / `acquireTimeoutMs` | number | no | pool timeouts |
| `stateKey` | string | no | request-state key (default `pg`) |

## Usage

```ts
import { Controller, Get } from 'streetjs';
import type { StreetContext, PgPool } from 'streetjs';

@Controller('/users')
class UsersController {
  @Get('/:id')
  async getOne(ctx: StreetContext) {
    const pg = ctx.state['pg'] as PgPool;
    const r = await pg.query('SELECT id, email FROM users WHERE id = $1', [ctx.params.id]);
    ctx.json(r.rows[0] ?? null);
  }
}
```

## Security

- **Permissions:** `net` and `middleware`. Ed25519-signed manifest verified on install.
- Queries are parameterized (`$1`) — never string-interpolate user input.
- No third-party runtime dependencies; the driver is built on Node.js core.

## License

MIT
