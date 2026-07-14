# Changelog

All notable changes to `@streetjs/http-client` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/http-client` — the StreetJS outbound HTTP client
  foundation over global `fetch`.
- `HttpClient` / `createHttpClient` with `request` plus `get`/`delete`/`head`/`options`
  and body-taking `post`/`put`/`patch`.
- Base URL resolution, URL-encoded query building (arrays repeat the key), and JSON
  ergonomics (object bodies → JSON + `content-type`; `{ json }` to force it).
- Buffered `HttpResponse` with repeatable `text()`/`json<T>()`/`bytes()` and `ok`.
- Per-request timeouts via `AbortController` (combined with a caller `signal`) and
  descriptive `HttpError` (`status` | `network` | `timeout` | `aborted`).
- Retries with exponential backoff + jitter for idempotent methods and standard retriable
  statuses, honoring `Retry-After`; configurable per client or per request.
- Request/response interceptors; `throwOnError` toggle.
- Injectable `fetch` and `sleep` for fully network-free, deterministic tests; an
  `HTTP_CLIENT` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (29 tests) with ≥90% enforced coverage.
