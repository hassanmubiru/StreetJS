// src/examples/integration.ts
// Runnable, no-network example: an in-memory fake fetch stands in for GitHub,
// so `npm run example` demonstrates the client + webhook verification offline.

import { createHmac } from 'node:crypto';
import { GitHubClient, verifyGitHubWebhook } from '../index.js';

async function main(): Promise<void> {
  // A tiny fake "GitHub" that answers a couple of endpoints.
  const fakeFetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    if (url.endsWith('/repos/acme/app')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ id: 1, name: 'app', full_name: 'acme/app', private: false, default_branch: 'main', html_url: 'https://github.com/acme/app' }),
      };
    }
    if (url.endsWith('/issues') && init.method === 'POST') {
      const input = JSON.parse(init.body ?? '{}');
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({ id: 99, number: 42, title: input.title, state: 'open', html_url: 'https://github.com/acme/app/issues/42' }),
      };
    }
    return { ok: false, status: 404, text: async () => '{"message":"Not Found"}' };
  };

  const gh = new GitHubClient({ token: 'demo-token', fetch: fakeFetch });

  const repo = await gh.getRepo('acme', 'app');
  console.log('repo:', repo.full_name, '(default branch:', repo.default_branch + ')');

  const issue = await gh.createIssue('acme', 'app', { title: 'Deploy failed', labels: ['ops'] });
  console.log('created issue #' + issue.number + ':', issue.title, '→', issue.html_url);

  // Verify an inbound webhook the way an HTTP handler would.
  const secret = 'webhook-secret';
  const payload = JSON.stringify({ action: 'opened', number: 42 });
  const signature = 'sha256=' + createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  console.log('valid webhook signature:', verifyGitHubWebhook({ secret, body: payload, signature }));
  console.log('forged webhook signature:', verifyGitHubWebhook({ secret, body: payload, signature: 'sha256=deadbeef' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
