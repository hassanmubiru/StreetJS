// src/tests/gitlab.test.ts
// CI-safe: every request goes through an injected fetch. No live GitLab.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GitLabClient, verifyGitLabWebhook } from '../index.js';

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

test('GitLabClient requires a token', () => {
  assert.throws(() => new GitLabClient({ token: '' }), /token is required/);
});

test('getProject GETs with the PRIVATE-TOKEN header by default', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ id: 7, name: 'app', path_with_namespace: 'group/app', default_branch: 'main', web_url: 'u' }) },
  ]);
  const gl = new GitLabClient({ token: 'tok', fetch });
  const proj = await gl.getProject(7);

  assert.equal(proj.path_with_namespace, 'group/app');
  assert.equal(calls[0].method, 'GET');
  assert.equal(calls[0].url, 'https://gitlab.com/api/v4/projects/7');
  assert.equal(calls[0].headers['private-token'], 'tok');
  assert.equal(calls[0].headers['authorization'], undefined);
});

test('bearer auth mode uses the Authorization header', async () => {
  const { fetch, calls } = makeFetch([
    { body: JSON.stringify({ id: 7, name: 'app', path_with_namespace: 'group/app', default_branch: 'main', web_url: 'u' }) },
  ]);
  const gl = new GitLabClient({ token: 'oauth', authType: 'bearer', fetch });
  await gl.getProject('group/app');

  assert.equal(calls[0].headers['authorization'], 'Bearer oauth');
  // Path is URL-encoded ("group/app" → "group%2Fapp").
  assert.equal(calls[0].url, 'https://gitlab.com/api/v4/projects/group%2Fapp');
});

test('listIssues appends query params', async () => {
  const { fetch, calls } = makeFetch([{ body: '[]' }]);
  const gl = new GitLabClient({ token: 'tok', fetch });
  await gl.listIssues('group/app', { state: 'opened', per_page: 20 });

  assert.match(calls[0].url, /\/projects\/group%2Fapp\/issues\?/);
  assert.match(calls[0].url, /state=opened/);
  assert.match(calls[0].url, /per_page=20/);
});

test('createIssue and createIssueNote POST JSON bodies', async () => {
  const { fetch, calls } = makeFetch([
    { status: 201, body: JSON.stringify({ id: 1, iid: 3, project_id: 7, title: 'Bug', state: 'opened', web_url: 'u' }) },
    { status: 201, body: JSON.stringify({ id: 11, body: 'noted' }) },
  ]);
  const gl = new GitLabClient({ token: 'tok', fetch });

  const issue = await gl.createIssue(7, { title: 'Bug', labels: 'ops' });
  assert.equal(issue.iid, 3);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url, 'https://gitlab.com/api/v4/projects/7/issues');
  assert.deepEqual(JSON.parse(calls[0].body!), { title: 'Bug', labels: 'ops' });

  const note = await gl.createIssueNote(7, 3, 'noted');
  assert.equal(note.body, 'noted');
  assert.equal(calls[1].url, 'https://gitlab.com/api/v4/projects/7/issues/3/notes');
  assert.deepEqual(JSON.parse(calls[1].body!), { body: 'noted' });
});

test('createMergeRequest and triggerPipeline hit the right endpoints', async () => {
  const { fetch, calls } = makeFetch([
    { status: 201, body: JSON.stringify({ id: 1, iid: 4, title: 'MR', state: 'opened', source_branch: 'feat', target_branch: 'main', web_url: 'u' }) },
    { status: 201, body: JSON.stringify({ id: 99, status: 'pending', ref: 'main', web_url: 'u' }) },
    { status: 201, body: JSON.stringify({ id: 100, status: 'pending', ref: 'main', web_url: 'u' }) },
  ]);
  const gl = new GitLabClient({ token: 'tok', fetch });

  const mr = await gl.createMergeRequest(7, { source_branch: 'feat', target_branch: 'main', title: 'MR' });
  assert.equal(mr.iid, 4);
  assert.equal(calls[0].url, 'https://gitlab.com/api/v4/projects/7/merge_requests');

  const pipe = await gl.triggerPipeline(7, 'main', [{ key: 'ENV', value: 'prod' }]);
  assert.equal(pipe.id, 99);
  assert.equal(calls[1].url, 'https://gitlab.com/api/v4/projects/7/pipeline');
  assert.deepEqual(JSON.parse(calls[1].body!), { ref: 'main', variables: [{ key: 'ENV', value: 'prod' }] });

  await gl.triggerPipeline(7, 'main');
  assert.deepEqual(JSON.parse(calls[2].body!), { ref: 'main' });
});

test('a non-2xx response throws with the status', async () => {
  const { fetch } = makeFetch([{ status: 404, ok: false, body: '{"message":"404 Project Not Found"}' }]);
  const gl = new GitLabClient({ token: 'tok', fetch });
  await assert.rejects(() => gl.getProject(999), /404/);
});

test('verifyGitLabWebhook compares the X-Gitlab-Token to the secret', () => {
  assert.equal(verifyGitLabWebhook({ secret: 's3cr3t', token: 's3cr3t' }), true);
  assert.equal(verifyGitLabWebhook({ secret: 's3cr3t', token: 'nope' }), false);
  assert.equal(verifyGitLabWebhook({ secret: 's3cr3t', token: '' }), false);
  assert.equal(verifyGitLabWebhook({ secret: '', token: 's3cr3t' }), false);
});
