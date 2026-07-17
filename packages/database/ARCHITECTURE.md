# Architecture — @streetjs/database

## Purpose

`@streetjs/database` is a **meta-package** (a barrel): it aggregates the five
StreetJS data-layer packages behind one import so applications can depend on a
single name. It exists purely for ergonomics and a stable aggregate entry point;
it contains no runtime logic.

## Dependencies

```
@streetjs/postgres          (wire driver + HA client)
@streetjs/pool              (connection pool)
@streetjs/schema-inspector  (schema introspection)
@streetjs/migrations        (migration runner + differ)
@streetjs/repository        (generic repository + ledger)
```

These are the only dependencies; the deeper graph (`@streetjs/context`,
`@streetjs/container`, `@streetjs/exceptions`, `@streetjs/store`) arrives
transitively through them. No cyclic dependencies.

## Design

`src/index.ts` is a set of `export *` statements — one per re-exported package.
Because the five packages have **disjoint public surfaces** (the only shared type,
`DbResult`, is owned solely by `@streetjs/postgres` and not re-exported by the
others), the barrel produces no ambiguous bindings. The test suite imports a
representative symbol from each package *through the meta-package*, which doubles
as a collision guard: an ambiguous `export *` name would resolve to `undefined`
and fail those assertions.

## Versioning

The meta-package pins its members with caret ranges (`^1.0.0`), so consumers get
compatible minor/patch updates of the underlying packages automatically. When a
member package makes a breaking (major) change, this meta-package takes a major
bump too and widens the corresponding range.

## Testing

Runs with **no live database**: it verifies every re-exported symbol is a real,
accessible binding and that two members (pool-shaped fake + schema inspector)
interoperate through the single import. Coverage of the barrel is 100% (importing
the package executes every re-export statement).

## Non-goals

- No logic, no new API — anything beyond re-exports belongs in one of the member
  packages.
- Not a replacement for the member packages — apps wanting a narrow dependency
  surface should depend on them directly.
