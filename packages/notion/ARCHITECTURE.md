# Architecture — @streetjs/notion

## Position in the framework

`@streetjs/notion` is a **vendor connector**: a thin, typed veneer over the
Notion API built on the shared `@streetjs/integrations` foundation. HTTP, auth,
retry, and JSON handling are inherited from `HttpConnector`; this package adds
Notion's endpoints and the webhook verifier.

```
@streetjs/integrations         @streetjs/notion
────────────────────────       ─────────────────────────────
HttpConnector (fetch/auth/  ◄── NotionClient extends it, adds
  retry/JSON/errors)             typed methods + Notion-Version
verifyHmacSignature         ◄── verifyNotionWebhook (X-Notion-Signature)
```

## Design decisions

- **Extends `HttpConnector`.** The constructor maps `NotionClientOptions` onto
  `ConnectorOptions` (bearer auth + the required `Notion-Version` default
  header). Every method is a thin call to `request<T>()`.

- **Required version header.** Notion rejects requests without `Notion-Version`.
  The default (`2022-06-28`) is a stable, widely-supported value; `notionVersion`
  overrides it so callers can adopt newer schemas without a package bump.

- **Loose result typing.** Notion page/database/block payloads are large and
  schema-dependent, so results are typed as open `NotionObject` / `NotionList`
  records rather than pretending to model every property. Callers narrow as
  needed; inputs (`CreatePageInput`, `QueryDatabaseInput`, `SearchInput`) are
  typed where it helps.

- **HMAC webhooks.** `verifyNotionWebhook` requires the `X-Notion-Signature`
  header (`sha256=<hex>`) and delegates the constant-time comparison to the
  shared `verifyHmacSignature`.

## Testing

`node:test` with an injected fetch; 7 tests covering the version header, every
method + verb, the error path, and all webhook branches (valid, wrong secret,
tampered body, empty, missing-prefix). 100% lines / funcs / statements; branch
floor 88.

## Boundaries

Not consumed by `@streetjs/core`; a standalone, opt-in connector.
