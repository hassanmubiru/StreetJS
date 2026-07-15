# Changelog

All notable changes to `@streetjs/container` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS dependency injection container,
  extracted verbatim from the `streetjs` core (`src/core/container.ts`).
- `Container` singleton with `resolve`, `register`, `has`, and `reset`, plus the
  exported `container` instance and `Container.getInstance()`.
- Constructor-injection resolution driven by `design:paramtypes` metadata, with
  singleton caching across the dependency graph.
- Circular-dependency detection reporting the full resolution chain.
- Descriptive errors for unresolvable (interface/primitive/undecorated)
  dependencies, with chain-aware wrapping that avoids double annotation.
- `@Injectable()` class decorator.
- `Constructor<T>` type utility (also re-exported by the framework core).
- `reflect-metadata` as the sole runtime dependency; ESM.
- ≥96% branch coverage and a runnable integration example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/container-v1.0.0
