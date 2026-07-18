# @streetjs/linear

The StreetJS **Linear connector**: a typed Linear GraphQL API client built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations),
plus HMAC webhook verification.

- API-key auth (raw `Authorization`) by default, or OAuth `bearer`.
- Injectable `fetch` (unit-testable, no live calls).
- Typed helpers for `viewer`, `getIssue`, `createIssue`, `createComment`, and a
  generic `query` escape hatch for any Linear GraphQL operation.
- GraphQL `errors` (returned even on HTTP 200) are unwrapped into thrown errors.
- `verifyLinearWebhook` validates the inbound `Linear-Signature` HMAC-SHA256 header.

## Install

```sh
npm install @streetjs/linear @streetjs/integrations
```

## Usage

```ts
import { LinearClient, verifyLinearWebhook } from '@streetjs/linear';

const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });

const me = await linear.viewer();

const issue = await linear.createIssue({
  teamId: 'team_abc',
  title: 'Deploy failed',
  description: 'The 15:04 UTC deploy rolled back.',
  priority: 2,
});
await linear.createComment(issue.id, 'Investigating :mag:');

// Anything the typed helpers don't cover:
const data = await linear.query<{ teams: { nodes: { id: string; name: string }[] } }>(
  'query { teams { nodes { id name } } }',
);
```

### OAuth

```ts
const linear = new LinearClient({ apiKey: oauthAccessToken, authType: 'bearer' });
```

### Verifying webhooks

Linear signs the raw request body with HMAC-SHA256 keyed by the webhook signing
secret and sends the hex digest in `Linear-Signature`:

```ts
import { verifyLinearWebhook } from '@streetjs/linear';

app.post('/webhooks/linear', (req, res) => {
  const ok = verifyLinearWebhook({
    secret: process.env.LINEAR_WEBHOOK_SECRET!,
    body: req.rawBody, // exact bytes, not the parsed object
    signature: req.header('Linear-Signature') ?? '',
  });
  if (!ok) return res.status(401).end();
  // ... handle the event
});
```

## API

### `new LinearClient(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `apiKey` | `string` | — | Required. Personal API key or OAuth token. |
| `authType` | `'api-key' \| 'bearer'` | `api-key` | Raw key vs `Bearer`. |
| `baseUrl` | `string` | `https://api.linear.app` | API host. |
| `fetch` | `FetchLike` | global `fetch` | Injectable for tests. |
| `retries` | `number` | `2` | Idempotent-retry attempts (GET/HEAD only). |
| `sleep` | `(ms) => Promise<void>` | `setTimeout` | Backoff hook. |

Methods: `query`, `viewer`, `getIssue`, `createIssue`, `createComment`. GraphQL
errors throw `IntegrationError`; non-2xx HTTP throws `IntegrationRequestError`.

### `verifyLinearWebhook({ secret, body, signature })`

Returns `true` only for a valid HMAC-SHA256 signature over `body`.

## License

MIT — see [LICENSE](./LICENSE).
