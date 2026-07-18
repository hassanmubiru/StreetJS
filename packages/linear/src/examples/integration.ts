// src/examples/integration.ts
// Runnable, no-network example: an in-memory fake fetch stands in for Linear.

import { createHmac } from 'node:crypto';
import { LinearClient, verifyLinearWebhook } from '../index.js';

async function main(): Promise<void> {
  const fakeFetch = async (
    _url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const payload = JSON.parse(init.body ?? '{}');
    const query: string = payload.query ?? '';
    if (query.includes('viewer')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { viewer: { id: 'u1', name: 'Ada Lovelace', email: 'ada@acme.com' } } }) };
    }
    if (query.includes('issueCreate')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'i1', identifier: 'ENG-42', title: payload.variables.input.title, url: 'https://linear.app/acme/issue/ENG-42' } } } }) };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify({ errors: [{ message: 'Unknown operation' }] }) };
  };

  const linear = new LinearClient({ apiKey: 'demo-key', fetch: fakeFetch });

  const me = await linear.viewer();
  console.log('viewer:', me.name, '(' + me.email + ')');

  const issue = await linear.createIssue({ teamId: 'team-1', title: 'Deploy failed' });
  console.log('created issue', issue.identifier, '→', issue.url);

  // Verify an inbound webhook the way an HTTP handler would.
  const secret = 'webhook-signing-secret';
  const payload = JSON.stringify({ action: 'create', type: 'Issue', data: { id: 'i1' } });
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  console.log('valid webhook signature:', verifyLinearWebhook({ secret, body: payload, signature }));
  console.log('forged webhook signature:', verifyLinearWebhook({ secret, body: payload, signature: 'deadbeef' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
