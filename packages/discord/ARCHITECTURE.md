# Architecture — @streetjs/discord

## Position in the framework

`@streetjs/discord` is a **vendor connector**: a thin, typed veneer over the
Discord REST API built on the shared `@streetjs/integrations` foundation. HTTP,
auth, retry, and JSON handling are inherited from `HttpConnector`; the package
adds Discord-specific endpoints and the Ed25519 interaction verifier.

```
@streetjs/integrations         @streetjs/discord
────────────────────────       ─────────────────────────────
HttpConnector (fetch/auth/  ◄── DiscordClient extends it, adds
  retry/JSON/errors)             typed REST methods
node:crypto (Ed25519)       ◄── verifyDiscordInteraction
                                 (foundation HMAC helpers don't fit)
```

## Design decisions

- **Extends `HttpConnector`.** The constructor maps `DiscordClientOptions` onto
  `ConnectorOptions`, using the `header` auth strategy to send
  `Authorization: Bot <token>` (Discord's bot scheme, not `Bearer`).

- **Ed25519, not HMAC.** Unlike Slack/GitHub webhooks, Discord signs
  interaction requests with Ed25519. The shared HMAC helpers don't apply, so
  `verifyDiscordInteraction` uses `node:crypto` directly: it reconstructs a
  SPKI public key from the raw 32-byte hex key, then verifies the signature
  over `timestamp + body`. All malformed input is caught and returned as a
  failed verification, never a throw — a verifier that throws is a verifier that
  gets bypassed.

- **204-tolerant mutations.** `deleteMessage` and `createReaction` answer
  `204 No Content`; the base client's JSON parser maps an empty body to
  `undefined`, so these are typed `Promise<void>`.

- **Injectable everything.** REST tests use a recording fake fetch; interaction
  tests generate a real Ed25519 keypair in-process and sign a message, so the
  full verify path runs in CI with no secrets and no network.

## Testing

`node:test`; 8 tests. REST methods, the error path, and every interaction
accept/reject branch (tamper, wrong key, empty header, bad hex, wrong signature
length). 100% lines / funcs / statements; branch floor 88.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in connector.
