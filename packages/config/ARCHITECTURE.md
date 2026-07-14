# @streetjs/config — Architecture

## Goals

- A single, generic configuration foundation every StreetJS package can build on.
- Zero runtime dependencies (Node.js core only), matching the framework's minimal,
  carefully curated footprint.
- Strongly typed public API; strict TypeScript; no circular dependencies.
- Fail fast at startup with descriptive, aggregated, secret-safe errors.
- Immutable configuration after load; opt-in reload.

## Module layout

```
src/
  types.ts       Shared public types (no internal imports — graph root).
  errors.ts      ConfigError hierarchy + secret-safe ValidationIssue.
  validator.ts   Pure type validators/coercers (string…email, custom). No side effects.
  schema.ts      Typed, chainable Field builder (`s.*`) + Infer<> type inference.
  provider.ts    Provider interface + built-in sources + JSON/YAML/TOML parsers.
  namespace.ts   Prefix-scoped read view + the single serializer (`stringifyConfig`).
  metadata.ts    Immutable per-key metadata registry.
  loader.ts      Merge providers (precedence + provenance) → walk schema → validate.
  config.ts      createConfig() builder + immutable Config (get/has/serialize/freeze/reload).
  index.ts       Curated public API. Internals are not exported.
```

## Dependency graph (acyclic)

```
types  ← errors, validator, schema, provider, metadata, namespace, loader, config
errors ← validator?/no · provider, loader, config
validator ← schema
schema ← loader, config
provider ← loader, config
namespace ← loader (navigate), config          (namespace imports ONLY types)
metadata ← loader, config
loader ← config
config → loader, schema, provider, namespace, metadata, errors, types
index  → everything public
```

The one subtlety worth calling out: a namespace is a *read view* over the root
config, so there is a natural temptation for `config ↔ namespace` to import each
other. We break it by having `namespace.ts` depend **only on the `ConfigReaderCore`
interface in `types.ts`**, and by putting the shared serializer (`stringifyConfig`)
in `namespace.ts` for `config.ts` to import. Direction is one-way: `config → namespace`.

## Data flow (`load()`)

1. **Load** every provider (`Provider.load()`, sync or async).
2. **Merge** provider outputs into one nested object, recording per-path
   **provenance** (which provider set each path). Later providers override earlier;
   nested objects deep-merge, arrays/scalars replace.
3. **Walk** the schema. For each field:
   - present in a source → `validate()` (coerce from string where needed) →
     `applyTransform()` → set value + metadata; on failure, push an issue.
   - absent + has default → validate/coerce the default too (a bad default is a
     startup error, not silent) → set.
   - absent + required → push a "missing required" issue.
   - absent + optional → recorded as known-but-unset (`get` → `undefined`).
4. If any issues, throw one aggregated `ConfigValidationError`. Otherwise deep-freeze
   the resolved values and return an immutable `Config`.

## Secret handling

- A field marked `.secret()` records its dotted path in a `secretPaths` set.
- `serialize()` / `toJSON()` mask those paths (default `********`) unless
  `includeSecrets` is explicitly set.
- Validation issues for secret fields set `invalidValue` to `REDACTED` and mark
  `secret: true`; the error message never renders the value.
- The package never logs values — masking is the caller's only exposure surface.

## Typing strategy

`Field<T>` carries a phantom output type `T`. A schema is a nested shape of fields;
`Infer<Schema>` maps it to the resolved object type. `Config<T>.get(key)` is typed
for top-level keys and returns `unknown` for arbitrary dotted paths (an honest
boundary — full dotted-path typing over arbitrary nesting is intentionally not
attempted). `.optional()` widens a field to `T | undefined`; `.default()` keeps `T`.

## Extension points

- **New sources** implement `Provider { name; load(): object | Promise<object> }`
  and are added via `.provider()`. No core change is required — this is how future
  sources (Vault, cloud parameter stores, remote config) plug in.
- **Custom field types** use `s.custom((raw) => Outcome<T>)` or `.check(fn)` for
  additional constraints on a built-in type.
- **Downstream StreetJS packages** own their schema and export a typed loader (see
  `src/examples/integration.ts`); they depend on `@streetjs/config`, never the
  reverse, so this package stays free of framework cycles.

## Testing

`node --test` over real behavior: validators, loader/merging/precedence, transforms,
custom validators, strict mode, immutability, reload (enabled/disabled, failure keeps
snapshot), namespaces, secret masking, serialization, env conventions, and the
JSON/YAML/TOML parsers exercised against **real temporary fixture files** (no mocks).
