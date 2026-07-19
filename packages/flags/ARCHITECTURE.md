# Architecture — @streetjs/flags

## Position in the framework

`@streetjs/flags` is a **foundation leaf**: a zero-dependency, core-independent
package that owns the *mechanics* of feature gating (targeting, rollouts,
evaluation, registry) but no product knowledge of which flags exist or what they
gate. Applications (and StreetStudio) define flags and consume the registry.

```
types.ts   ← contracts (FlagDefinition, FlagContext, TargetingRule, Rollout, …)
hash.ts    ← fnv1a32 + stableBucket           (pure, dependency-free)
evaluate.ts← evaluateFlag / evaluateFlagDetailed (pure; depends on hash + types)
builders.ts← booleanFlag                       (ergonomic constructor)
registry.ts← FlagRegistry + FlagStore + InMemoryFlagStore (depends on evaluate)
index.ts   ← barrel
```

Module graph is acyclic: `registry → evaluate → hash → (types)`. No module
imports `streetjs` core, so the package is edge- and browser-safe.

## Design decisions

- **Deterministic, dependency-free bucketing.** Percentage rollouts must be
  sticky (a subject keeps its assignment across evaluations and processes) and
  reproducible without I/O. A 32-bit FNV-1a hash over `flagKey:subjectKey`
  mapped to `[0, 100)` (10 000 discrete buckets) achieves this with no
  `node:crypto` dependency, so evaluation runs identically on Node, edge, and
  browser. Mixing the flag key in means the same subject gets independent
  buckets per flag (no cross-flag correlation).

- **Synchronous evaluation, async loading.** Flag checks sit on hot paths, so
  `evaluate` is synchronous against in-memory definitions. Fetching definitions
  from a DB/Redis/config service is the async concern, isolated behind the
  `FlagStore` seam (`InMemoryFlagStore` is the default). This keeps the fast
  path allocation- and await-free while still supporting dynamic flags.

- **Explicit evaluation order with reasons.** Kill switch → rules → rollout →
  default. `evaluateFlagDetailed` returns the `reason` (and rule index / rollout
  bucket) so decisions are auditable and debuggable.

- **Kill switch semantics.** A disabled flag returns `offValue`. For booleans,
  `booleanFlag` sets `offValue: false` so "disabled" unambiguously means "off",
  independent of the fallthrough `default`. For multivariate flags the caller
  picks the safe `offValue` (defaulting to `default`).

- **Unknown flags throw.** `FlagRegistry.evaluate` throws `UnknownFlagError`
  rather than returning a silent `false`, so typos and missing registrations
  surface immediately.

## Testing

`node:test`, fully pure — no I/O, time, or randomness. Covers hashing
determinism/stickiness, every evaluation branch (kill switch, AND/array rules,
catch-all, rollout distribution + fallthrough, precedence), the builder, and the
registry (register/evaluate/toggle/unknown-key/store hydration + reload). 15
tests, 100% line coverage.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in foundation package.
