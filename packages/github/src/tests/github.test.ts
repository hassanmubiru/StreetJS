// src/tests/github.test.ts
// CI-safe: every request goes through an injected fetch. No live GitHub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import { GitHubClient, verifyGitHubWebhook } from '../index.js';

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** Build an injectable fetch that records requests and replays queued responses. */
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

test('GitHubClient requires a token', () => {
  assert.throws(() => new GitHubClient({ token: '' }), /token is required/);
});

test('getRepo issues a GET with bearer auth + GitHub headers', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ id: 1, name: 'app', full_name: 'acme/app', private: false, default_branch: 'main', html_url: 'u' }) },
  ]);
  const gh = new GitHubClient({ token: 'tok', fetch });
  const repo = await gh.getRepo('acme', 'app');

  assert.equal(repo.full_name, 'acme/app');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app');
  assert.equal(calls[0].headers['authorization'], 'Bearer tok');
  assert.equal(calls[0].headers['accept'], 'application/vnd.github+json');
  assert.equal(calls[0].headers['x-github-api-version'], '2022-11-28');
});

test('listIssues appends query params', async () => {
  const { fetch, calls } = makeFetch([{ body: '[]' }]);
  const gh = new GitHubClient({ token: 'tok', fetch });
  const issues = await gh.listIssues('acme', 'app', { state: 'open', labels: 'bug', per_page: 50 });

  assert.deepEqual(issues, []);
  assert.match(calls[0].url, /\/repos\/acme\/app\/issues\?/);
  assert.match(calls[0].url, /state=open/);
  assert.match(calls[0].url, /labels=bug/);
  assert.match(calls[0].url, /per_page=50/);
});

test('createIssue POSTs a JSON body', async () => {
  const { fetch, calls } = makeFetch([
    { status: 201, body: JSON.stringify({ id: 5, number: 42, title: 'Bug', state: 'open', html_url: 'u' }) },
  ]);
  const gh = new GitHubClient({ token: 'tok', fetch });
  const issue = await gh.createIssue('acme', 'app', { title: 'Bug', body: 'boom', labels: ['ops'] });

  assert.equal(issue.number, 42);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app/issues');
  assert.equal(calls[0].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].body!), { title: 'Bug', body: 'boom', labels: ['ops'] });
});

test('updateIssue PATCHes, commentOnIssue POSTs the comment body', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ id: 5, number: 42, title: 'Bug', state: 'closed', html_url: 'u' }) },
    { status: 201, body: JSON.stringify({ id: 9, body: 'done', html_url: 'u' }) },
  ]);
  const gh = new GitHubClient({ token: 'tok', fetch });

  const updated = await gh.updateIssue('acme', 'app', 42, { state: 'closed' });
  assert.equal(updated.state, 'closed');
  assert.equal(calls[0].method, 'PATCH');
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app/issues/42');

  const comment = await gh.commentOnIssue('acme', 'app', 42, 'done');
  assert.equal(comment.body, 'done');
  assert.equal(calls[1].method, 'POST');
  assert.equal(calls[1].url, 'https://api.github.com/repos/acme/app/issues/42/comments');
  assert.deepEqual(JSON.parse(calls[1].body!), { body: 'done' });
});

test('createPullRequest and createRelease hit the right endpoints', async () => {
  const { fetch, calls } = makeFetch([
    { status: 201, body: JSON.stringify({ id: 1, number: 7, title: 'PR', state: 'open', html_url: 'u', draft: true }) },
    { status: 201, body: JSON.stringify({ id: 2, tag_name: 'v1.0.0', html_url: 'u', draft: false, prerelease: false }) },
  ]);
  const gh = new GitHubClient({ token: 'tok', fetch });

  const pr = await gh.createPullRequest('acme', 'app', { title: 'PR', head: 'feat', base: 'main', draft: true });
  assert.equal(pr.number, 7);
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app/pulls');
  assert.deepEqual(JSON.parse(calls[0].body!), { title: 'PR', head: 'feat', base: 'main', draft: true });

  const rel = await gh.createRelease('acme', 'app', { tag_name: 'v1.0.0', name: 'v1' });
  assert.equal(rel.tag_name, 'v1.0.0');
  assert.equal(calls[1].url, 'https://api.github.com/repos/acme/app/releases');
});

test('repositoryDispatch and dispatchWorkflow POST and tolerate a 204 empty body', async () => {
  const { fetch, calls } = makeFetch([
    { status: 204, body: '' },
    { status: 204, body: '' },
    { status: 204, body: '' },
    { status: 204, body: '' },
  ]);
  const gh = new GitHubClient({ token: 'tok', fetch });

  await gh.repositoryDispatch('acme', 'app', 'deploy', { env: 'prod' });
  assert.equal(calls[0].url, 'https://api.github.com/repos/acme/app/dispatches');
  assert.deepEqual(JSON.parse(calls[0].body!), { event_type: 'deploy', client_payload: { env: 'prod' } });

  await gh.repositoryDispatch('acme', 'app', 'ping');
  assert.deepEqual(JSON.parse(calls[1].body!), { event_type: 'ping' });

  await gh.dispatchWorkflow('acme', 'app', 'ci.yml', 'main', { level: 'full' });
  assert.equal(calls[2].url, 'https://api.github.com/repos/acme/app/actions/workflows/ci.yml/dispatches');
  assert.deepEqual(JSON.parse(calls[2].body!), { ref: 'main', inputs: { level: 'full' } });

  await gh.dispatchWorkflow('acme', 'app', 12345, 'main');
  assert.equal(calls[3].url, 'https://api.github.com/repos/acme/app/actions/workflows/12345/dispatches');
  assert.deepEqual(JSON.parse(calls[3].body!), { ref: 'main' });
});

test('a non-2xx response throws with the status and body', async () => {
  const { fetch } = makeFetch([{ status: 422, ok: false, body: '{"message":"Validation Failed"}' }]);
  const gh = new GitHubClient({ token: 'tok', fetch });
  await assert.rejects(() => gh.createIssue('acme', 'app', { title: '' }), (err: Error) => {
    assert.match(err.message, /422/);
    return true;
  });
});

test('a custom baseUrl (GHE) and apiVersion are honored', async () => {
  const { fetch, calls } = makeFetch([{ body: '{"id":1,"name":"x","full_name":"o/x","private":true,"default_branch":"main","html_url":"u"}' }]);
  const gh = new GitHubClient({
    token: 'tok',
    baseUrl: 'https://ghe.acme.com/api/v3',
    apiVersion: '2022-01-01',
    fetch,
  });
  await gh.getRepo('o', 'x');
  assert.equal(calls[0].url, 'https://ghe.acme.com/api/v3/repos/o/x');
  assert.equal(calls[0].headers['x-github-api-version'], '2022-01-01');
});

test('verifyGitHubWebhook accepts a valid sha256 signature', () => {
  const secret = 's3cr3t';
  const body = '{"action":"opened"}';
  const sig = 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');
  assert.equal(verifyGitHubWebhook({ secret, body, signature: sig }), true);
});

test('verifyGitHubWebhook rejects a wrong secret, a tampered body, and a missing/legacy signature', () => {
  const secret = 's3cr3t';
  const body = '{"action":"opened"}';
  const sig = 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex');

  assert.equal(verifyGitHubWebhook({ secret: 'wrong', body, signature: sig }), false);
  assert.equal(verifyGitHubWebhook({ secret, body: body + ' ', signature: sig }), false);
  assert.equal(verifyGitHubWebhook({ secret, body, signature: '' }), false);
  const sha1 = 'sha1=' + createHmac('sha1', secret).update(body, 'utf8').digest('hex');
  assert.equal(verifyGitHubWebhook({ secret, body, signature: sha1 }), false);
});
