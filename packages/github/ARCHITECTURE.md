# Architecture — @streetjs/github

## Position in the framework

`@streetjs/github` is a **vendor connector**: a thin, typed veneer over the
GitHub REST API built on the shared `@streetjs/integrations` foundation. It owns
no HTTP, auth, retry, or signature logic of its own — those live in
`HttpConnector` and the webhook primitives — so this package is small and easy
to audit.

```
@streetjs/integrations         @streetjs/github
────────────────────────       ─────────────────────────────
HttpConnector (fetch/auth/  ◄── GitHubClient extends it, adds
  retry/JSON/errors)             typed REST methods
verifyHmacSignature /       ◄── verifyGitHubWebhook wraps it
  hmacHex / timingSafeCompare    (sha256=, constant-time)
```

## Design decisions

- **Extends `HttpConnector`.** The constructor maps `GitHubClientOptions` onto
  `ConnectorOptions` (bearer auth + the `accept: application/vnd.github+json`
  and `x-github-api-version` default headers). Every method is a thin call to
  the inherited `request<T>()`, so all transport concerns (query building,
  JSON, normalized errors, idempotent retry/backoff) are inherited, not
  duplicated.

- **Injectable `fetch`.** No method ever touches a live GitHub. Tests pass a
  recording fake, which is why the suite runs in CI with no network and no
  secrets.

- **Path segments are URL-encoded.** `owner`/`repo`/`workflow_id` pass through
  `encodeURIComponent`, so slugs with unusual characters can't break out of the
  intended path.

- **204-tolerant dispatch methods.** `repositoryDispatch` and
  `dispatchWorkflow` answer `204 No Content`; the base client's JSON parser
  maps an empty body to `undefined`, so these are typed `Promise<void>`.

- **SHA-256 only for webhooks.** `verifyGitHubWebhook` requires the
  `X-Hub-Signature-256` header and rejects the legacy `sha1=` scheme, delegating
  the constant-time comparison to `verifyHmacSignature`.

## Testing

`node:test` with an injected fetch that records requests and replays queued
responses. Coverage exercises every method, the error path, custom base
URL/API version, and all webhook accept/reject branches. 100% lines / funcs /
statements; branch floor 88.

## Boundaries

This package is **not** consumed by `@streetjs/core`; it is a standalone,
opt-in connector that applications (and StreetStudio) install directly.
