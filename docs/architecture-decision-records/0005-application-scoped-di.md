# ADR 0005: Add application-scoped DI without removing the legacy global

- **Status:** Accepted
- **Date:** 2026-10-19
- **Scope:** `@streetjs/container` and the `streetjs` facade

## Problem

The container was only a process-global singleton. That makes two applications
in one process share registrations and resolved instances, and `reset()` drops
instances without giving resources a deterministic disposal path.

## Existing behavior

`Container.getInstance()` and the exported `container` were the only construction
path. Constructor-injected classes were singleton-cached. Class tokens were the
only supported token shape, although symbols were already used by some
framework services through manual registration patterns.

## Decision

Add an additive application-scoped API:

- `createContainer()` / `new Container()` create isolated containers;
- `registerValue()` and `registerFactory()` accept class, symbol, or string tokens;
- factories support `singleton`, `transient`, and child-`scoped` lifetimes;
- `createScope()` creates an explicit child scope;
- `dispose()` is idempotent and closes/disposes owned singleton/scoped instances;
- `container` and `Container.getInstance()` remain the compatibility global.

Existing `register`, `resolve`, `has`, `reset`, decorators, and class-based
constructor injection remain available.

## Alternatives considered

1. **Replace the global container immediately:** rejected; core controllers and
   existing applications rely on it.
2. **Create a second DI package:** rejected; `@streetjs/container` already owns
   the contract.
3. **Add only a factory while retaining singleton-only behavior:** rejected;
   isolation without explicit lifetimes would leave request/resource ownership
   ambiguous.

## Compatibility impact

The change is additive. Existing global behavior remains unchanged. New
application code can opt into isolated containers. `reset()` remains a legacy
test helper and intentionally does not dispose instances; new application code
should use `dispose()`.

## Migration path

Framework bootstrap can accept or create an application container in a later
bounded change. Existing core wiring continues through the global bridge until
that integration is separately tested. Application authors may construct a
container per app today and register explicit tokens/factories as needed.

## Evidence

Tests cover application isolation, explicit token bindings, singleton/transient/
scoped behavior, child scopes, disposal, idempotence, and post-disposal safety.
