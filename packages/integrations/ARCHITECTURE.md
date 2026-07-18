# Architecture — @streetjs/integrations

## Purpose

`@streetjs/integrations` is the base every StreetJS vendor connector builds on.
It concentrates the cross-cutting concerns of third-party API access — transport,
auth, query/JSON handling, error normalization, retry, and inbound-webhook
verification — so a connector package (Slack, GitHub, …) only encodes that
vendor's endpoints and payload shapes. This is the "promote reusable
infrastructure into the framework" outcome of the StreetStudio readiness audit.

## Dependencies

```
node:crypto   (HMAC + timing-safe compare for webhook verification)
```

Zero third-party runtime dependencies.

## Design

### HttpConnector

A base class connectors extend. It resolves an injectable `fetch` (default
global), applies an `AuthStrategy` (bearer / custom header / none), builds URLs
with query encoding (dropping `undefined`), serializes JSON bodies (setting
`content-type`, passing raw strings through), and parses JSON responses
(empty → `undefined`, non-JSON → raw text). Failures are normalized:

- non-2xx → `IntegrationRequestError` (carrying `status` and a truncated `body`);
- transport error → `IntegrationError`.

**Retry** is idempotent-only: GET/HEAD retry on network errors and 429/5xx up to
`retries` times with exponential backoff via an injectable `sleep`; mutating
methods are attempted once so a request is never silently duplicated.

### Webhook verification

`webhook.ts` supplies `hmacHex`, `timingSafeCompare` (length-checked,
constant-time), and `verifyHmacSignature` (with optional prefix stripping for
schemes like GitHub's `sha256=`). Connectors compose these for their specific
scheme (e.g. Slack's `v0:{ts}:{body}` base string).

## Testing

Runs with no network using a stub `FetchLike`: URL/query building, both auth
strategies, JSON and raw-string bodies, error mapping, idempotent-retry on 5xx,
non-retry of POST, network-error retry+surface, empty/non-JSON success bodies,
default-fetch resolution, and the full webhook-verification matrix. Coverage is
≥99% lines / 100% functions; the declared branch floor is 85% (two defensive/
unreachable throw branches remain, documented rather than force-covered).

## Non-goals

- No vendor-specific logic — that lives in each connector package.
- No OAuth *flow* orchestration (authorization-code exchange) — connectors accept
  already-obtained tokens; use core `OAuthManager` for the flow.
- No streaming/websocket transport (connectors that need it wrap `@streetjs/*`
  realtime/websocket).
