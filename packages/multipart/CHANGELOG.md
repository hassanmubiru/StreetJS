# Changelog

All notable changes to `@streetjs/multipart` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/multipart` — the StreetJS multipart/form-data foundation,
  extracted from `streetjs` core as the single source of truth (core now re-exports it;
  the `UploadGuard` policy layer stays in core).
- `MultipartParser`: streams uploaded files directly to disk (bounded ≤ 64 KB writes,
  backpressure-aware), enforces a byte limit **before** buffering, sanitizes filenames to
  a safe charset with a random prefix (directory-traversal safe), caps fields at 64 KB,
  and unlinks partially-written files on failure.
- `BoundedTransform`: a passthrough stream that errors when a byte cap is exceeded.
- `ParsedFile` / `MultipartResult` types.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (12 tests) with enforced coverage (lines/functions/statements
  ≥ 90, branches ≥ 83).
