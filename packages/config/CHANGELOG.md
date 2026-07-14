# Changelog

All notable changes to `@streetjs/config` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-13

Initial release — the configuration foundation for StreetJS.

### Added
- **`createConfig()` builder** with `.schema()`, `.provider()`, `.env()`, `.object()`,
  `.file()` / `.json()` / `.yaml()` / `.toml()`, `.load()`, and `.validate()`.
- **Typed, immutable `Config`**: `get()` (typed top-level + dotted paths), `has()`,
  `keys()`, `namespace()`, `metadata()`, `serialize()`, `toJSON()`, `freeze()`, and
  opt-in `reload()` (disabled by default; a failed reload keeps the current snapshot).
- **Schema builder `s.*`** with field types string, number, boolean, enum, array,
  object, duration, url, path, hostname, ip, email, and custom — each chainable with
  `.default()`, `.optional()`, `.secret()`, `.describe()`, `.check()`, `.transform()`.
  Config type is inferred via `Infer<>`.
- **Sources**: environment variables (prefix + `__` nesting + camelCase + explicit
  map), in-memory objects, and JSON/YAML/TOML files with a documented parser subset.
  Any `Provider` can be added without modifying the package.
- **Deep merge with precedence** (later providers override earlier) and per-key
  **provenance** in metadata.
- **Secret handling**: masked in `serialize()`/`toJSON()`, redacted in errors, never logged.
- **Descriptive, aggregated `ConfigValidationError`** reporting key, source, invalid
  value, expected type, and explanation per failing field; plus `ConfigParseError`
  and `ConfigStateError`.
- **Environment detection** normalizing `NODE_ENV` to
  `development | test | staging | production`.
- Zero runtime dependencies; strict TypeScript; comprehensive test suite (34 tests).
