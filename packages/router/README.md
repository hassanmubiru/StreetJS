# @streetjs/router

The StreetJS HTTP router: a compiled-regex router with path-parameter
extraction, a recursive middleware pipeline, request validation, baked RBAC and
per-route rate limiting, optional latency profiling, and ready-made not-found /
error handlers. ESM, strict-TypeScript.

This is the standalone home of the router that also backs the `streetjs/router`
subpath. The `streetjs` framework re-exports this package, so there is a single
source of truth.

## Install

```bash
npm install @streetjs/router @streetjs/context @streetjs/exceptions @streetjs/ratelimit reflect-metadata
```

## Usage

```ts
import { Router, notFoundHandler, errorHandler } from '@streetjs/router';

const router = new Router();

router.add('GET', '/users/:id', [authMiddleware], (ctx) => {
  ctx.json({ id: ctx.params.id });
});

// In your server's request handler:
async function handle(ctx) {
  try {
    const matched = await router.dispatch(ctx); // true if a route ran
    if (!matched) await notFoundHandler(ctx);
  } catch (err) {
    await errorHandler(ctx, err);
  }
}
```

## Routing

`add(method, path, middlewares, handler, validate?, handlerTarget?, handlerMethodName?)`
compiles `path` (with `:param` segments and `*` wildcards) to a regex and
registers it. `dispatch(ctx)` matches on method + path, extracts and URL-decodes
params into `ctx.params`, runs the pipeline, and returns whether a route matched.
A method of `'*'` matches any verb. `listRoutes()` returns the registered
method/pattern pairs (used for OpenAPI generation).

### Pipeline order

For a matched route the pipeline is: **per-route rate limiter → route
middlewares → validation → handler**, executed via a recursive `next()` chain so
any middleware can wrap the rest.

### Baked-in decorators

When `handlerTarget`/`handlerMethodName` are supplied, at **registration time**
the router reads decorator metadata:

- `@Roles` / `@Permissions` → baked onto `ctx.state._requiredRoles` /
  `_requiredPermissions` at dispatch, so an `rbacGuard` needs no prototype-chain
  traversal per request.
- `@RateLimit` (from `@streetjs/ratelimit`) → a route-scoped limiter, keyed by IP
  (default), authenticated user (`key: 'user'`), or API key (`key: 'apiKey'`).

## Validation

Pass a `ValidationSchema` to validate `body`, `query`, and `params` against
`FieldRule`s (`string` with `min`/`max`/`pattern`, `number`, `boolean`, `email`,
`uuid`, and `required`). Failures throw a `BadRequestException` whose `details`
list every problem.

```ts
router.add('POST', '/users', [], createUser, {
  body: {
    name:  { type: 'string', required: true, min: 2, max: 40 },
    email: { type: 'email', required: true },
  },
});
```

## Profiling

Pass a profiler to the constructor to record per-route latency:

```ts
const router = new Router({ profiler }); // profiler.record(method, path, latencyNs, isError)
```

## Handlers

- `notFoundHandler(ctx)` throws a `NotFoundException` naming the route.
- `errorHandler(ctx, err)` serializes a `StreetException` with its status, or
  masks any other error as a generic 500 while reporting the real error (with the
  request's correlation id) via `@streetjs/diagnostics` — internals never leak.

## Example

A complete runnable example lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/router
```

## License

MIT — see [LICENSE](./LICENSE).
