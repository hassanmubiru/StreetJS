// src/client.ts
// Typed GitHub REST API client built on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions } from '@streetjs/integrations';

/** A GitHub issue (subset of fields the connector surfaces). */
export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  state: string;
  body?: string | null;
  html_url: string;
  [key: string]: unknown;
}

/** A GitHub pull request (subset). */
export interface GitHubPullRequest {
  id: number;
  number: number;
  title: string;
  state: string;
  html_url: string;
  draft?: boolean;
  [key: string]: unknown;
}

/** A GitHub repository (subset). */
export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  [key: string]: unknown;
}

/** An issue/PR comment (subset). */
export interface GitHubComment {
  id: number;
  body: string;
  html_url: string;
  [key: string]: unknown;
}

/** A GitHub release (subset). */
export interface GitHubRelease {
  id: number;
  tag_name: string;
  name?: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  [key: string]: unknown;
}

export interface CreateIssueInput {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number;
}

export interface UpdateIssueInput {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  assignees?: string[];
}

export interface CreatePullRequestInput {
  title: string;
  /** Source branch (e.g. `feature-x` or `owner:feature-x` for forks). */
  head: string;
  /** Target branch (e.g. `main`). */
  base: string;
  body?: string;
  draft?: boolean;
}

export interface CreateReleaseInput {
  tag_name: string;
  name?: string;
  body?: string;
  target_commitish?: string;
  draft?: boolean;
  prerelease?: boolean;
}

export interface ListIssuesParams {
  state?: 'open' | 'closed' | 'all';
  labels?: string;
  per_page?: number;
  page?: number;
}

export interface GitHubClientOptions {
  /** Personal access token, OAuth token, or GitHub App installation token. */
  token: string;
  /** Override the API base (default https://api.github.com; use your GHE host). */
  baseUrl?: string;
  /** Pin the REST API version header. Default 2022-11-28. */
  apiVersion?: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * A typed GitHub REST API client. Uses bearer-token auth, sends the
 * `X-GitHub-Api-Version` header, and exposes typed methods over the shared
 * {@link HttpConnector} (`request`), so every call is unit-testable with an
 * injected fetch. Non-2xx responses throw `IntegrationRequestError` with the
 * status and the (truncated) GitHub error body.
 */
export class GitHubClient extends HttpConnector {
  constructor(options: GitHubClientOptions) {
    if (!options?.token) throw new IntegrationError('GitHubClient: token is required');
    const opts: ConnectorOptions = {
      baseUrl: options.baseUrl ?? 'https://api.github.com',
      auth: { type: 'bearer', token: options.token },
      defaultHeaders: {
        accept: 'application/vnd.github+json',
        'x-github-api-version': options.apiVersion ?? '2022-11-28',
      },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Fetch a repository's metadata. */
  async getRepo(owner: string, repo: string): Promise<GitHubRepo> {
    return this.request<GitHubRepo>(`/repos/${seg(owner)}/${seg(repo)}`);
  }

  /** List issues in a repository. */
  async listIssues(owner: string, repo: string, params: ListIssuesParams = {}): Promise<GitHubIssue[]> {
    return this.request<GitHubIssue[]>(`/repos/${seg(owner)}/${seg(repo)}/issues`, {
      query: { ...params },
    });
  }

  /** Open a new issue. */
  async createIssue(owner: string, repo: string, input: CreateIssueInput): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${seg(owner)}/${seg(repo)}/issues`, {
      method: 'POST',
      body: { ...input },
    });
  }

  /** Update an existing issue (title/body/state/labels/assignees). */
  async updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    input: UpdateIssueInput,
  ): Promise<GitHubIssue> {
    return this.request<GitHubIssue>(`/repos/${seg(owner)}/${seg(repo)}/issues/${issueNumber}`, {
      method: 'PATCH',
      body: { ...input },
    });
  }

  /** Add a comment to an issue or pull request. */
  async commentOnIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<GitHubComment> {
    return this.request<GitHubComment>(
      `/repos/${seg(owner)}/${seg(repo)}/issues/${issueNumber}/comments`,
      { method: 'POST', body: { body } },
    );
  }

  /** Open a pull request. */
  async createPullRequest(
    owner: string,
    repo: string,
    input: CreatePullRequestInput,
  ): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(`/repos/${seg(owner)}/${seg(repo)}/pulls`, {
      method: 'POST',
      body: { ...input },
    });
  }

  /** Create a release. */
  async createRelease(owner: string, repo: string, input: CreateReleaseInput): Promise<GitHubRelease> {
    return this.request<GitHubRelease>(`/repos/${seg(owner)}/${seg(repo)}/releases`, {
      method: 'POST',
      body: { ...input },
    });
  }

  /**
   * Trigger a `repository_dispatch` event (custom webhook events for Actions).
   * Returns nothing on success (GitHub answers 204 No Content).
   */
  async repositoryDispatch(
    owner: string,
    repo: string,
    eventType: string,
    clientPayload?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = { event_type: eventType };
    if (clientPayload !== undefined) body['client_payload'] = clientPayload;
    await this.request<void>(`/repos/${seg(owner)}/${seg(repo)}/dispatches`, {
      method: 'POST',
      body,
    });
  }

  /**
   * Trigger a `workflow_dispatch` for a workflow (by file name or numeric id).
   * Returns nothing on success (204 No Content).
   */
  async dispatchWorkflow(
    owner: string,
    repo: string,
    workflowId: string | number,
    ref: string,
    inputs?: Record<string, unknown>,
  ): Promise<void> {
    const body: Record<string, unknown> = { ref };
    if (inputs !== undefined) body['inputs'] = inputs;
    await this.request<void>(
      `/repos/${seg(owner)}/${seg(repo)}/actions/workflows/${seg(String(workflowId))}/dispatches`,
      { method: 'POST', body },
    );
  }
}
