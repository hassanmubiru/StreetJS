# Changelog

All notable changes to `@streetjs/session` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/session` — the StreetJS session foundation, extracted
  from `streetjs` core as the single source of truth (core now re-exports it).
- `SessionManager`: stateless, authenticated-encrypted session tokens using AES-256-GCM
  (`iv | tag | ciphertext`, base64), with `encrypt`/`decrypt` (returns `null` on any
  tamper/wrong-key/malformed input).
- Key validation: 64-char hex (32-byte) key required; low-entropy keys rejected.
- `SessionManager.generateCsrf()` and `SessionManager.generateSessionId()` (base64url,
  from `crypto.randomBytes`).
- `SESSION_MANAGER` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (10 tests) with 100% coverage.
