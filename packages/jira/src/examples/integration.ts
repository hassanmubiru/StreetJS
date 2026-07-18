// src/examples/integration.ts
// Runnable, no-network example: an in-memory fake fetch stands in for Jira.

import { createHmac } from 'node:crypto';
import { JiraClient, verifyJiraWebhook } from '../index.js';

async function main(): Promise<void> {
  const fakeFetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    if (url.endsWith('/issue') && init.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: '10001', key: 'ENG-42', self: 'https://acme.atlassian.net/rest/api/3/issue/10001' }) };
    }
    if (url.endsWith('/issue/ENG-42/comment') && init.method === 'POST') {
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: '20001' }) };
    }
    return { ok: false, status: 404, text: async () => '{"errorMessages":["Not Found"]}' };
  };

  const jira = new JiraClient({
    host: 'acme.atlassian.net',
    email: 'demo@acme.com',
    apiToken: 'demo-token',
    fetch: fakeFetch,
  });

  const issue = await jira.createIssue({
    projectKey: 'ENG',
    issueType: 'Bug',
    summary: 'Deploy failed',
    description: 'The 15:04 UTC deploy rolled back.\n\nInvestigating.',
    labels: ['ops', 'incident'],
  });
  console.log('created issue', issue.key, '→', issue.self);

  const comment = await jira.addComment('ENG-42', 'Root cause identified :white_check_mark:');
  console.log('added comment', comment.id);

  // Verify a (hardened) signed webhook the way an HTTP handler would.
  const secret = 'webhook-secret';
  const payload = JSON.stringify({ webhookEvent: 'jira:issue_updated', issue: { key: 'ENG-42' } });
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  console.log('valid webhook signature:', verifyJiraWebhook({ secret, body: payload, signature }));
  console.log('forged webhook signature:', verifyJiraWebhook({ secret, body: payload, signature: 'deadbeef' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
