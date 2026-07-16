# Architecture — @streetjs/router

## Purpose

`@streetjs/router` is the StreetJS request-dispatch core: it maps an incoming
method + path to a compiled route, runs a middleware pipeline over the
`StreetContext`, and applies validation, RBAC, and rate limiting. It sits just
below `http/server` (which owns transport, body parsing, and lifecycle) and is
the last framework layer that is a clean, standalone extraction.

## Dependencies

```
@streetjs/context    (StreetContext + MiddlewareFn)
@streetjs/exceptions (BadRequest/NotFound + isStreetException)
@streetjs/diagnostics (diagnosticsReporter — leak-safe error reporting)
@streetjs/ratelimit  (RateLimiter + getRateLimitMeta for @RateLimit baking)
reflect-metadata     (reads @Roles/@Permissions/@RateLimit metadata)
```

No cyclic dependencies — every dependency is lower in the graph. Two couplings
were resolved structurally to keep the package clean:

- `ValidationSchema` / `FieldRule` are **owned here** (the router holds the only
  runtime validation logic); the framework core re-exports them.
- `RouteProfiler` is a **structural interface** (`record(method, pathTemplate,
  latencyNs, isError)`) so the router needs no dependency on the diagnostics
  route-profiler — the framework's concrete profiler satisfies it.

## Design

### Compile-once routing

`add` compiles the path template into a `RegExp` plus an ordered list of param
names (escaping regex metacharacters, turning `:name` into a capture group and
`*` into `(.*)`). Matching walks the routes in registration order, honoring a
`'*'` wildcard method, and URL-decodes captured params into `ctx.params`.

### Registration-time baking

RBAC and rate-limit metadata are read from the handler's decorators **once, at
`add` time**, not per request: roles/permissions are stored on the compiled
route and copied to `ctx.state` on dispatch, and a `@RateLimit` produces a
route-scoped limiter middleware (keyed by IP, user, or API key). This keeps the
hot dispatch path free of reflection.

### Pipeline

`dispatch` assembles `[rateLimitMw?, ...middlewares, validation?, handler]` and
runs it through a recursive `runPipeline`/`next()` chain, so any middleware can
short-circuit or wrap the remainder. When a profiler is configured, dispatch
brackets the pipeline with `process.hrtime.bigint()` and records latency plus an
error flag in a `finally`.

### Validation

`createValidationMiddleware` checks `body`/`query`/`params` against the schema
and throws a `BadRequestException` carrying every failure message; a non-object
body is skipped rather than rejected.

### Handlers

`notFoundHandler` throws a `NotFoundException`; `errorHandler` renders a
`StreetException` with its status and JSON body, and otherwise reports the real
error (with correlation id) via `@streetjs/diagnostics` while returning a generic
500 — internals never reach the client.

## Testing

Runs with **no HTTP server** using a fake `StreetContext`: matching, param
extraction/decoding, wildcards, pipeline ordering, the full validation matrix,
RBAC baking, `@RateLimit` baking for all three key modes, profiler recording
(success + error), `listRoutes`, and both handlers (with stderr stubbed for the
masked-500 path). Coverage is ≥99% lines / 100% functions and ≥89% branches
(declared floor 88%).

## Non-goals

- No transport, body parsing, or server lifecycle (that is `http/server`).
- No decorator definitions (`@Get`/`@Post`/`@Roles` live in core); the router
  only *reads* their metadata.
- No OpenAPI generation beyond exposing `listRoutes`.
