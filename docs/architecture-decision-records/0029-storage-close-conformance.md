# ADR 0029: Storage Close Conformance

**Status:** Accepted  
**Scope:** `@streetjs/storage` facade shutdown

## Decision

`Storage.close()` returns one memoized promise per facade instance. Repeated and
concurrent callers observe the same completion, while the existing observability
handle remains responsible for stopping its refresh timer.

## Rationale

Storage facade shutdown is currently synchronous in effect, but the public method
is asynchronous and is used by plugin unload and application cleanup. Memoizing
the promise makes ownership and repeated shutdown behavior explicit without
changing driver APIs or introducing a speculative common lifecycle abstraction.

## Non-goals

- closing provider clients that do not expose a storage-driver close contract;
- changing observability registration or refresh behavior;
- adding cancellation or a storage-specific timeout.

## Evidence

Focused lifecycle coverage asserts shared promise identity and safe repeated close.
