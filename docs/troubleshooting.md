---
layout: default
title: Troubleshooting
nav_order: 8
---

# Troubleshooting

Common issues and their solutions.

## Database Issues

### `DatabaseConnectionError: connection refused`

The PostgreSQL server is not reachable.

1. Verify the database is running: `pg_isready -h $PG_HOST -p $PG_PORT`
2. Check environment variables: `PG_HOST`, `PG_PORT`, `PG_USER`, `PG_PASSWORD`, `PG_DATABASE`
3. Check firewall rules if using a remote server
4. Verify the user has `CONNECT` privilege: `GRANT CONNECT ON DATABASE myapp TO myuser;`

### `Connection pool wait queue full`

All connections are in use and the wait queue (100 entries max) is full.

- Increase `maxConnections` in `PgPool` options
- Identify slow queries with `QueryProfiler`
- Add read replicas via `ReplicationCoordinator`

### `Connection acquire timeout`

A connection could not be acquired within `acquireTimeoutMs`.

- Default is 5000ms. Increase if queries are slow to complete.
- Monitor pool stats with `pool.size` and `pool.idle`

## Authentication Issues

### `UnauthorizedException: Token expired`

JWT has passed its expiry time.

- Issue a new token using a valid refresh token
- Check that server clock is synchronized (NTP)
- Reduce `expiresIn` for short-lived operations

### `TokenReplayError`

A refresh token was used more than once.

- This is expected security behavior — each refresh token is single-use
- Rotate all refresh tokens for the affected user if you suspect a theft

### `ForbiddenException: Insufficient role`

The authenticated user's roles don't satisfy the required permission.

- Verify `@Roles()` or `@Permissions()` on the endpoint
- Check the user's role assignments in the database

## Performance Issues

### High Memory Usage

Use the built-in diagnostics to identify leaks:

```typescript
import { DiagnosticsReporter } from '@streetjs/core';

const reporter = new DiagnosticsReporter();
reporter.report(); // logs heap, RSS, active handles
```

Enable the memory safety test suite:

```bash
node --max-old-space-size=256 --test packages/core/dist/tests/system/memory-safety.test.js
```

### Slow Requests

Profile route latency:

```typescript
import { RouteProfiler } from '@streetjs/core';

const profiler = new RouteProfiler();
app.use(profiler.middleware());

// After requests:
console.log(profiler.getStats()); // p50, p95, p99 per route
```

Use `QueryProfiler` to find slow database queries:

```typescript
import { ProfiledPool } from '@streetjs/core';

const profiled = new ProfiledPool(pool);
// Use profiled instead of pool — logs all queries slower than threshold
```

## Cache Issues

### `DistributedCache` not propagating invalidations

- Verify all instances use the same `CacheTransport`
- For production, use `RedisTransport` instead of `InProcessCacheTransport`
- Check that `subscribe`/`publish` are working: `transport.subscribe('test', console.log); await transport.publish('test', 'hello')`

## Plugin Issues

### `Invalid marketplace signature`

The plugin package signature did not verify against the bundled public key.

- Only install plugins from the official marketplace
- If using a private registry, set `publicKey` to your registry's signing key
- Report suspicious packages to the Street security team

### `Checksum mismatch`

The downloaded tarball does not match the expected SHA-256 hash.

- This may indicate a tampered package or a network error
- Retry the installation — if it persists, report to the registry

## CI/CD Issues

### `Found TODO comments in packages/core/src/`

The code-hygiene scan found prohibited markers.

- Search for all occurrences: `grep -rn "TODO\|FIXME\|HACK\|@ts-ignore" packages/core/src/`
- Resolve each item before merging to main
- For `@ts-ignore`, replace with `@ts-expect-error // reason for suppression`

### `npm audit` fails on high severity

- Run `npm audit fix` to automatically upgrade affected packages
- For manual fixes: `npm install <package>@<safe-version>`
- Review advisories at https://www.npmjs.com/advisories

## Getting Help

- [GitHub Issues](https://github.com/streetjs/street/issues)
- [Discord Community](https://discord.gg/streetjs)
- [Stack Overflow](https://stackoverflow.com/questions/tagged/streetjs)
