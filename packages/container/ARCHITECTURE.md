# Architecture — @streetjs/container

## Purpose

`@streetjs/container` is the StreetJS inversion-of-control core: a small,
dependency-injection container that other framework layers (controllers,
services, repositories, CLI kernels) use to wire their dependency graphs. It has
a single runtime dependency, `reflect-metadata`, and no coupling to HTTP,
databases, or any other subsystem.

## Design

### A single process-wide singleton

`Container` has a private constructor and a static `instance`. Consumers reach
it via `Container.getInstance()` or the exported `container` binding. A single
registry means a resolved dependency is shared everywhere it is injected — the
framework's services are effectively singletons by default.

Internally the container keeps two maps/sets:

- `singletons: Map<Constructor, object>` — resolved (or pre-registered) instances.
- `resolving: Set<Constructor>` — the tokens currently on the resolution stack,
  used for cycle detection.

### Resolution algorithm

`resolve(token)`:

1. Return the cached singleton if present.
2. If `token` is already in `resolving`, throw a **circular dependency** error
   annotated with the full resolution chain.
3. Add `token` to `resolving`, then read its constructor parameter types from
   the `design:paramtypes` metadata that `emitDecoratorMetadata` emits.
4. Recursively `resolve` each parameter:
   - A missing type or `Object` (interfaces, primitives, undecorated unions
     erase to these) is unresolvable — throw a descriptive error naming the
     chain and pointing at `emitDecoratorMetadata`/`@Injectable`.
   - If a nested resolution throws, wrap the message with the chain — unless it
     is already chain-annotated, in which case it is rethrown unchanged to avoid
     double-wrapping.
5. Construct the instance, cache it, and remove `token` from `resolving` in a
   `finally` so a failed resolution never leaves stale state.

### `@Injectable()`

The decorator writes a marker symbol via `Reflect.defineMetadata`. Its more
important side effect is enabling TypeScript to emit `design:paramtypes` for the
class — the metadata the resolver depends on.

### The `Constructor` type

`Constructor<T> = new (...args: any[]) => T` is the token type used throughout.
It lives here and is re-exported by the `streetjs` framework's `core/types.ts`,
keeping a single definition (dependency inversion, matching how `IpcMessage` and
`TelemetrySample` are sourced from their own packages).

## Relationship to core

The framework's `src/core/container.ts` re-exports this package verbatim, and
`src/core/types.ts` re-exports `Constructor` from it. Core's
`prebuild`/`prebuild:app` hooks compile this package before core, and the
Dockerfile builds it and dereferences the workspace symlink into the runtime
image.

## Testing

The suite runs with no external services: singleton identity, constructor
injection with shared sub-dependencies, cycle detection (via explicit
`design:paramtypes` metadata to avoid forward-reference temporal-dead-zones),
unresolvable-interface errors, failed-construction wrapping, and `reset`
semantics. Branch coverage is ≥96%.

## Non-goals

- No scopes/lifetimes beyond the process singleton (no request/transient scopes).
- No property or method injection — constructor injection only.
- No async factories or conditional bindings.
