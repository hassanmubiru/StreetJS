# @streetjs/flags

The StreetJS **feature-flag foundation**: typed boolean and multivariate flags
with attribute **targeting rules** and deterministic **percentage rollouts**
(sticky per-subject bucketing), a fast in-memory **registry**, and a pluggable
**store** seam. Zero runtime dependencies — safe on Node, edge runtimes, and in
the browser.

## Install

```sh
npm install @streetjs/flags
```

## Usage

```ts
import { FlagRegistry, booleanFlag } from '@streetjs/flags';

const flags = new FlagRegistry([
  booleanFlag('new-review-player', {
    // Enterprise always on; everyone else via a 25% staged rollout.
    rules: [{ when: { plan: 'enterprise' }, value: true }],
    rollout: { variants: [{ value: true, weight: 25 }] },
  }),
]);

if (flags.isEnabled('new-review-player', { key: userId, attributes: { plan } })) {
  // ...ship the new experience
}
```

### Evaluation order

For each flag, evaluation resolves in this order (with the reason exposed by
`evaluateDetailed`):

1. **`enabled === false`** → `offValue` (a kill switch). `booleanFlag` sets
   `offValue: false`, so a disabled boolean flag is off.
2. **First matching targeting rule** (rules are ordered; first match wins). A
   rule's `when` is an AND of conditions; an array condition matches by
   membership; an empty `when` is a catch-all.
3. **Percentage rollout** — the subject's `key` is hashed with the flag key into
   a stable bucket in `[0, 100)`; the first variant whose cumulative weight
   covers the bucket wins. The same subject always lands in the same bucket
   (sticky), and buckets beyond the total weight fall through.
4. **`default`** otherwise.

### Multivariate flags

```ts
const theme: FlagDefinition<'classic' | 'compact'> = {
  key: 'editor-theme',
  default: 'classic',
  rules: [{ when: { beta: true }, value: 'compact' }],
};
flags.register(theme);
flags.evaluate<'classic' | 'compact'>('editor-theme', { attributes: { beta: true } }); // 'compact'
```

### Loading from a store

Evaluation is synchronous (flag checks belong on hot paths); hydrate definitions
from any backend via the `FlagStore` seam:

```ts
import { FlagRegistry, InMemoryFlagStore } from '@streetjs/flags';

const store = new InMemoryFlagStore(initialDefs); // or your DB/Redis-backed store
const flags = await FlagRegistry.fromStore(store);
// later, on change:
await flags.loadFrom(store);
```

An unknown flag key throws `UnknownFlagError` — a missing flag is a bug, not a
silent `false`.

## API

| Export | Description |
| ------ | ----------- |
| `FlagRegistry` | In-memory registry: `register`, `evaluate`, `evaluateDetailed`, `isEnabled`, `setEnabled`, `has`, `get`, `keys`, `loadFrom`, `fromStore`. |
| `booleanFlag(key, opts)` | Ergonomic boolean-flag builder (off by default; `offValue: false`). |
| `evaluateFlag` / `evaluateFlagDetailed` | Pure evaluation of a `FlagDefinition` against a `FlagContext`. |
| `fnv1a32` / `stableBucket` | Pure, dependency-free hashing used for rollouts. |
| `FlagStore` / `InMemoryFlagStore` | Pluggable definition source + in-memory default. |
| `FLAG_REGISTRY` | DI token for a shared registry. |
| `UnknownFlagError` | Thrown when evaluating an unregistered key. |

## Design notes

- **Deterministic, dependency-free bucketing.** Rollouts use 32-bit FNV-1a over
  `flagKey:subjectKey`, so assignments are sticky and reproducible without any
  crypto/runtime dependency.
- **Framework, not product.** This owns the flag mechanics; *which* flags exist
  and *what they gate* is product code.

## License

MIT — see [LICENSE](./LICENSE).
