# Changelog

All notable changes to `@streetjs/security` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/security` — the StreetJS security foundation, extracted
  from `streetjs` core as the single source of truth (core now re-exports it).
- `JwtService`: HS256 `sign`/`verify`/`decode` using `node:crypto` only.
- Hardened verification: HS256/JWT header enforcement (algorithm-confusion guard),
  timing-safe signature comparison, and `exp`/`nbf`/`iat` (with clock-skew) plus optional
  `iss`/`aud` validation; fails closed (`null`), never throws.
- `sign` auto-stamps `iat` and applies `expiresInSeconds`/`issuer`/`audience` options.
- Minimum 32-character secret requirement; `JWT_SERVICE` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (15 tests) with ≥90% enforced coverage.
