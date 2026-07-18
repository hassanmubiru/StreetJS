// src/client.ts
// Typed GitLab REST API v4 client built on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions } from '@streetjs/integrations';

/** A GitLab project (subset of fields the connector surfaces). */
export interface GitLabProject {
  id: number;
  name: string;
  path_with_namespace: string;
  default_branch: string;
  web_url: string;
  [key: string]: unknown;
}

/** A GitLab issue (subset). */
export interface GitLabIssue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  state: string;
  web_url: string;
  [key: string]: unknown;
}

/** A GitLab issue/MR note (subset). */
export interface GitLabNote {
  id: number;
  body: string;
  [key: string]: unknown;
}

/** A GitLab merge request (subset). */
export interface GitLabMergeRequest {
  id: number;
  iid: number;
  title: string;
  state: string;
  source_branch: string;
  target_branch: string;
  web_url: string;
  [key: string]: unknown;
}

/** A GitLab pipeline (subset). */
export interface GitLabPipeline {
  id: number;
  status: string;
  ref: string;
  web_url: string;
  [key: string]: unknown;
}

export interface CreateIssueInput {
  title: string;
  description?: string;
  labels?: string;
  assignee_ids?: number[];
  milestone_id?: number;
}

export interface CreateMergeRequestInput {
  source_branch: string;
  target_branch: string;
  title: string;
  description?: string;
  remove_source_branch?: boolean;
  draft?: boolean;
}

export interface ListIssuesParams {
  state?: 'opened' | 'closed';
  labels?: string;
  per_page?: number;
  page?: number;
}

/** How to authenticate: a personal/project access token or an OAuth bearer. */
export type GitLabAuthType = 'private-token' | 'bearer';

export interface GitLabClientOptions {
  /** Access token (personal, project, or OAuth). */
  token: string;
  /** Auth scheme. Default `private-token` (the `PRIVATE-TOKEN` header). */
  authType?: GitLabAuthType;
  /** Override the API base (default https://gitlab.com/api/v4; use your host). */
  baseUrl?: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

/** Project id or URL-encoded `group/project` path → a safe path segment. */
function projectSeg(idOrPath: string | number): string {
  return encodeURIComponent(String(idOrPath));
}

/**
 * A typed GitLab REST API v4 client. Defaults to the `PRIVATE-TOKEN` header
 * auth scheme (personal/project access tokens) and exposes typed methods over
 * the shared {@link HttpConnector}. Projects may be addressed by numeric id or
 * by their `group/project` path (URL-encoded automatically).
 */
export class GitLabClient extends HttpConnector {
  constructor(options: GitLabClientOptions) {
    if (!options?.token) throw new IntegrationError('GitLabClient: token is required');
    const authType = options.authType ?? 'private-token';
    const opts: ConnectorOptions = {
      baseUrl: options.baseUrl ?? 'https://gitlab.com/api/v4',
      auth:
        authType === 'bearer'
          ? { type: 'bearer', token: options.token }
          : { type: 'header', name: 'PRIVATE-TOKEN', value: options.token },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Fetch a project's metadata. */
  async getProject(projectId: string | number): Promise<GitLabProject> {
    return this.request<GitLabProject>(`/projects/${projectSeg(projectId)}`);
  }

  /** List issues in a project. */
  async listIssues(projectId: string | number, params: ListIssuesParams = {}): Promise<GitLabIssue[]> {
    return this.request<GitLabIssue[]>(`/projects/${projectSeg(projectId)}/issues`, {
      query: { ...params },
    });
  }

  /** Open a new issue. */
  async createIssue(projectId: string | number, input: CreateIssueInput): Promise<GitLabIssue> {
    return this.request<GitLabIssue>(`/projects/${projectSeg(projectId)}/issues`, {
      method: 'POST',
      body: { ...input },
    });
  }

  /** Add a note (comment) to an issue by its project-scoped iid. */
  async createIssueNote(
    projectId: string | number,
    issueIid: number,
    body: string,
  ): Promise<GitLabNote> {
    return this.request<GitLabNote>(
      `/projects/${projectSeg(projectId)}/issues/${issueIid}/notes`,
      { method: 'POST', body: { body } },
    );
  }

  /** Open a merge request. */
  async createMergeRequest(
    projectId: string | number,
    input: CreateMergeRequestInput,
  ): Promise<GitLabMergeRequest> {
    return this.request<GitLabMergeRequest>(`/projects/${projectSeg(projectId)}/merge_requests`, {
      method: 'POST',
      body: { ...input },
    });
  }

  /** Trigger a new pipeline on a ref, optionally passing CI/CD variables. */
  async triggerPipeline(
    projectId: string | number,
    ref: string,
    variables?: Array<{ key: string; value: string }>,
  ): Promise<GitLabPipeline> {
    const body: Record<string, unknown> = { ref };
    if (variables !== undefined) body['variables'] = variables;
    return this.request<GitLabPipeline>(`/projects/${projectSeg(projectId)}/pipeline`, {
      method: 'POST',
      body,
    });
  }
}
