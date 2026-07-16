# Changelog

All notable changes to `@streetjs/repository` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0]

### Added

- Initial standalone release of the StreetJS generic repository, extracted
  verbatim from the `streetjs` core (`src/database/repository.ts`).
- `StreetPostgresRepository<T>` abstract base: typed `findById`, `findAll`
  (with clamped pagination), `create`, `update`, `delete`, `count`,
  `withTransaction`, and `streamAll`, all over parameterized SQL with lazy
  table-name validation.
- Optional transparent field-level encryption via a structural `FieldEncryptor`
  hook (`encryptor` + `encryptedEntity`), decoupled from the data-policy module.
- `LedgerTransactionService` for atomic multi-operation transactions.
- Public types: `IRepository<T>`, `FieldEncryptor`.
- Runs on `@streetjs/pool` and `@streetjs/postgres`; ESM. 19 tests (no live
  database) with 100% coverage and a runnable example.

[1.0.0]: https://github.com/hassanmubiru/StreetJS/releases/tag/repository-v1.0.0
