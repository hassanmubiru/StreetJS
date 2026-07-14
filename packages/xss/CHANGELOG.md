# Changelog

All notable changes to `@streetjs/xss` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/xss` — the StreetJS input-sanitization foundation,
  extracted from `streetjs` core as the single source of truth (core re-exports it and
  keeps the framework-specific request middleware).
- `sanitizeString`: fixed-point (terminating) removal of angle brackets, `javascript:`/
  `data:`/`vbscript:` protocols, `on*=` event handlers, and null bytes; 1 MB input cap;
  resistant to reconstitution payloads.
- `sanitizeDeep`: recursive sanitization of string values and keys, bounded by depth
  (32), key count (500), array length (10 000); passes primitives/nullish through.
- `escapeHtml`: entity-encodes `& < > " ' /` for safe HTML output.
- Zero runtime dependencies; browser-safe. Strict TypeScript, ESM, tree-shakeable.
- Comprehensive test suite (12 tests) with 100% coverage.
