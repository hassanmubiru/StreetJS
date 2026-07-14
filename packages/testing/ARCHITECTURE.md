# @streetjs/testing — Architecture

## Goals

- A single, generic set of test doubles/utilities for StreetJS packages and apps.
- Zero runtime dependencies; test-runner-agnostic (no coupling to node:test/Vitest/Jest).
- Plug directly into the injection seams the foundation packages already expose
  (`clock`, `fetch`, `sleep`).
- Strongly typed, interface-first; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  types.ts       Public interfaces: Spy, FakeClock, Deferred, FetchMock, options.
  equal.ts       deepEqual — structural equality used by spy arg matching.
  spy.ts         spy() recording double with mock*/reset/calledWith.
  clock.ts       fakeClock() — controllable time source.
  async.ts       deferred(), delay(), waitFor().
  fetch-mock.ts  mockFetch(), jsonResponse(), sequential().
  index.ts       Curated public API.
```

## Dependency graph (acyclic)

```
types      ← spy, clock, async, fetch-mock
equal      ← spy
spy/clock/async/fetch-mock ← index
index      → everything public
```

Utilities are independent of one another (only `spy` uses `equal`), so consumers import
just what they need and tree-shaking drops the rest.

## Design notes

- **Spy** is a real callable with properties defined via getters (so `callCount`/`called`
  reflect live state). It records `{ args, returned | threw }` per call, re-throws errors,
  and exposes `mockReturnValue`/`mockImplementation`/`mockResolvedValue`/
  `mockRejectedValue`/`reset`. Argument matching uses `deepEqual`.
- **fakeClock** is a plain mutable time source exposing `fn: () => number` — the exact
  shape every foundation package accepts — plus `tick`/`set`/`now`. Moving time backwards
  via `tick` is rejected (a common test mistake); use `set` for absolute jumps.
- **async**: `deferred` exposes resolve/reject; `delay` uses an unref'd timer so it never
  keeps the process alive; `waitFor` polls a (sync or async) predicate until truthy or a
  timeout, resolving with the truthy value.
- **fetch-mock**: `mockFetch` accepts a handler, a single `Response` (cloned per call), or
  an array served in sequence (repeating the last). It records `{ url, init }` and is
  assignable wherever a `fetch`-like function is expected. `jsonResponse` and `sequential`
  are small builders.
- **equal**: structural equality for primitives, arrays, plain objects, `Date`, and
  `RegExp`; other objects fall back to reference equality.

## Boundaries (honest)

- `fakeClock` controls a time *value*; it does not patch global timers (`setTimeout`).
  Packages that accept an injectable `clock` get full determinism; code relying on real
  timers should use `delay`/`waitFor` or its own injection seam.
- `spy` is intentionally minimal (no automatic argument-type inference, no call-order
  assertions across spies); it covers the common recording/stubbing needs without a
  heavy matcher framework.

## Testing

`node --test`: spy recording/errors/`calledWith`/all `mock*`/reset; fake clock
start/tick/set/backwards-guard; deferred resolve/reject; delay timing; `waitFor`
success/timeout/custom-message/async predicate; fetch mock single/handler/sequence/record/
reset; `deepEqual` across all supported kinds; and the barrel exports. Coverage is enforced
at ≥90% (`c8`); the declaration-only `types.ts` is excluded.
