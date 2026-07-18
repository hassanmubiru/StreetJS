/**
 * @streetjs/jira — the StreetJS Jira connector.
 *
 * A typed Jira Cloud REST API v3 client built on `@streetjs/integrations`
 * (issues, comments, transitions, assignment, JQL search) with HTTP Basic
 * (email + API token) auth and automatic plain-text→ADF conversion, plus
 * `verifyJiraWebhook` for HMAC-SHA256 validation of signed inbound webhooks.
 *
 * ```ts
 * import { JiraClient } from '@streetjs/jira';
 *
 * const jira = new JiraClient({
 *   host: 'acme.atlassian.net',
 *   email: process.env.JIRA_EMAIL!,
 *   apiToken: process.env.JIRA_API_TOKEN!,
 * });
 * const issue = await jira.createIssue({ projectKey: 'ENG', issueType: 'Bug', summary: 'Deploy failed' });
 * ```
 */

export { JiraClient } from './client.js';
export type {
  JiraClientOptions,
  JiraIssue,
  JiraCreatedIssue,
  JiraTransition,
  JiraSearchResult,
  CreateIssueInput,
  SearchParams,
} from './client.js';

export { textToAdf } from './adf.js';
export type { AdfDocument, AdfNode } from './adf.js';

export { verifyJiraWebhook } from './webhook.js';
export type { JiraVerifyInput } from './webhook.js';
