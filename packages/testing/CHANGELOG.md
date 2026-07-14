# Changelog

All notable changes to `@streetjs/testing` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/testing` — the StreetJS testing foundation.
- `spy()` — a recording test double with `calls`/`callCount`/`called`/`lastCall`,
  deep-equal `calledWith`, and `mockImplementation`/`mockReturnValue`/
  `mockResolvedValue`/`mockRejectedValue`/`reset`.
- `fakeClock()` — a controllable time source exposing `fn: () => number` (the shape the
  foundation packages accept) plus `tick`/`set`/`now`, guarding against moving backwards.
- Async helpers: `deferred()`, `delay()` (unref'd), and `waitFor()` (polls sync/async
  predicates until truthy or timeout).
- `mockFetch()` — a recording, `fetch`-compatible mock accepting a handler, a single
  response, or a sequence; plus `jsonResponse()` and `sequential()` builders.
- `deepEqual()` — structural equality for primitives, arrays, objects, `Date`, `RegExp`.
- Test-runner-agnostic and zero runtime dependencies. Strict TypeScript, ESM,
  tree-shakeable public API.
- Comprehensive test suite (21 tests) with ≥90% enforced coverage.
