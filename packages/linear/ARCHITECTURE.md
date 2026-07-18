# Architecture — @streetjs/linear

## Position in the framework

`@streetjs/linear` is a **vendor connector**: a typed veneer over the Linear
GraphQL API built on the shared `@streetjs/integrations` foundation. HTTP, auth,
retry, and JSON handling come from `HttpConnector`; this package adds the
GraphQL envelope handling, typed helpers, and the webhook verifier.

```
@streetjs/integrations         @streetjs/linear
────────────────────────       ─────────────────────────────
HttpConnector (fetch/auth/  ◄── LinearClient extends it; every
  retry/JSON/errors)             method POSTs to /graphql
verifyHmacSignature         ◄── verifyLinearWebhook (Linear-Signature)
```

## Design decisions

- **GraphQL over one endpoint.** Unlike the REST connectors, Linear is a single
  `/graphql` endpoint. `query<T>()` is the primitive: it POSTs
  `{ query, variables }`, then inspects the response. A non-empty `errors`
  array (which Linear returns with HTTP 200) throws `IntegrationError`, and a
  missing `data` field throws too — so callers never get a silently-empty
  result. Typed helpers (`viewer`, `getIssue`, `createIssue`, `createComment`)
  are thin wrappers over `query`.

- **Mutation success flags.** Linear mutations return `{ success, ... }`.
  `createIssue`/`createComment` throw when `success` is false rather than
  returning a half-built object.

- **Auth scheme.** Personal API keys are sent as the **raw** `Authorization`
  value (Linear's scheme), so the default uses the `header` auth strategy;
  `authType: 'bearer'` switches to `Bearer` for OAuth tokens.

- **HMAC webhooks.** `verifyLinearWebhook` delegates to the shared
  `verifyHmacSignature` (SHA-256, hex, no prefix) matching the `Linear-Signature`
  header, with a constant-time comparison.

## Testing

`node:test` with an injected fetch; 10 tests covering both auth modes, each
helper, the generic error/`no data`/`success=false` paths, non-2xx HTTP, and
every webhook branch. 100% lines / funcs / statements; branch floor 88.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in connector.
