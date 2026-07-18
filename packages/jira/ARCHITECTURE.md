# Architecture — @streetjs/jira

## Position in the framework

`@streetjs/jira` is a **vendor connector**: a thin, typed veneer over the Jira
Cloud REST API v3 built on the shared `@streetjs/integrations` foundation. HTTP,
auth, retry, and JSON handling are inherited from `HttpConnector`; the package
adds Jira endpoints, ADF conversion, and the webhook verifier.

```
@streetjs/integrations         @streetjs/jira
────────────────────────       ─────────────────────────────
HttpConnector (fetch/auth/  ◄── JiraClient extends it, adds
  retry/JSON/errors)             typed REST methods
verifyHmacSignature         ◄── verifyJiraWebhook (HMAC-SHA256)
                            ──▶ adf.ts (plain text → ADF)
```

## Design decisions

- **Extends `HttpConnector`.** The constructor base64-encodes `email:apiToken`
  and applies it via the `header` auth strategy (`Authorization: Basic …`),
  Jira Cloud's supported token scheme. The base URL is derived from `host`.

- **ADF conversion.** Jira Cloud v3 rejects plain strings for rich-text fields.
  `textToAdf` wraps plain text into the minimal valid ADF document (one
  paragraph per line, empty paragraphs for blank lines), so `createIssue` and
  `addComment` accept ordinary strings. `extraFields` allows passing raw ADF or
  any other field directly.

- **204-tolerant mutations.** `transitionIssue` and `assignIssue` answer
  `204 No Content`; the base client maps an empty body to `undefined`, so these
  are typed `Promise<void>`.

- **Honest webhook verification.** Jira system webhooks are unauthenticated by
  default, so `verifyJiraWebhook` implements the recommended hardening: an
  HMAC-SHA256 signature over the raw body (via the shared `verifyHmacSignature`,
  with an optional prefix). The README states plainly that the sender must be
  configured to sign — no pretense that Jira signs out of the box.

## Testing

`node:test` with an injected fetch; 8 tests covering option validation, Basic
auth, the ADF payload shape, transition-list unwrapping (incl. the missing-key
path), the 204 methods, JQL query building, the error path, and every webhook
branch. 100% lines / funcs / statements; branch floor 88.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in connector.
