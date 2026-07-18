// src/tests/jira.test.ts
// CI-safe: every request goes through an injected fetch. No live Jira.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { JiraClient, verifyJiraWebhook, textToAdf } from '../index.js';

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

function client(fetch: ReturnType<typeof makeFetch>['fetch']): JiraClient {
  return new JiraClient({ host: 'acme.atlassian.net', email: 'me@acme.com', apiToken: 'tok', fetch });
}

test('JiraClient validates required options', () => {
  assert.throws(() => new JiraClient({ host: '', email: 'a', apiToken: 'b' }), /host is required/);
  assert.throws(() => new JiraClient({ host: 'h', email: '', apiToken: 'b' }), /email and apiToken/);
  assert.throws(() => new JiraClient({ host: 'h', email: 'a', apiToken: '' }), /email and apiToken/);
});

test('getIssue GETs with Basic auth against the site base', async () => {
  const { fetch, calls } = makeFetch([{ body: JSON.stringify({ id: '1', key: 'ENG-1', self: 'u' }) }]);
  const jira = client(fetch);
  const issue = await jira.getIssue('ENG-1');

  assert.equal(issue.key, 'ENG-1');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://acme.atlassian.net/rest/api/3/issue/ENG-1');
  const expected = 'Basic ' + Buffer.from('me@acme.com:tok', 'utf8').toString('base64');
  assert.equal(calls[0].headers['authorization'], expected);
});

test('createIssue builds a fields payload with ADF description + labels', async () => {
  const { fetch, calls } = makeFetch([{ status: 201, body: JSON.stringify({ id: '10', key: 'ENG-10', self: 'u' }) }]);
  const jira = client(fetch);
  const created = await jira.createIssue({
    projectKey: 'ENG',
    issueType: 'Bug',
    summary: 'Deploy failed',
    description: 'line one\nline two',
    labels: ['ops'],
    extraFields: { priority: { name: 'High' } },
  });

  assert.equal(created.key, 'ENG-10');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://acme.atlassian.net/rest/api/3/issue');
  const payload = JSON.parse(calls[0].body!);
  assert.deepEqual(payload.fields.project, { key: 'ENG' });
  assert.deepEqual(payload.fields.issuetype, { name: 'Bug' });
  assert.equal(payload.fields.summary, 'Deploy failed');
  assert.deepEqual(payload.fields.labels, ['ops']);
  assert.deepEqual(payload.fields.priority, { name: 'High' });
  // Description is ADF with two paragraphs.
  assert.equal(payload.fields.description.type, 'doc');
  assert.equal(payload.fields.description.content.length, 2);
  assert.equal(payload.fields.description.content[0].content[0].text, 'line one');
});

test('addComment wraps text in ADF, getTransitions unwraps the list', async () => {
  const { fetch, calls } = makeFetch([
    { status: 201, body: JSON.stringify({ id: '99' }) },
    { body: JSON.stringify({ transitions: [{ id: '31', name: 'Done' }] }) },
    { body: JSON.stringify({}) },
  ]);
  const jira = client(fetch);

  const c = await jira.addComment('ENG-1', 'looking into it');
  assert.equal(c.id, '99');
  assert.equal(calls[0].url, 'https://acme.atlassian.net/rest/api/3/issue/ENG-1/comment');
  assert.equal(JSON.parse(calls[0].body!).body.type, 'doc');

  const ts = await jira.getTransitions('ENG-1');
  assert.deepEqual(ts, [{ id: '31', name: 'Done' }]);

  // Missing `transitions` key → empty list, not a throw.
  const empty = await jira.getTransitions('ENG-2');
  assert.deepEqual(empty, []);
});

test('transitionIssue, assignIssue, and searchJql hit the right endpoints', async () => {
  const { fetch, calls } = makeFetch([
    { status: 204, body: '' },
    { status: 204, body: '' },
    { body: JSON.stringify({ issues: [{ id: '1', key: 'ENG-1', self: 'u' }], total: 1 }) },
  ]);
  const jira = client(fetch);

  await jira.transitionIssue('ENG-1', '31');
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://acme.atlassian.net/rest/api/3/issue/ENG-1/transitions');
  assert.deepEqual(JSON.parse(calls[0].body!), { transition: { id: '31' } });

  await jira.assignIssue('ENG-1', null);
  assert.equal(calls[1].method, 'PUT');
  assert.equal(calls[1].url, 'https://acme.atlassian.net/rest/api/3/issue/ENG-1/assignee');
  assert.deepEqual(JSON.parse(calls[1].body!), { accountId: null });

  const res = await jira.searchJql('project = ENG ORDER BY created DESC', { maxResults: 10 });
  assert.equal(res.total, 1);
  assert.match(calls[2].url, /\/search\?/);
  assert.match(calls[2].url, /jql=project/);
  assert.match(calls[2].url, /maxResults=10/);
});

test('a non-2xx response throws with the status', async () => {
  const { fetch } = makeFetch([{ status: 400, ok: false, body: '{"errorMessages":["bad"]}' }]);
  const jira = client(fetch);
  await assert.rejects(() => jira.createIssue({ projectKey: 'ENG', issueType: 'Bug', summary: '' }), /400/);
});

test('textToAdf produces empty paragraphs for blank lines', () => {
  const doc = textToAdf('a\n\nb');
  assert.equal(doc.content.length, 3);
  assert.equal(doc.content[1].content, undefined); // blank line → empty paragraph
});

test('verifyJiraWebhook validates an HMAC-SHA256 signature (with and without prefix)', () => {
  const secret = 's3cr3t';
  const body = '{"webhookEvent":"jira:issue_created"}';
  const hex = createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  assert.equal(verifyJiraWebhook({ secret, body, signature: hex }), true);
  assert.equal(verifyJiraWebhook({ secret, body, signature: 'sha256=' + hex, prefix: 'sha256=' }), true);
  assert.equal(verifyJiraWebhook({ secret: 'wrong', body, signature: hex }), false);
  assert.equal(verifyJiraWebhook({ secret, body: body + ' ', signature: hex }), false);
  assert.equal(verifyJiraWebhook({ secret, body, signature: '' }), false);
});
