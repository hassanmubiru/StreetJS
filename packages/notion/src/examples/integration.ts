// src/examples/integration.ts
// Runnable, no-network example: an in-memory fake fetch stands in for Notion.

import { createHmac } from 'node:crypto';
import { NotionClient, verifyNotionWebhook } from '../index.js';

async function main(): Promise<void> {
  const fakeFetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    if (url.endsWith('/pages') && init.method === 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ object: 'page', id: 'page-123', url: 'https://notion.so/page-123' }) };
    }
    if (url.endsWith('/query') && init.method === 'POST') {
      return { ok: true, status: 200, text: async () => JSON.stringify({ object: 'list', results: [{ object: 'page', id: 'page-123' }], next_cursor: null, has_more: false }) };
    }
    return { ok: false, status: 404, text: async () => '{"message":"Not Found"}' };
  };

  const notion = new NotionClient({ token: 'demo-token', fetch: fakeFetch });

  const page = await notion.createPage({
    parent: { database_id: 'db-1' },
    properties: { Name: { title: [{ text: { content: 'Deploy failed' } }] } },
  });
  console.log('created page', page.id);

  const list = await notion.queryDatabase('db-1', { page_size: 10 });
  console.log('query returned', list.results.length, 'result(s)');

  // Verify an inbound webhook the way an HTTP handler would.
  const secret = 'verification-token';
  const payload = JSON.stringify({ type: 'page.updated', entity: { id: 'page-123' } });
  const signature = 'sha256=' + createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  console.log('valid webhook signature:', verifyNotionWebhook({ secret, body: payload, signature }));
  console.log('forged webhook signature:', verifyNotionWebhook({ secret, body: payload, signature: 'sha256=deadbeef' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
