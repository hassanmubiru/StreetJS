# Changelog

All notable changes to `@streetjs/security` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0]

Additive: AES-256-GCM field encryption with key rotation, complementing the
existing HS256 JWT service. Backward-compatible with 1.0.0.

### Added

- **`FieldCipher`** — AES-256-GCM authenticated encryption of individual values
  (PII, transcripts, tokens) at rest, with optional AAD binding a ciphertext to
  a context (e.g. `user:42:email`). Non-deterministic (random 96-bit IV per call).
- **`KeyRing`** — multiple named keys with a designated primary; every token is
  self-describing (carries its key id) so rotation is "add a new primary, keep
  the old keys": new writes use the new key while existing ciphertexts stay
  decryptable. `addKey`, `rotateTo`, `keyIds`, static `keyIdOf`, `tryDecrypt`.
- `generateEncryptionKey` (256-bit hex), `timingSafeStringEqual`, and a typed
  `EncryptionError`. Keys accept 32-byte Buffer / 64-char hex / base64.
- Zero runtime dependencies (`node:crypto` only). 15 new tests (28 total).

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
