# Changelog

All notable changes to `@streetjs/flags` are documented here.
This project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0]

### Added
- Initial release of the StreetJS feature-flag foundation.
- Typed `FlagDefinition<T>` with a kill switch (`enabled`/`offValue`), ordered
  attribute **targeting rules** (AND conditions, array membership, catch-all),
  and deterministic **percentage rollouts** with sticky per-subject bucketing.
- `evaluateFlag` / `evaluateFlagDetailed` — pure evaluation returning the value
  (and the `reason`: `disabled` / `rule` / `rollout` / `default`).
- `fnv1a32` / `stableBucket` — pure, dependency-free hashing for rollouts
  (edge/browser-safe; no `node:crypto`).
- `FlagRegistry` — fast synchronous in-memory registry (`register`, `evaluate`,
  `evaluateDetailed`, `isEnabled`, `setEnabled`, `has`, `get`, `keys`) with
  async hydration via `loadFrom` / `fromStore`.
- `FlagStore` seam + `InMemoryFlagStore` default; `UnknownFlagError` on unknown
  keys; `booleanFlag` builder (off by default); `FLAG_REGISTRY` DI token.
- Zero runtime dependencies; ESM + `browser` export. 15 tests, 100% line
  coverage, runnable example.
