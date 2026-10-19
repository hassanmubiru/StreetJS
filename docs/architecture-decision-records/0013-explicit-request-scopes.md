# ADR 0013: Expose explicit request-scoped containers through StreetContext

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@streetjs/context`, `streetApp`, and `streetHttp2App`

## Problem

The container supported child scopes, but HTTP requests did not receive one.
There was no framework-supported way to resolve request-lifetime dependencies or
guarantee their cleanup at the end of a request.

## Existing behavior

Controllers are resolved once when registered and remain application-scoped.
`createContext()` exposed request state but no dependency container. Changing
controller resolution to per-request would silently change existing lifetimes.

## Decision

Add opt-in request scopes:

```ts
streetApp({ requestScope: true });
```

When enabled, each HTTP/HTTP2 request receives a child container at
`ctx.container`. Singleton bindings inherit from the application container,
scoped bindings are cached for that request, transient bindings remain
transient, and the request container is disposed after the pipeline. Existing
controller lifetimes are unchanged.

## Alternatives considered

1. **Resolve controllers per request:** rejected; it changes established
   controller singleton behavior.
2. **Put the scope only in `ctx.state`:** rejected; it hides a framework-owned
   dependency contract in an untyped bag.
3. **Enable request scopes by default:** rejected; existing applications may rely
   on current singleton behavior.

## Compatibility impact

Additive. The context package gains a type-only container dependency and an
optional property. Existing `createContext` calls remain valid, and request scope
is disabled by default.

## Migration path

Applications can enable `requestScope`, register scoped factories on the app
container, and resolve them from middleware/handlers through `ctx.container`.

## Evidence

Core integration tests verify that a scoped resource is reused within one request
and disposed after it completes. Build, offline tests, and lint pass.
