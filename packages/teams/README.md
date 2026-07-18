# @streetjs/teams

The StreetJS **Microsoft Teams connector**. Three real Teams integration paths,
all built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations):

- **`TeamsClient`** — a typed Microsoft Graph client for posting channel and chat
  messages with a bearer access token.
- **`sendIncomingWebhook`** — post a MessageCard / Adaptive Card to a Teams
  Incoming Webhook URL (authenticated by the secret URL itself).
- **`verifyTeamsOutgoingWebhook`** — validate the `Authorization: HMAC <base64>`
  signature Teams sends to your outgoing-webhook (bot) endpoint.

Injectable `fetch` throughout, so everything is unit-testable with no live calls.

## Install

```sh
npm install @streetjs/teams @streetjs/integrations
```

## Usage

### Microsoft Graph (channel / chat messages)

```ts
import { TeamsClient } from '@streetjs/teams';

const teams = new TeamsClient({ accessToken: graphAccessToken });

const channels = await teams.listChannels(teamId);
await teams.sendChannelMessage(teamId, channels[0].id, '<b>Deploy complete</b> :rocket:');
await teams.sendChatMessage(chatId, 'Direct heads-up', 'text');
```

Acquire the `accessToken` via your OAuth flow (client credentials or delegated)
with the appropriate `ChannelMessage.Send` / `Chat.ReadWrite` scopes.

### Incoming webhook (connector card)

```ts
import { sendIncomingWebhook } from '@streetjs/teams';

await sendIncomingWebhook(process.env.TEAMS_WEBHOOK_URL!, {
  '@type': 'MessageCard',
  '@context': 'http://schema.org/extensions',
  summary: 'Deploy',
  text: 'Nightly build passed :rocket:',
});
```

### Verifying an outgoing webhook

A Teams outgoing webhook signs each request with `Authorization: HMAC
<base64signature>`, where the signature is HMAC-SHA256 of the raw body keyed by
the base64-decoded security token from registration:

```ts
import { verifyTeamsOutgoingWebhook } from '@streetjs/teams';

app.post('/teams/outgoing', (req, res) => {
  const ok = verifyTeamsOutgoingWebhook({
    secret: process.env.TEAMS_OUTGOING_SECRET!, // base64 token from Teams
    body: req.rawBody, // exact bytes, not the parsed object
    authorization: req.header('Authorization') ?? '',
  });
  if (!ok) return res.status(401).end();
  // ... respond with a message activity
});
```

## API

### `new TeamsClient(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `accessToken` | `string` | — | Required. Microsoft Graph OAuth token. |
| `baseUrl` | `string` | `https://graph.microsoft.com/v1.0` | Graph base. |
| `fetch` | `FetchLike` | global `fetch` | Injectable for tests. |
| `retries` | `number` | `2` | Idempotent-retry attempts (GET/HEAD only). |
| `sleep` | `(ms) => Promise<void>` | `setTimeout` | Backoff hook. |

Methods: `getTeam`, `listChannels`, `sendChannelMessage`, `sendChatMessage`.

### `sendIncomingWebhook(webhookUrl, card, { fetch? })`

POSTs `card` as JSON to the webhook URL; throws on a non-2xx response.

### `verifyTeamsOutgoingWebhook({ secret, body, authorization })`

Returns `true` only for a valid `HMAC <base64>` signature over `body`.
`computeTeamsSignature` is also exported.

## License

MIT — see [LICENSE](./LICENSE).
