// src/tests/linear.test.ts
// CI-safe: every request goes through an injected fetch. No live Linear.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { LinearClient, verifyLinearWebhook } from '../index.js';

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

test('LinearClient requires an apiKey', () => {
  assert.throws(() => new LinearClient({ apiKey: '' }), /apiKey is required/);
});

test('viewer POSTs a GraphQL query with the raw Authorization key', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ data: { viewer: { id: 'u1', name: 'Ada', email: 'ada@acme.com' } } }) },
  ]);
  const linear = new LinearClient({ apiKey: 'lin_key', fetch });
  const me = await linear.viewer();

  assert.equal(me.name, 'Ada');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.linear.app/graphql');
  assert.equal(calls[0].headers['authorization'], 'lin_key'); // raw, no Bearer
  assert.match(JSON.parse(calls[0].body!).query, /viewer/);
});

test('bearer auth mode prefixes the token', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ data: { viewer: { id: 'u1', name: 'Ada', email: 'a@a.com' } } }) },
  ]);
  const linear = new LinearClient({ apiKey: 'oauth_tok', authType: 'bearer', fetch });
  await linear.viewer();
  assert.equal(calls[0].headers['authorization'], 'Bearer oauth_tok');
});

test('createIssue sends the mutation + input and returns the issue', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ data: { issueCreate: { success: true, issue: { id: 'i1', identifier: 'ENG-1', title: 'Bug', url: 'u' } } } }) },
  ]);
  const linear = new LinearClient({ apiKey: 'k', fetch });
  const issue = await linear.createIssue({ teamId: 't1', title: 'Bug', priority: 2 });

  assert.equal(issue.identifier, 'ENG-1');
  const payload = JSON.parse(calls[0].body!);
  assert.match(payload.query, /issueCreate/);
  assert.deepEqual(payload.variables.input, { teamId: 't1', title: 'Bug', priority: 2 });
});

test('createComment returns the comment id', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ data: { commentCreate: { success: true, comment: { id: 'c1' } } } }) },
  ]);
  const linear = new LinearClient({ apiKey: 'k', fetch });
  const c = await linear.createComment('i1', 'looking into it');
  assert.equal(c.id, 'c1');
  assert.deepEqual(JSON.parse(calls[0].body!).variables.input, { issueId: 'i1', body: 'looking into it' });
});

test('getIssue passes the id variable', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ data: { issue: { id: 'i1', identifier: 'ENG-1', title: 'Bug', url: 'u' } } }) },
  ]);
  const linear = new LinearClient({ apiKey: 'k', fetch });
  const issue = await linear.getIssue('i1');
  assert.equal(issue.identifier, 'ENG-1');
  assert.deepEqual(JSON.parse(calls[0].body!).variables, { id: 'i1' });
});

test('a GraphQL errors array throws even on HTTP 200', async () => {
  const { fetch } = makeFetch([{ body: JSON.stringify({ errors: [{ message: 'Not authorized' }] }) }]);
  const linear = new LinearClient({ apiKey: 'k', fetch });
  await assert.rejects(() => linear.viewer(), /Not authorized/);
});

test('a missing data field throws, and success=false mutations throw', async () => {
  const linear1 = new LinearClient({ apiKey: 'k', fetch: makeFetch([{ body: '{}' }]).fetch });
  await assert.rejects(() => linear1.viewer(), /no data/);

  const linear2 = new LinearClient({
    apiKey: 'k',
    fetch: makeFetch([{ body: JSON.stringify({ data: { issueCreate: { success: false, issue: null } } }) }]).fetch,
  });
  await assert.rejects(() => linear2.createIssue({ teamId: 't', title: 'x' }), /success=false/);

  const linear3 = new LinearClient({
    apiKey: 'k',
    fetch: makeFetch([{ body: JSON.stringify({ data: { commentCreate: { success: false, comment: null } } }) }]).fetch,
  });
  await assert.rejects(() => linear3.createComment('i', 'x'), /success=false/);
});

test('a non-2xx HTTP response throws with the status', async () => {
  const { fetch } = makeFetch([{ status: 401, ok: false, body: 'Unauthorized' }]);
  const linear = new LinearClient({ apiKey: 'k', fetch });
  await assert.rejects(() => linear.viewer(), /401/);
});

test('verifyLinearWebhook validates the Linear-Signature HMAC', () => {
  const secret = 'whsec';
  const body = '{"action":"create","type":"Issue"}';
  const sig = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  assert.equal(verifyLinearWebhook({ secret, body, signature: sig }), true);
  assert.equal(verifyLinearWebhook({ secret: 'wrong', body, signature: sig }), false);
  assert.equal(verifyLinearWebhook({ secret, body: body + ' ', signature: sig }), false);
  assert.equal(verifyLinearWebhook({ secret, body, signature: '' }), false);
});
