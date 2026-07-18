# @streetjs/github

The StreetJS **GitHub connector**: a typed GitHub REST API client built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations),
plus constant-time webhook signature verification.

- Bearer-token auth, `X-GitHub-Api-Version` header, injectable `fetch` (unit-testable, no live calls).
- Typed methods for issues, comments, pull requests, releases, and workflow / repository dispatch.
- `verifyGitHubWebhook` validates inbound `X-Hub-Signature-256` HMAC-SHA256 signatures.
- ESM, strict TypeScript, zero runtime deps beyond `@streetjs/integrations` (which is zero-dep).

## Install

```sh
npm install @streetjs/github @streetjs/integrations
```

## Usage

```ts
import { GitHubClient, verifyGitHubWebhook } from '@streetjs/github';

const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN! });

// Open an issue and comment on it.
const issue = await gh.createIssue('acme', 'app', {
  title: 'Deploy failed',
  body: 'The 15:04 UTC deploy rolled back.',
  labels: ['ops', 'incident'],
});
await gh.commentOnIssue('acme', 'app', issue.number, 'Investigating :mag:');

// Open a pull request.
await gh.createPullRequest('acme', 'app', {
  title: 'Fix flaky test',
  head: 'fix/flaky',
  base: 'main',
  draft: true,
});

// Kick off a workflow_dispatch run.
await gh.dispatchWorkflow('acme', 'app', 'ci.yml', 'main', { level: 'full' });
```

### GitHub Enterprise

Point `baseUrl` at your GHE host's API root:

```ts
const gh = new GitHubClient({
  token: process.env.GITHUB_TOKEN!,
  baseUrl: 'https://ghe.acme.com/api/v3',
});
```

### Verifying webhooks

GitHub signs the **raw request body** with HMAC-SHA256 keyed by the webhook
secret and sends `sha256=<hex>` in the `X-Hub-Signature-256` header. Verify
against the raw bytes before parsing JSON:

```ts
import { verifyGitHubWebhook } from '@streetjs/github';

app.post('/webhooks/github', (req, res) => {
  const ok = verifyGitHubWebhook({
    secret: process.env.GITHUB_WEBHOOK_SECRET!,
    body: req.rawBody, // exact bytes, not the parsed object
    signature: req.header('X-Hub-Signature-256') ?? '',
  });
  if (!ok) return res.status(401).end();
  // ... handle the event
});
```

The legacy `X-Hub-Signature` (`sha1=…`) header is intentionally **not**
accepted — use the SHA-256 header.

## API

### `new GitHubClient(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `token` | `string` | — | Required. PAT, OAuth, or App installation token. |
| `baseUrl` | `string` | `https://api.github.com` | Set to your GHE API root. |
| `apiVersion` | `string` | `2022-11-28` | `X-GitHub-Api-Version` header. |
| `fetch` | `FetchLike` | global `fetch` | Injectable for tests. |
| `retries` | `number` | `2` | Idempotent-retry attempts (GET/HEAD only). |
| `sleep` | `(ms) => Promise<void>` | `setTimeout` | Backoff hook. |

Methods: `getRepo`, `listIssues`, `createIssue`, `updateIssue`,
`commentOnIssue`, `createPullRequest`, `createRelease`, `repositoryDispatch`,
`dispatchWorkflow`. Non-2xx responses throw `IntegrationRequestError` (from
`@streetjs/integrations`) carrying the status and the truncated error body.

### `verifyGitHubWebhook({ secret, body, signature })`

Returns `true` only for a valid `sha256=<hex>` signature over `body`.

## License

MIT — see [LICENSE](./LICENSE).
