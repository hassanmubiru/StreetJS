# Architecture — @streetjs/client-offline

## Purpose

`@streetjs/client-offline` supplies the two primitives an offline-first client
needs — a resilient read cache and a durable write outbox — so applications
(and the `@streetjs/client` SDK, React/Tauri/extension/mobile clients) don't
re-implement caching, queuing, retry, and ordering by hand.

## Dependencies

None. Pure TypeScript over `Map`/JSON, with a `browser` export condition. It is
**transport-agnostic** (the app supplies a `fetcher`/`sender`) and
**storage-pluggable** (an `OfflineStore`), matching the framework's
dependency-injection style.

## Design

### OfflineStore

A tiny async `get`/`set`/`delete`/`keys` contract. The default
`MemoryOfflineStore` is for tests/dev; apps wrap `localStorage`, IndexedDB, or
`AsyncStorage` behind the same interface. Both the cache and the outbox persist
through it, so durability is entirely the store's concern.

### OfflineCache

Values are stored as `{ value, expiresAt? }` envelopes under a `cache:` prefix.
`get(key, fetcher)` returns a fresh value if present; otherwise it fetches,
stores, and returns. The offline-first twist: when the fetch **throws** and a
(possibly stale) entry exists, the stale value is returned instead of
propagating the error — the UI keeps working offline. `peek` respects expiry;
`set`/`invalidate` manage entries directly. An injected clock makes TTL
deterministic.

### MutationQueue

A FIFO array persisted as JSON under one key. `enqueue` appends
(de-duplicating by `id`) and stamps `createdAt`. `flush(sender)` replays from the
head:

- `ok` → dequeue, count as sent.
- `drop` (or `attempts >= maxAttempts`) → dequeue, count as dropped, fire
  `onDrop`.
- `retry` (or a thrown sender) → increment `attempts`, persist, and **stop the
  pass** so ordering is preserved (a later mutation never overtakes a stuck
  earlier one).

A `flushing` guard makes concurrent flushes a no-op, preventing double-sends
when both an `online` event and a manual retry fire together. Every state change
is persisted immediately, so a crash mid-flush resumes cleanly.

## Testing

Deterministic via an injected clock and the in-memory store: cache hit/miss/TTL/
stale-on-error/error-propagation, and outbox enqueue/dedupe/order, full drain,
stop-on-transient-failure, thrown-sender-as-retry, permanent drop + `onDrop`,
`maxAttempts` exhaustion, the re-entrancy guard, and empty-flush. Coverage is
≥98% lines / 100% functions / ≥90% branches.

## Non-goals

- No conflict resolution / CRDTs — last-write-wins replay; richer merge is an
  app concern.
- No built-in connectivity detection — the app calls `flush` on its own `online`
  signal (e.g. `window.online`, NetInfo).
- No query result normalization — pair with a client cache/state layer if needed.
