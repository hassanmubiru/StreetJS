# Changelog

All notable changes to `@streetjs/exceptions` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS HTTP exception hierarchy, extracted
  verbatim from the `streetjs` core (`src/http/exceptions.ts`).
- `StreetException` base class with `status`, `message`, optional `details`, and
  a stable `toJSON()` wire shape.
- Typed subclasses: `BadRequestException` (400), `UnauthorizedException` (401),
  `ForbiddenException` (403), `NotFoundException` (404), `ConflictException`
  (409), `UnprocessableException` (422), `InternalException` (500),
  `FeatureUnavailableInEdgeRuntimeError` (501), `ServiceUnavailableException`
  (503), and `DatabaseConnectionError` (503, with an operator `suggestion`).
- `isStreetException` type guard.
- Zero runtime dependencies; ESM; `browser` export condition.
- 100% test coverage and a runnable integration example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/exceptions-v1.0.0
