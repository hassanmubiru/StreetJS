// src/tests/notion.test.ts
// CI-safe: every request goes through an injected fetch. No live Notion.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { NotionClient, verifyNotionWebhook } from '../index.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

function makeFetch(
  responses: Array<{ ok?: boolean; status?: number; body?: string }>,
): { fetch: (u: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>; calls: Captured[] } {
  const calls: Captured[] = [];
  let i = 0;
  const fetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    const c: Captured = { url, method: init.method, headers: init.headers };
    if (init.body !== undefined) c.body = init.body;
    calls.push(c);
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    const status = r.status ?? 200;
    const ok = r.ok ?? (status >= 200 && status < 300);
    return { ok, status, text: async () => r.body ?? '' };
  };
  return { fetch, calls };
}

test('NotionClient requires a token', () => {
  assert.throws(() => new NotionClient({ token: '' }), /token is required/);
});

test('retrievePage GETs with bearer auth + Notion-Version header', async () => {
  const { fetch, calls } = makeFetch([{ body: JSON.stringify({ object: 'page', id: 'p1' }) }]);
  const notion = new NotionClient({ token: 'secret_x', fetch });
  const page = await notion.retrievePage('p1');

  assert.equal(page.id, 'p1');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.notion.com/v1/pages/p1');
  assert.equal(calls[0].headers['authorization'], 'Bearer secret_x');
  assert.equal(calls[0].headers['notion-version'], '2022-06-28');
});

test('a custom notionVersion is honored', async () => {
  const { fetch, calls } = makeFetch([{ body: JSON.stringify({ object: 'page', id: 'p1' }) }]);
  const notion = new NotionClient({ token: 't', notionVersion: '2025-09-03', fetch });
  await notion.retrievePage('p1');
  assert.equal(calls[0].headers['notion-version'], '2025-09-03');
});

test('createPage and updatePage send the right verbs + bodies', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ object: 'page', id: 'p2' }) },
    { body: JSON.stringify({ object: 'page', id: 'p2' }) },
  ]);
  const notion = new NotionClient({ token: 't', fetch });

  const created = await notion.createPage({
    parent: { database_id: 'db1' },
    properties: { Name: { title: [{ text: { content: 'Hi' } }] } },
  });
  assert.equal(created.id, 'p2');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.notion.com/v1/pages');
  assert.deepEqual(JSON.parse(calls[0].body!).parent, { database_id: 'db1' });

  await notion.updatePage('p2', { archived: true });
  assert.equal(calls[1].method, 'PATCH');
  assert.equal(calls[1].url, 'https://api.notion.com/v1/pages/p2');
  assert.deepEqual(JSON.parse(calls[1].body!), { archived: true });
});

test('retrieveDatabase, queryDatabase, appendBlockChildren, search hit the right endpoints', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ object: 'database', id: 'db1' }) },
    { body: JSON.stringify({ object: 'list', results: [], next_cursor: null, has_more: false }) },
    { body: JSON.stringify({ object: 'block', id: 'b1' }) },
    { body: JSON.stringify({ object: 'list', results: [], next_cursor: null, has_more: false }) },
  ]);
  const notion = new NotionClient({ token: 't', fetch });

  await notion.retrieveDatabase('db1');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.notion.com/v1/databases/db1');

  const list = await notion.queryDatabase('db1', { page_size: 5 });
  assert.equal(list.object, 'list');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, 'https://api.notion.com/v1/databases/db1/query');
  assert.deepEqual(JSON.parse(calls[1].body!), { page_size: 5 });

  await notion.appendBlockChildren('b1', [{ type: 'paragraph', paragraph: { rich_text: [] } }]);
  assert.equal(calls[2].method, 'PATCH');
  assert.equal(calls[2].url, 'https://api.notion.com/v1/blocks/b1/children');

  await notion.search({ query: 'roadmap', filter: { value: 'page', property: 'object' } });
  assert.equal(calls[3].url, 'https://api.notion.com/v1/search');
  assert.equal(JSON.parse(calls[3].body!).query, 'roadmap');
});

test('a non-2xx response throws with the status', async () => {
  const { fetch } = makeFetch([{ status: 401, ok: false, body: '{"message":"API token is invalid."}' }]);
  const notion = new NotionClient({ token: 't', fetch });
  await assert.rejects(() => notion.retrievePage('p1'), /401/);
});

test('verifyNotionWebhook validates the X-Notion-Signature HMAC', () => {
  const secret = 'verif_token';
  const body = '{"type":"page.updated"}';
  const sig = 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  assert.equal(verifyNotionWebhook({ secret, body, signature: sig }), true);
  assert.equal(verifyNotionWebhook({ secret: 'wrong', body, signature: sig }), false);
  assert.equal(verifyNotionWebhook({ secret, body: body + ' ', signature: sig }), false);
  assert.equal(verifyNotionWebhook({ secret, body, signature: '' }), false);
  // Missing the sha256= prefix → rejected.
  const bare = createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  assert.equal(verifyNotionWebhook({ secret, body, signature: bare }), false);
});
