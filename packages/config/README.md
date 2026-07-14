# @streetjs/config

The configuration foundation for StreetJS: **typed, schema-validated, immutable**
configuration with pluggable sources (environment variables, JSON, YAML, TOML, and
custom providers), namespaces, secret masking, and descriptive startup validation.

**Zero runtime dependencies.** Built on Node.js core only, matching the StreetJS
minimal, carefully curated dependency footprint. Generic and reusable by any
application — not tied to any particular StreetJS package.

```bash
npm install @streetjs/config
```

## Why

Every StreetJS package (runtime-http, auth, database, cache, jobs, metrics, …) and
every application needs the same thing: load configuration from the environment and
files, validate it once at startup with clear errors, expose it as a typed and
immutable object, and never leak secrets. `@streetjs/config` provides exactly that,
once, so each package can declare its own schema and consume a validated result.

## Quick start

```ts
import { createConfig, s, type Infer } from '@streetjs/config';

const config = await createConfig()
  .schema({
    port: s.number({ integer: true, min: 1, max: 65535 }).default(3000),
    logLevel: s.enum(['debug', 'info', 'warn', 'error'] as const).default('info'),
    database: {
      url: s.url({ protocols: ['postgres', 'postgresql'] }).secret(),
      poolSize: s.number({ integer: true, min: 1 }).default(10),
    },
    corsOrigins: s.array(s.url({ protocols: ['https'] })).default([]),
    requestTimeout: s.duration().default(30_000), // milliseconds
  })
  // Sources are applied in order; later sources override earlier ones.
  .json('config.json', { optional: true })
  .env({ prefix: 'APP_' })   // APP_PORT, APP_DATABASE__URL, APP_DATABASE__POOL_SIZE
  .load();                    // validates everything; throws one aggregated error on failure

config.get('port');                          // number (typed)
config.get('database.url');                  // string (dotted path)
config.namespace('database').get('poolSize'); // number
config.serialize({ format: 'flat' });        // secrets masked
```

## Features

- **Typed access** — `get()` is strongly typed from the schema; nested/dotted paths supported.
- **Schema validation** with defaults, required, optional, nested, and custom checks.
- **Immutable after load** — the resolved config is deep-frozen. Opt-in `reload()`.
- **Sources / providers** — env, JSON, YAML, TOML, in-memory objects, and your own.
- **Deep merging + precedence** — later providers override earlier; nested objects merge.
- **Namespaces** — `config.namespace('database')` scopes reads without copying.
- **Secret handling** — secret values are masked in `serialize()`/`toJSON()` and redacted in errors; never logged.
- **Environment detection** — `NODE_ENV` normalized to `development | test | staging | production`.
- **Descriptive errors** — every failing field reports key, source, invalid value, expected type, and a human-readable explanation, aggregated into one error.
- **Value transformation** — `.transform()` post-validation mapping.
- **Metadata** — `config.metadata(path)` reports type, source, secret, required, defaulted.

## Validation types

`s.string`, `s.number`, `s.boolean`, `s.enum`, `s.array`, `s.object`, `s.duration`,
`s.url`, `s.path`, `s.hostname`, `s.ip`, `s.email`, and `s.custom`.

| Field | Coercion / notes |
|---|---|
| `s.string({ minLength, maxLength, pattern, trim })` | trims by default |
| `s.number({ min, max, integer })` | coerces numeric strings |
| `s.boolean()` | accepts `true/false/1/0/yes/no/on/off` |
| `s.enum([...] as const)` | typed literal union |
| `s.array(itemField, { delimiter, minItems, maxItems })` | splits `"a,b,c"` from env |
| `s.object()` | opaque object (use a nested shape for typed nesting) |
| `s.duration()` | `"500ms"`, `"2s"`, `"5m"`, `"1h"`, `"1d"`, or a number → **milliseconds** |
| `s.url({ protocols })` | validates + optional protocol allowlist |
| `s.path()` | non-empty, no null byte |
| `s.hostname()` | RFC-1123 |
| `s.ip(4 \| 6?)` | IPv4/IPv6 (via `node:net`) |
| `s.email()` | pragmatic RFC check |
| `s.custom(validate)` | supply `(raw) => Outcome<T>` |

Chainable on every field: `.default(v)`, `.optional()`, `.secret()`, `.describe(text)`,
`.check(fn)`, `.transform(fn)`.

## Configuration sources

```ts
createConfig()
  .schema(schema)
  .object({ port: 3000 }, 'defaults') // in-memory
  .file('config.toml', { optional: true }) // dispatch by extension
  .json('config.json') .yaml('config.yaml') .toml('config.toml')
  .env({ prefix: 'APP_', nestingDelimiter: '__', map: { DATABASE_URL: 'database.url' } })
  .provider(myCustomProvider) // anything implementing { name, load(): object }
  .load();
```

**Environment convention:** `APP_DATABASE__POOL_SIZE` with prefix `APP_` and delimiter
`__` maps to `database.poolSize` — each segment is camelCased, so `POOL_SIZE` matches a
camelCase schema key. An explicit `map` entry overrides the convention.

**Custom providers** implement a two-member interface; no core changes required:

```ts
import type { Provider } from '@streetjs/config';
const remoteProvider: Provider = {
  name: 'remote',
  async load() { return await fetchConfigFromVault(); }, // returns a nested object
};
```

### Supported file syntax (honest subset)

JSON is parsed natively. YAML and TOML are parsed by dependency-free parsers covering
the common **configuration** subset — documented here so there are no surprises:

- **YAML:** comments, `---` document start, indentation-based nested maps, block
  sequences (`- item`, incl. `- key: value` maps), scalars (string/number/bool/null),
  single/double-quoted strings, and inline flow (`[a, b]`, `{a: 1}`). **Not** supported:
  anchors/aliases, multiline block scalars (`|`, `>`), and multiple documents.
- **TOML:** comments, `[tables]` and `[a.b]` nesting, dotted keys, basic/literal
  strings, integers/floats (with `_`), booleans, single-line arrays, and inline tables.
  **Not** supported: `[[array-of-tables]]`, multiline strings/arrays, and datetimes.

For configuration beyond these subsets, supply the parsed object through a custom
provider (using your preferred parser).

## Secrets

Mark a field `.secret()`. Its value is:

- **masked** in `serialize()` and `toJSON()` (default mask `********`),
- **redacted** (`<redacted>`) in validation errors — the value never appears in a thrown error or its message,
- **never logged** — the package performs no logging of values.

`serialize({ includeSecrets: true })` opts out of masking for trusted local inspection.

## Errors

`load()` throws a single `ConfigValidationError` aggregating **all** failures. Each
`issue` carries `{ key, source, invalidValue, expectedType, message, secret }`. Use
`.validate()` for a non-throwing `{ ok } | { ok: false, issues }` result.

```
Configuration validation failed (2 issues):
  • database.url — required configuration value is missing
      expected: url
      received: (absent)
      source:   default/absent
  • port — value 99999 is above maximum 65535
      expected: number <= 65535
      received: "99999"
      source:   env:port
```

## Public API

`createConfig()` · `.schema()` · `.provider()` / `.env()` / `.file()` / `.object()` ·
`.load()` · `.validate()` · then on the result: `.get()` · `.has()` · `.keys()` ·
`.namespace()` · `.metadata()` · `.serialize()` · `.toJSON()` · `.freeze()` ·
`.reload()` (when enabled).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for module layout and design notes, and
`src/examples/integration.ts` for a package-integration example.

## License

MIT © street contributors
