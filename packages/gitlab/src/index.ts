/**
 * @streetjs/gitlab — the StreetJS GitLab connector.
 *
 * A typed GitLab REST API v4 client built on `@streetjs/integrations`
 * (projects, issues, notes, merge requests, pipeline triggers), plus
 * `verifyGitLabWebhook` for validating the inbound `X-Gitlab-Token` secret in
 * constant time.
 *
 * ```ts
 * import { GitLabClient, verifyGitLabWebhook } from '@streetjs/gitlab';
 *
 * const gl = new GitLabClient({ token: process.env.GITLAB_TOKEN! });
 * const issue = await gl.createIssue('group/app', { title: 'Deploy failed' });
 * ```
 */

export { GitLabClient } from './client.js';
export type {
  GitLabClientOptions,
  GitLabAuthType,
  GitLabProject,
  GitLabIssue,
  GitLabNote,
  GitLabMergeRequest,
  GitLabPipeline,
  CreateIssueInput,
  CreateMergeRequestInput,
  ListIssuesParams,
} from './client.js';

export { verifyGitLabWebhook } from './webhook.js';
export type { GitLabVerifyInput } from './webhook.js';
