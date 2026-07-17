# Changelog

All notable changes to `@streetjs/database` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial release of the StreetJS database meta-package: a single import that
  re-exports the full data layer — `@streetjs/postgres`, `@streetjs/pool`,
  `@streetjs/schema-inspector`, `@streetjs/migrations`, and
  `@streetjs/repository`.
- No logic of its own; a stable aggregate entry point with caret-pinned members.
- 6 tests (accessibility + interop + collision guard), 100% coverage, and a
  runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/database-v1.0.0
