# @streetjs/plugin-mysql

Official StreetJS plugin: **MySQL / MariaDB** connection pool.

Wraps the native, dependency-free `MysqlPool` shipped by `streetjs` — a
from-scratch MySQL protocol client (**no `mysql2`**). The plugin validates
connection config and injects a ready pool into each request.

> The core driver refuses cleartext auth over a non-TLS link by design; use a
> `mysql_native_password` user or TLS for `caching_sha2_password` accounts.

## Install

```bash
npm install @streetjs/plugin-mysql
# or: street add mysql
```

## Configuration

```ts
import { MysqlPlugin } from '@streetjs/plugin-mysql';

const plugin = new MysqlPlugin({
  host: '127.0.0.1', port: 3306,        // port defaults to 3306
  user: 'app', password: process.env.MYSQL_PASSWORD, database: 'app',
  maxConnections: 10,
  stateKey: 'mysql',                    // ctx.state key (default 'mysql')
});
```

| Field | Type | Required | Notes |
|-------|------|:--------:|-------|
| `host` / `user` / `password` / `database` | — | yes | connection |
| `port` | number | no | default 3306 |
| `connectTimeoutMs` | number | no | connect timeout |
| `minConnections` / `maxConnections` | number | no | pool sizing |
| `idleTimeoutMs` / `acquireTimeoutMs` | number | no | pool timeouts |
| `stateKey` | string | no | request-state key (default `mysql`) |

## Usage

```ts
import { Controller, Get } from 'streetjs';
import type { StreetContext, MysqlPool } from 'streetjs';

@Controller('/users')
class UsersController {
  @Get('/:id')
  async getOne(ctx: StreetContext) {
    const mysql = ctx.state['mysql'] as MysqlPool;
    const r = await mysql.query('SELECT id, email FROM users WHERE id = ?', [ctx.params.id]);
    ctx.json(r.rows[0] ?? null);
  }
}
```

## Security

- **Permissions:** `net` and `middleware`. Ed25519-signed manifest verified on install.
- Queries are parameterized (`?`) — never string-interpolate user input.
- No third-party runtime dependencies; the driver is built on Node.js core.

## License

MIT
