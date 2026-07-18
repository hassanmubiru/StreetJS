# @streetjs/slack

The StreetJS Slack connector: a typed Slack Web API client built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations),
plus Slack request-signature (`v0`) verification for inbound events. ESM.

## Install

```bash
npm install @streetjs/slack
```

## Send messages

```ts
import { SlackClient } from '@streetjs/slack';

const slack = new SlackClient({ token: process.env.SLACK_BOT_TOKEN! });

await slack.postMessage({ channel: '#deploys', text: 'Build 1007 shipped :rocket:' });
await slack.postMessage({ channel: 'C123', text: 'psst', ephemeralTo: 'U999' }); // ephemeral
const { ts } = await slack.postMessage({ channel: 'C123', blocks });            // Block Kit
await slack.updateMessage('C123', ts as string, 'edited');
await slack.addReaction('C123', ts as string, 'white_check_mark');
await slack.listConversations({ types: 'public_channel', limit: 100 });
```

Every method posts JSON with the bot token and unwraps Slack's `{ ok, error }`
envelope: a `{ ok: false }` response (even with HTTP 200) throws an
`IntegrationError` carrying the Slack error code (e.g. `channel_not_found`). Use
`slack.call(method, body)` for any Web API method not wrapped explicitly.

## Verify inbound requests

Slack signs event/interaction requests as `v0=HMAC_SHA256(signingSecret,
"v0:{timestamp}:{rawBody}")`. Verify them (with a built-in replay guard):

```ts
import { verifySlackRequest } from '@streetjs/slack';

const valid = verifySlackRequest({
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  timestamp: req.headers['x-slack-request-timestamp'],
  body: rawBody,                       // the exact received bytes
  signature: req.headers['x-slack-signature'],
  // toleranceSeconds: 300 (default) — rejects stale timestamps
});
if (!valid) return res.writeHead(401).end();
```

## Testing

The client takes an injectable `fetch`, so you can unit-test Slack interactions
with no network (see this package's own tests). Retries/backoff and error
handling come from `@streetjs/integrations`.

## Example

A complete runnable example (no network) lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/slack
```

## License

MIT — see [LICENSE](./LICENSE).
