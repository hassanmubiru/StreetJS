# Changelog

All notable changes to `@streetjs/webhooks` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.0] - 2026-07-14

### Added

- Initial release of `@streetjs/webhooks` — the StreetJS webhooks foundation.
- HMAC-SHA256 signing (`signPayload`) with timestamped `t=…,v1=…` headers and
  constant-time verification (`verifySignature`) with replay protection (tolerance
  window) that never throws on malformed input.
- `parseSignatureHeader` for header inspection.
- `WebhookDispatcher`: builds a canonical `{ id, type, created, data }` envelope,
  signs it, and delivers it with `webhook-signature`/`webhook-id`/`webhook-event`/
  `webhook-timestamp` headers, retrying transient failures with exponential backoff.
  Generates a UUID event id when omitted.
- `FetchWebhookTransport` (default, bounded timeout) and a `WebhookTransport` interface
  for custom/injected/testable delivery.
- Injectable transport, `sleep`, and `clock`; a `WEBHOOK_DISPATCHER` DI token.
- Zero runtime dependencies. Strict TypeScript, ESM, tree-shakeable public API.
- Comprehensive test suite (24 tests) with ≥90% enforced coverage.
