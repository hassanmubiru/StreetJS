// src/client.ts
// Typed Jira Cloud REST API v3 client built on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions } from '@streetjs/integrations';
import { textToAdf, type AdfDocument } from './adf.js';

/** A Jira issue (subset of fields the connector surfaces). */
export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields?: Record<string, unknown>;
  [key: string]: unknown;
}

/** A created-issue response (Jira returns id/key/self only). */
export interface JiraCreatedIssue {
  id: string;
  key: string;
  self: string;
}

/** A Jira transition (subset). */
export interface JiraTransition {
  id: string;
  name: string;
  [key: string]: unknown;
}

/** A JQL search response (subset). */
export interface JiraSearchResult {
  issues: JiraIssue[];
  total?: number;
  startAt?: number;
  maxResults?: number;
  [key: string]: unknown;
}

export interface CreateIssueInput {
  /** Project key, e.g. `ENG`. */
  projectKey: string;
  /** Issue type name, e.g. `Bug`, `Task`, `Story`. */
  issueType: string;
  summary: string;
  /** Plain-text description; converted to ADF automatically. */
  description?: string;
  /** Label strings. */
  labels?: string[];
  /** Extra raw fields merged into `fields` (assignee, priority, custom, …). */
  extraFields?: Record<string, unknown>;
}

export interface SearchParams {
  startAt?: number;
  maxResults?: number;
  fields?: string;
}

export interface JiraClientOptions {
  /** Your Atlassian site host, e.g. `acme.atlassian.net`. */
  host: string;
  /** Atlassian account email (Basic auth username). */
  email: string;
  /** API token created at id.atlassian.com (Basic auth password). */
  apiToken: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

/**
 * A typed Jira Cloud REST API v3 client. Authenticates with HTTP Basic
 * (email + API token) and converts plain-text descriptions/comments into ADF.
 * Non-2xx responses throw `IntegrationRequestError` with the status and the
 * (truncated) Jira error body.
 */
export class JiraClient extends HttpConnector {
  constructor(options: JiraClientOptions) {
    if (!options?.host) throw new IntegrationError('JiraClient: host is required');
    if (!options?.email || !options?.apiToken) {
      throw new IntegrationError('JiraClient: email and apiToken are required');
    }
    const basic = Buffer.from(`${options.email}:${options.apiToken}`, 'utf8').toString('base64');
    const opts: ConnectorOptions = {
      baseUrl: `https://${options.host}/rest/api/3`,
      auth: { type: 'header', name: 'Authorization', value: `Basic ${basic}` },
      defaultHeaders: { 'content-type': 'application/json' },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Fetch an issue by id or key. */
  async getIssue(idOrKey: string): Promise<JiraIssue> {
    return this.request<JiraIssue>(`/issue/${encodeURIComponent(idOrKey)}`);
  }

  /** Create an issue. Plain-text `description` is converted to ADF. */
  async createIssue(input: CreateIssueInput): Promise<JiraCreatedIssue> {
    const fields: Record<string, unknown> = {
      project: { key: input.projectKey },
      issuetype: { name: input.issueType },
      summary: input.summary,
    };
    if (input.description !== undefined) fields['description'] = textToAdf(input.description);
    if (input.labels !== undefined) fields['labels'] = input.labels;
    if (input.extraFields) Object.assign(fields, input.extraFields);
    return this.request<JiraCreatedIssue>('/issue', { method: 'POST', body: { fields } });
  }

  /** Add a comment (plain text → ADF) to an issue. */
  async addComment(idOrKey: string, text: string): Promise<{ id: string; [key: string]: unknown }> {
    const body: { body: AdfDocument } = { body: textToAdf(text) };
    return this.request(`/issue/${encodeURIComponent(idOrKey)}/comment`, {
      method: 'POST',
      body,
    });
  }

  /** List the transitions currently available on an issue. */
  async getTransitions(idOrKey: string): Promise<JiraTransition[]> {
    const res = await this.request<{ transitions: JiraTransition[] }>(
      `/issue/${encodeURIComponent(idOrKey)}/transitions`,
    );
    return res.transitions ?? [];
  }

  /** Transition an issue to a new status by transition id. Returns nothing (204). */
  async transitionIssue(idOrKey: string, transitionId: string): Promise<void> {
    await this.request<void>(`/issue/${encodeURIComponent(idOrKey)}/transitions`, {
      method: 'POST',
      body: { transition: { id: transitionId } },
    });
  }

  /** Assign an issue to an account (or `null` to unassign). Returns nothing (204). */
  async assignIssue(idOrKey: string, accountId: string | null): Promise<void> {
    await this.request<void>(`/issue/${encodeURIComponent(idOrKey)}/assignee`, {
      method: 'PUT',
      body: { accountId },
    });
  }

  /** Run a JQL search. */
  async searchJql(jql: string, params: SearchParams = {}): Promise<JiraSearchResult> {
    return this.request<JiraSearchResult>('/search', {
      query: { jql, ...params },
    });
  }
}
