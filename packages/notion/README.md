# @streetjs/notion

The StreetJS **Notion connector**: a typed Notion API client built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations),
plus HMAC webhook verification.

- Bearer-token auth, required `Notion-Version` header, injectable `fetch` (unit-testable).
- Typed methods for pages, databases, blocks, and search.
- `verifyNotionWebhook` validates the inbound `X-Notion-Signature` HMAC-SHA256 header.
- ESM, strict TypeScript, one dependency (`@streetjs/integrations`, itself zero-dep).

## Install

```sh
npm install @streetjs/notion @streetjs/integrations
```

## Usage

```ts
import { NotionClient } from '@streetjs/notion';

const notion = new NotionClient({ token: process.env.NOTION_TOKEN! });

// Create a page in a database.
const page = await notion.createPage({
  parent: { database_id: process.env.NOTION_DB_ID! },
  properties: {
    Name: { title: [{ text: { content: 'Deploy failed' } }] },
    Status: { select: { name: 'Investigating' } },
  },
});

// Add content blocks.
await notion.appendBlockChildren(page.id, [
  { object: 'block', type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'Rolled back at 15:04 UTC.' } }] } },
]);

// Query and search.
const rows = await notion.queryDatabase(process.env.NOTION_DB_ID!, {
  filter: { property: 'Status', select: { equals: 'Investigating' } },
  page_size: 25,
});
const hits = await notion.search({ query: 'roadmap', filter: { value: 'page', property: 'object' } });
```

### API version

Notion requires a `Notion-Version` header. This connector defaults to
`2022-06-28`; override it with `notionVersion` as new versions ship:

```ts
const notion = new NotionClient({ token, notionVersion: '2025-09-03' });
```

### Verifying webhooks

Notion HMAC-SHA256-signs the raw request body with the subscription's
verification token and sends `sha256=<hex>` in `X-Notion-Signature`:

```ts
import { verifyNotionWebhook } from '@streetjs/notion';

app.post('/webhooks/notion', (req, res) => {
  const ok = verifyNotionWebhook({
    secret: process.env.NOTION_VERIFICATION_TOKEN!,
    body: req.rawBody, // exact bytes, not the parsed object
    signature: req.header('X-Notion-Signature') ?? '',
  });
  if (!ok) return res.status(401).end();
  // ... handle the event
});
```

## API

### `new NotionClient(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `token` | `string` | — | Required. Integration or OAuth token. |
| `notionVersion` | `string` | `2022-06-28` | `Notion-Version` header. |
| `baseUrl` | `string` | `https://api.notion.com/v1` | API base. |
| `fetch` | `FetchLike` | global `fetch` | Injectable for tests. |
| `retries` | `number` | `2` | Idempotent-retry attempts (GET/HEAD only). |
| `sleep` | `(ms) => Promise<void>` | `setTimeout` | Backoff hook. |

Methods: `retrievePage`, `createPage`, `updatePage`, `retrieveDatabase`,
`queryDatabase`, `appendBlockChildren`, `search`. Non-2xx responses throw
`IntegrationRequestError` (from `@streetjs/integrations`).

### `verifyNotionWebhook({ secret, body, signature })`

Returns `true` only for a valid `sha256=<hex>` signature over `body`.

## License

MIT — see [LICENSE](./LICENSE).
