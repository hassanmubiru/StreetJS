// src/examples/integration.ts
// Runnable, no-network example: an in-memory fake fetch stands in for GitLab.

import { GitLabClient, verifyGitLabWebhook } from '../index.js';

async function main(): Promise<void> {
  const fakeFetch = async (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ) => {
    if (url.endsWith('/projects/group%2Fapp')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ id: 7, name: 'app', path_with_namespace: 'group/app', default_branch: 'main', web_url: 'https://gitlab.com/group/app' }),
      };
    }
    if (url.endsWith('/issues') && init.method === 'POST') {
      const input = JSON.parse(init.body ?? '{}');
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({ id: 1, iid: 12, project_id: 7, title: input.title, state: 'opened', web_url: 'https://gitlab.com/group/app/-/issues/12' }),
      };
    }
    return { ok: false, status: 404, text: async () => '{"message":"404 Not Found"}' };
  };

  const gl = new GitLabClient({ token: 'demo-token', fetch: fakeFetch });

  const proj = await gl.getProject('group/app');
  console.log('project:', proj.path_with_namespace, '(default branch:', proj.default_branch + ')');

  const issue = await gl.createIssue('group/app', { title: 'Deploy failed', labels: 'ops' });
  console.log('created issue !' + issue.iid + ':', issue.title, '→', issue.web_url);

  // Verify an inbound webhook the way an HTTP handler would.
  const secret = 'webhook-secret';
  console.log('valid webhook token:', verifyGitLabWebhook({ secret, token: secret }));
  console.log('forged webhook token:', verifyGitLabWebhook({ secret, token: 'guess' }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
