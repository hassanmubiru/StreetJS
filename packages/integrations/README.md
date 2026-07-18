# @streetjs/integrations

The shared foundation for StreetJS vendor connectors (Slack, GitHub, GitLab,
Jira, Linear, Notion, Teams, …). It provides the reusable pieces every
integration needs, so each connector package is a thin, typed veneer instead of
re-implementing HTTP, auth, retries, and webhook verification. **Zero runtime
dependencies**, ESM.

## Install

```bash
npm install @streetjs/integrations
```

## Build a connector

```ts
import { HttpConnector } from '@streetjs/integrations';

interface Repo { id: number; full_name: string }

export class GitHubApi extends HttpConnector {
  constructor(token: string) {
    super({ baseUrl: 'https://api.github.com', auth: { type: 'bearer', token } });
  }
  listRepos() { return this.request<Repo[]>('/user/repos', { query: { per_page: 100 } }); }
  createIssue(repo: string, title: string) {
    return this.request(`/repos/${repo}/issues`, { method: 'POST', body: { title } });
  }
}
```

`HttpConnector` gives you:

- **Injectable `fetch`** (default global) — connectors are unit-testable with a stub.
- **Auth** — `{ type: 'bearer' }`, `{ type: 'header' }`, or `{ type: 'none' }`.
- **Query building** (undefined values dropped) and JSON (de)serialization.
- **Normalized errors** — non-2xx throws `IntegrationRequestError` (with `status`
  + `body`); network failures throw `IntegrationError`.
- **Idempotent retry/backoff** — GET/HEAD retry on network errors / 429 / 5xx
  (`retries`, injectable `sleep`); non-idempotent methods never retry.

## Verify inbound webhooks

```ts
import { verifyHmacSignature } from '@streetjs/integrations';

// GitHub: X-Hub-Signature-256: sha256=<hex>
const ok = verifyHmacSignature({
  algorithm: 'sha256',
  secret: process.env.GH_WEBHOOK_SECRET!,
  payload: rawBody,                 // the exact received bytes
  signature: req.headers['x-hub-signature-256'],
  prefix: 'sha256=',
});
```

Also exported: `hmacHex(algorithm, secret, data)` and `timingSafeCompare(a, b)`
for schemes that don't fit the helper directly (e.g. Slack's `v0:ts:body`).

## Example

A complete runnable example (no network) lives in
[`src/examples/integration.ts`](./src/examples/integration.ts):

```bash
npm run example -w packages/integrations
```

## License

MIT — see [LICENSE](./LICENSE).
