# @streetjs/jira

The StreetJS **Jira connector**: a typed Jira Cloud REST API v3 client built on
[`@streetjs/integrations`](https://www.npmjs.com/package/@streetjs/integrations),
with HTTP Basic auth, automatic plain-text→ADF conversion, and HMAC webhook
verification.

- Basic auth (email + API token), injectable `fetch` (unit-testable, no live calls).
- Typed methods for issues, comments, transitions, assignment, and JQL search.
- Plain-text descriptions/comments are converted to Atlassian Document Format automatically.
- `verifyJiraWebhook` validates HMAC-SHA256-signed inbound webhooks in constant time.

## Install

```sh
npm install @streetjs/jira @streetjs/integrations
```

## Usage

```ts
import { JiraClient } from '@streetjs/jira';

const jira = new JiraClient({
  host: 'acme.atlassian.net',
  email: process.env.JIRA_EMAIL!,
  apiToken: process.env.JIRA_API_TOKEN!, // create at id.atlassian.com
});

const issue = await jira.createIssue({
  projectKey: 'ENG',
  issueType: 'Bug',
  summary: 'Deploy failed',
  description: 'The 15:04 UTC deploy rolled back.',
  labels: ['ops', 'incident'],
});

await jira.addComment(issue.key, 'Investigating :mag:');

// Move it through the workflow.
const transitions = await jira.getTransitions(issue.key);
const done = transitions.find((t) => t.name === 'Done');
if (done) await jira.transitionIssue(issue.key, done.id);

// Search with JQL.
const result = await jira.searchJql('project = ENG AND status = "To Do" ORDER BY created DESC', {
  maxResults: 25,
});
```

### Atlassian Document Format

Jira Cloud v3 expects rich-text fields as ADF. This connector converts plain
strings for you; `textToAdf` is also exported if you need to build a field
value directly. Pass richer content via `extraFields` on `createIssue`.

### Verifying webhooks

Jira Cloud "system" webhooks are unauthenticated by default. The recommended
hardening is to have the sender (a webhook proxy or a Jira Automation
"Send web request" rule) include an HMAC-SHA256 signature of the raw body keyed
by a shared secret, then validate it:

```ts
import { verifyJiraWebhook } from '@streetjs/jira';

app.post('/webhooks/jira', (req, res) => {
  const ok = verifyJiraWebhook({
    secret: process.env.JIRA_WEBHOOK_SECRET!,
    body: req.rawBody,
    signature: req.header('X-Hub-Signature-256') ?? '',
    prefix: 'sha256=',
  });
  if (!ok) return res.status(401).end();
  // ... handle the event
});
```

## API

### `new JiraClient(options)`

| Option | Type | Notes |
|---|---|---|
| `host` | `string` | Required. e.g. `acme.atlassian.net`. |
| `email` | `string` | Required. Basic auth username. |
| `apiToken` | `string` | Required. Basic auth password. |
| `fetch` | `FetchLike` | Injectable for tests (defaults to global `fetch`). |
| `retries` | `number` | Idempotent-retry attempts (GET/HEAD only). Default 2. |
| `sleep` | `(ms) => Promise<void>` | Backoff hook. |

Methods: `getIssue`, `createIssue`, `addComment`, `getTransitions`,
`transitionIssue`, `assignIssue`, `searchJql`. Non-2xx responses throw
`IntegrationRequestError` (from `@streetjs/integrations`).

### `verifyJiraWebhook({ secret, body, signature, prefix? })`

Returns `true` only for a valid HMAC-SHA256 signature over `body`.

## License

MIT — see [LICENSE](./LICENSE).
