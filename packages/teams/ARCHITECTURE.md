# Architecture — @streetjs/teams

## Position in the framework

`@streetjs/teams` is a **vendor connector** built on the shared
`@streetjs/integrations` foundation. It covers the three ways applications
actually talk to Microsoft Teams, each mapped onto the foundation's primitives.

```
@streetjs/integrations         @streetjs/teams
────────────────────────       ─────────────────────────────
HttpConnector (fetch/auth/  ◄── TeamsClient extends it (Graph messaging)
  retry/JSON/errors)
FetchLike                   ◄── sendIncomingWebhook (raw card POST)
timingSafeCompare           ◄── verifyTeamsOutgoingWebhook (base64 HMAC)
```

## Design decisions

- **Three real paths, not one forced abstraction.** Teams messaging is genuinely
  three different mechanisms:
  1. **Microsoft Graph** (`TeamsClient`) — the modern, token-authenticated API
     for channel/chat messages. Extends `HttpConnector`, so it inherits auth,
     retry, JSON, and normalized errors.
  2. **Incoming webhooks** — a POST of a card to a secret URL, no token. This
     doesn't fit the `baseUrl + path` model (the URL is opaque and
     query-laden), so `sendIncomingWebhook` is a small standalone function that
     still takes an injectable `FetchLike` for testability.
  3. **Outgoing webhooks** — Teams calls *your* endpoint and signs with
     `Authorization: HMAC <base64>`.

- **base64 HMAC, not hex.** Teams keys and signatures are base64, so
  `computeTeamsSignature` uses `node:crypto` directly (base64-decoded key,
  base64 digest) rather than the shared hex helper — but the comparison still
  goes through the shared `timingSafeCompare` for constant-time safety.

- **`listChannels` unwraps `value`.** Graph collections wrap results in `value`;
  the method returns the array (or `[]` when absent) so callers don't reach into
  the envelope.

## Testing

`node:test` with an injected fetch for Graph and the incoming webhook, plus a
locally computed base64 HMAC for outgoing verification. 10 tests covering the
Graph methods, the `value`-absent path, the incoming-webhook success/validation/
error/global-fetch-fallback paths, and every outgoing-webhook branch. 100% lines
/ funcs / statements; branch floor 88.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in connector.
