# Architecture — @streetjs/slack

## Purpose

`@streetjs/slack` is the reference StreetJS **vendor connector**: a thin, typed
Slack client that demonstrates the connector pattern all integrations follow. It
proves that `@streetjs/integrations` carries the cross-cutting weight, leaving a
connector to encode only vendor endpoints, payloads, and the vendor's webhook
signature scheme.

## Dependencies

```
@streetjs/integrations   (HttpConnector base + HMAC/timing-safe webhook helpers)
node:crypto              (only in tests/examples for signing fixtures)
```

One first-party dependency; no third-party runtime deps.

## Design

### SlackClient (extends HttpConnector)

The constructor configures the base client with `https://slack.com/api`, bearer
auth from the bot token, and a JSON content-type; it forwards the injectable
`fetch`/`retries`/`sleep`. A single `call(method, body)` posts JSON and unwraps
Slack's response envelope: because Slack returns HTTP 200 with `{ ok: false,
error }` on logical failures, `call` inspects `ok` and throws an
`IntegrationError` with the Slack error code, so callers get real errors rather
than silently-failed sends. Typed helpers (`postMessage` incl. ephemeral/thread/
blocks, `updateMessage`, `deleteMessage`, `addReaction`, `listConversations`)
build the right body and delegate to `call`.

### verifySlackRequest

Implements Slack's request-signing scheme with the shared HMAC primitives:
recompute `v0:{timestamp}:{body}` with HMAC-SHA256, compare in constant time to
the `X-Slack-Signature` header, and reject timestamps outside `toleranceSeconds`
(default 300) to blunt replay. The clock is injectable for deterministic tests.

## Testing

Fully offline via an injected `fetch`: endpoint/URL/body/auth for each method,
ephemeral routing, block/thread forwarding, the `{ ok: false }` → throw path,
retry-forwarding and empty-body handling, plus the signature-verification matrix
(valid/fresh, wrong secret, tampered body, stale/replayed timestamp, non-numeric
timestamp, default clock). Coverage is 100% across statements/branches/functions/
lines.

## Non-goals

- Not exhaustive — wraps the common Web API methods; anything else is one
  `client.call(method, body)` away.
- No Socket Mode / RTM websocket transport.
- No OAuth install flow (accepts an already-issued token).

## The connector pattern (for the remaining vendors)

Discord, GitHub, GitLab, Jira, Linear, Notion, and Teams follow this exact
shape: `extends HttpConnector` with the vendor base URL + auth, a handful of
typed methods over `request`/`call`, and a `verify…Request` built on the shared
HMAC helpers (or the vendor's scheme). This package is the template.
