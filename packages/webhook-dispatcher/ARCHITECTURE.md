# @streetjs/webhook-dispatcher — Architecture

## Goals

- A single, hardened outbound webhook sender for StreetJS.
- Zero runtime dependencies (Node core: https, crypto, url, dns).
- Secure by default: HTTPS-only, SSRF-blocked, TLS-validated, signed.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  dispatcher.ts  WebhookDispatcher + buildRequestOptions + SSRF/URL validation.
  index.ts       Curated public API + WEBHOOK_DISPATCHER DI token.
```

## Relationship to @streetjs/webhooks

Two webhook packages exist by design and are **not** duplicates:

- `@streetjs/webhooks` — a generic, transport-injectable **library** for signing,
  delivering, and **verifying** webhooks (`t=,v1=` scheme). Suitable for either side.
- `@streetjs/webhook-dispatcher` (this) — the framework's opinionated **sender**: a queue
  with SSRF hardening, HTTPS enforcement, and the `X-Street-Signature: sha256=…` scheme.

This package is extracted from `streetjs` core (`webhook/dispatcher`); core now depends on
it and re-exports it (the `streetjs/webhook` subpath), so there is a single implementation
— dependency inversion, not duplication.

## Delivery pipeline

`enqueue(target, event, data)` returns synchronously after cheap guards (stopped / queue
full), then **asynchronously** validates the URL and, on success, pushes a job and drains:

- **Validation** (`validateWebhookUrl`) enforces `https:`, rejects private/reserved host
  literals, and resolves the host (`dns.lookup`) to reject rebinding to a blocked IP —
  unless the host is in the constructor `allowedHosts` (test-only bypass).
- **Drain** runs up to `MAX_CONCURRENT` (32) in-flight dispatches from a queue bounded at
  `MAX_QUEUE_SIZE` (10 000).
- **Dispatch** signs the body (`HMAC-SHA256` → `X-Street-Signature: sha256=<hex>`) and
  POSTs over HTTPS via options from `buildRequestOptions` (which never sets
  `rejectUnauthorized: false`; a private CA is trusted via `tls.ca`). A 2xx is success;
  otherwise it retries with exponential backoff (`2^attempt` s, capped 30 s) up to
  `maxRetries`, then logs a permanent failure.

Invalid-URL logs are de-duplicated per URL on a 60 s window to avoid log spam.

## Testing

`node --test`:
- **Pure** — `buildRequestOptions` (URL/header mapping, custom port, private-CA passthrough,
  and the invariant that TLS validation is never disabled).
- **Guards / SSRF** — `enqueue` after `stop()`, non-HTTPS rejection, and a private-IP
  literal rejection (asserted via captured logs).
- **Integration** — a real HTTPS server with an openssl-generated self-signed cert
  (`allowedHosts=['127.0.0.1']`, `tls.ca=cert`): verifies the delivered `X-Street-Signature`
  HMAC over the exact body and the payload envelope, and that a 5xx triggers a
  backoff retry up to `maxRetries`.

Coverage thresholds: lines/statements ≥ 85, functions ≥ 90, branches ≥ 80 — a portion of
low-level socket/error branches are impractical to force from tests; the security-critical
paths (HTTPS enforcement, SSRF blocklist, signature, TLS-validation invariant, retry) are
covered.
