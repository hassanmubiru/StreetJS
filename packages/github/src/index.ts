/**
 * @streetjs/github — the StreetJS GitHub connector.
 *
 * A typed GitHub REST API client built on `@streetjs/integrations` (issues,
 * comments, pull requests, releases, and workflow/repository dispatch), plus
 * `verifyGitHubWebhook` for validating inbound `X-Hub-Signature-256` webhook
 * signatures with a constant-time HMAC-SHA256 check.
 *
 * ```ts
 * import { GitHubClient, verifyGitHubWebhook } from '@streetjs/github';
 *
 * const gh = new GitHubClient({ token: process.env.GITHUB_TOKEN! });
 * const issue = await gh.createIssue('acme', 'app', { title: 'Deploy failed', labels: ['ops'] });
 * await gh.commentOnIssue('acme', 'app', issue.number, 'Investigating :mag:');
 * ```
 */

export { GitHubClient } from './client.js';
export type {
  GitHubClientOptions,
  GitHubIssue,
  GitHubPullRequest,
  GitHubRepo,
  GitHubComment,
  GitHubRelease,
  CreateIssueInput,
  UpdateIssueInput,
  CreatePullRequestInput,
  CreateReleaseInput,
  ListIssuesParams,
} from './client.js';

export { verifyGitHubWebhook } from './webhook.js';
export type { GitHubVerifyInput } from './webhook.js';
