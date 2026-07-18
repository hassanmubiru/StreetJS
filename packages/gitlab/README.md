# @streetjs/gitlab

The StreetJS **GitLab connector**: a typed GitLab REST API v4 client built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations),
plus constant-time webhook-token verification.

- `PRIVATE-TOKEN` header auth by default (personal/project access tokens) or OAuth `bearer`.
- Injectable `fetch` (unit-testable, no live calls).
- Typed methods for projects, issues, notes, merge requests, and pipeline triggers.
- Projects addressable by numeric id or `group/project` path (URL-encoded automatically).
- `verifyGitLabWebhook` validates the inbound `X-Gitlab-Token` secret in constant time.

## Install

```sh
npm install @streetjs/gitlab @streetjs/integrations
```

## Usage

```ts
import { GitLabClient, verifyGitLabWebhook } from '@streetjs/gitlab';

const gl = new GitLabClient({ token: process.env.GITLAB_TOKEN! });

// Address projects by id or by path.
const issue = await gl.createIssue('group/app', {
  title: 'Deploy failed',
  description: 'The 15:04 UTC deploy rolled back.',
  labels: 'ops,incident',
});
await gl.createIssueNote('group/app', issue.iid, 'Investigating :mag:');

await gl.createMergeRequest('group/app', {
  source_branch: 'fix/flaky',
  target_branch: 'main',
  title: 'Fix flaky test',
});

await gl.triggerPipeline('group/app', 'main', [{ key: 'DEPLOY_ENV', value: 'prod' }]);
```

### Self-managed GitLab / OAuth

```ts
const gl = new GitLabClient({
  token: process.env.GITLAB_OAUTH_TOKEN!,
  authType: 'bearer',
  baseUrl: 'https://gitlab.acme.com/api/v4',
});
```

### Verifying webhooks

GitLab does not HMAC-sign webhook bodies; it echoes the secret token you
configured on the hook in the `X-Gitlab-Token` header. Compare it in constant
time:

```ts
import { verifyGitLabWebhook } from '@streetjs/gitlab';

app.post('/webhooks/gitlab', (req, res) => {
  const ok = verifyGitLabWebhook({
    secret: process.env.GITLAB_WEBHOOK_SECRET!,
    token: req.header('X-Gitlab-Token') ?? '',
  });
  if (!ok) return res.status(401).end();
  // ... handle the event
});
```

## API

### `new GitLabClient(options)`

| Option | Type | Default | Notes |
|---|---|---|---|
| `token` | `string` | — | Required. Access token. |
| `authType` | `'private-token' \| 'bearer'` | `private-token` | Auth scheme. |
| `baseUrl` | `string` | `https://gitlab.com/api/v4` | Set for self-managed. |
| `fetch` | `FetchLike` | global `fetch` | Injectable for tests. |
| `retries` | `number` | `2` | Idempotent-retry attempts (GET/HEAD only). |
| `sleep` | `(ms) => Promise<void>` | `setTimeout` | Backoff hook. |

Methods: `getProject`, `listIssues`, `createIssue`, `createIssueNote`,
`createMergeRequest`, `triggerPipeline`. Non-2xx responses throw
`IntegrationRequestError` (from `@streetjs/integrations`).

### `verifyGitLabWebhook({ secret, token })`

Returns `true` only when the header token matches the secret (constant-time;
empty values return `false`).

## License

MIT — see [LICENSE](./LICENSE).
