# @streetjs/discord

The StreetJS **Discord connector**: a typed Discord REST API client built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations),
plus Ed25519 interaction-request verification.

- Bot-token auth (`Authorization: Bot <token>`), injectable `fetch` (unit-testable, no live calls).
- Typed methods for channel messages, edits, deletes, reactions, and incoming-webhook execution.
- `verifyDiscordInteraction` validates inbound `X-Signature-Ed25519` interaction signatures.
- ESM, strict TypeScript, one dependency (`@streetjs/integrations`, itself zero-dep).

## Install

```sh
npm install @streetjs/discord @streetjs/integrations
```

## Usage

```ts
import { DiscordClient, verifyDiscordInteraction } from '@streetjs/discord';

const discord = new DiscordClient({ token: process.env.DISCORD_BOT_TOKEN! });

const msg = await discord.createMessage('123456789012345678', {
  content: 'Deploy complete :rocket:',
});
await discord.createReaction('123456789012345678', msg.id, '✅');

// Post as an incoming webhook instead of the bot:
await discord.executeWebhook(webhookId, webhookToken, { content: 'Nightly build passed' });
```

### Verifying interaction requests

Discord signs interaction webhooks with **Ed25519** (not HMAC). It sends the
`X-Signature-Ed25519` and `X-Signature-Timestamp` headers; verify against the
raw request body using your application's public key (hex, from the Developer
Portal):

```ts
import { verifyDiscordInteraction } from '@streetjs/discord';

app.post('/interactions', (req, res) => {
  const ok = verifyDiscordInteraction({
    publicKey: process.env.DISCORD_PUBLIC_KEY!,
    signature: req.header('X-Signature-Ed25519') ?? '',
    timestamp: req.header('X-Signature-Timestamp') ?? '',
    body: req.rawBody, // exact bytes, not the parsed object
  });
  if (!ok) return res.status(401).end();
  // Respond to a PING with { type: 1 }, otherwise dispatch the interaction.
});
```

Malformed input (bad hex, wrong key length, empty header) returns `false`
rather than throwing.

## API

### `new DiscordClient(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `token` | `string` | — | Required. Bot token. |
| `baseUrl` | `string` | `https://discord.com/api/v10` | API base. |
| `fetch` | `FetchLike` | global `fetch` | Injectable for tests. |
| `retries` | `number` | `2` | Idempotent-retry attempts (GET/HEAD only). |
| `sleep` | `(ms) => Promise<void>` | `setTimeout` | Backoff hook. |

Methods: `getChannel`, `createMessage`, `editMessage`, `deleteMessage`,
`createReaction`, `executeWebhook`. Non-2xx responses throw
`IntegrationRequestError` (from `@streetjs/integrations`).

### `verifyDiscordInteraction({ publicKey, signature, timestamp, body })`

Returns `true` only for a valid Ed25519 signature over `timestamp + body`.
`ed25519PublicKeyFromHex` is also exported for advanced use.

## License

MIT — see [LICENSE](./LICENSE).
