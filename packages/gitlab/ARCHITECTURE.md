# Architecture — @streetjs/gitlab

## Position in the framework

`@streetjs/gitlab` is a **vendor connector**: a thin, typed veneer over the
GitLab REST API v4 built on the shared `@streetjs/integrations` foundation. HTTP,
auth, retry, and JSON handling come from `HttpConnector`; this package adds
GitLab endpoints and the webhook-token check.

```
@streetjs/integrations         @streetjs/gitlab
────────────────────────       ─────────────────────────────
HttpConnector (fetch/auth/  ◄── GitLabClient extends it, adds
  retry/JSON/errors)             typed REST methods
timingSafeCompare           ◄── verifyGitLabWebhook (X-Gitlab-Token)
```

## Design decisions

- **Extends `HttpConnector`.** The constructor maps `GitLabClientOptions` onto
  `ConnectorOptions`. GitLab's default scheme is the `PRIVATE-TOKEN` header
  (`header` auth strategy); `authType: 'bearer'` switches to OAuth `Bearer`.

- **Projects by id or path.** GitLab addresses projects by numeric id or by a
  URL-encoded `group/project` path. `projectSeg` runs every project identifier
  through `encodeURIComponent`, so `group/app` becomes `group%2Fapp` and slashes
  can't escape the intended path.

- **Secret-token webhooks, not HMAC.** GitLab does not sign webhook bodies; it
  echoes the configured secret in `X-Gitlab-Token`. `verifyGitLabWebhook`
  delegates to the shared `timingSafeCompare` so the comparison is constant-time
  and empty inputs fail closed.

- **Injectable `fetch`.** No method touches a live GitLab; tests use a recording
  fake, so the suite runs in CI with no network and no secrets.

## Testing

`node:test` with an injected fetch; 8 tests covering both auth modes, path
encoding, query building, every write method, the error path, and all webhook
branches. 100% lines / funcs / statements; branch floor 88.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in connector.
