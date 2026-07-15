# Changelog

All notable changes to `@streetjs/webhook-dispatcher` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-15

### Added

- Initial release of `@streetjs/webhook-dispatcher` — the StreetJS outbound webhook
  dispatcher, extracted from `streetjs` core as the single source of truth (core now
  re-exports it via the `streetjs/webhook` subpath). Distinct from `@streetjs/webhooks`
  (a generic sign/verify library).
- `WebhookDispatcher`: SSRF-hardened, HTTPS-only delivery queue with HMAC-SHA256
  signatures (`X-Street-Signature: sha256=<hex>`), bounded queue (10 000) + concurrency
  (32), exponential-backoff retries (capped 30 s), and de-duplicated validation logging.
- SSRF protection: blocks private/loopback/link-local/reserved ranges on both URL host
  literals and DNS-resolved IPs (rebinding protection); `allowedHosts` bypass for tests.
- TLS validation is always enabled (`rejectUnauthorized: false` is never forwarded);
  private CAs are trusted via `tls.ca`. `buildRequestOptions` is exported for testing.
- `WEBHOOK_DISPATCHER` dependency-injection token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Test suite (8 tests incl. a real HTTPS integration test); enforced coverage
  (lines/statements ≥ 85, functions ≥ 90, branches ≥ 80).
