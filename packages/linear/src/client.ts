// src/client.ts
// Typed Linear GraphQL API client built on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions } from '@streetjs/integrations';

/** A GraphQL error entry as returned by Linear. */
export interface GraphQLError {
  message: string;
  [key: string]: unknown;
}

/** The raw GraphQL envelope Linear returns (even on HTTP 200). */
export interface GraphQLResponse<T> {
  data?: T;
  errors?: GraphQLError[];
}

export interface LinearViewer {
  id: string;
  name: string;
  email: string;
  [key: string]: unknown;
}

export interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  [key: string]: unknown;
}

export interface CreateIssueInput {
  teamId: string;
  title: string;
  description?: string;
  priority?: number;
  assigneeId?: string;
  labelIds?: string[];
  stateId?: string;
}

/** Personal API keys authenticate with the raw key; OAuth uses a bearer token. */
export type LinearAuthType = 'api-key' | 'bearer';

export interface LinearClientOptions {
  /** Linear API key (personal) or OAuth access token. */
  apiKey: string;
  /** Auth scheme. Default `api-key` (raw key in `Authorization`). */
  authType?: LinearAuthType;
  /** Override the API base host (default https://api.linear.app). */
  baseUrl?: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

/**
 * A typed Linear GraphQL client. All operations POST `{ query, variables }` to
 * the single `/graphql` endpoint; a GraphQL `errors` array (returned even on
 * HTTP 200) is unwrapped into a thrown {@link IntegrationError}. Personal API
 * keys are sent as the raw `Authorization` value; OAuth tokens use `Bearer`.
 */
export class LinearClient extends HttpConnector {
  constructor(options: LinearClientOptions) {
    if (!options?.apiKey) throw new IntegrationError('LinearClient: apiKey is required');
    const authType = options.authType ?? 'api-key';
    const opts: ConnectorOptions = {
      baseUrl: options.baseUrl ?? 'https://api.linear.app',
      auth:
        authType === 'bearer'
          ? { type: 'bearer', token: options.apiKey }
          : { type: 'header', name: 'Authorization', value: options.apiKey },
      defaultHeaders: { 'content-type': 'application/json' },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Execute an arbitrary GraphQL query/mutation, returning `data` (throws on `errors`). */
  async query<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const res = await this.request<GraphQLResponse<T>>('/graphql', {
      method: 'POST',
      body: { query, variables },
    });
    if (res.errors && res.errors.length > 0) {
      throw new IntegrationError(`Linear GraphQL error: ${res.errors.map((e) => e.message).join('; ')}`);
    }
    if (res.data === undefined) {
      throw new IntegrationError('Linear GraphQL response had no data');
    }
    return res.data;
  }

  /** The authenticated user. */
  async viewer(): Promise<LinearViewer> {
    const data = await this.query<{ viewer: LinearViewer }>(
      'query { viewer { id name email } }',
    );
    return data.viewer;
  }

  /** Fetch an issue by id. */
  async getIssue(id: string): Promise<LinearIssue> {
    const data = await this.query<{ issue: LinearIssue }>(
      'query Issue($id: String!) { issue(id: $id) { id identifier title url } }',
      { id },
    );
    return data.issue;
  }

  /** Create an issue. Returns the created issue. */
  async createIssue(input: CreateIssueInput): Promise<LinearIssue> {
    const mutation = `
      mutation IssueCreate($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title url }
        }
      }`;
    const data = await this.query<{ issueCreate: { success: boolean; issue: LinearIssue } }>(
      mutation,
      { input },
    );
    if (!data.issueCreate.success) {
      throw new IntegrationError('Linear issueCreate returned success=false');
    }
    return data.issueCreate.issue;
  }

  /** Add a comment to an issue. Returns the comment id. */
  async createComment(issueId: string, body: string): Promise<{ id: string }> {
    const mutation = `
      mutation CommentCreate($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }`;
    const data = await this.query<{ commentCreate: { success: boolean; comment: { id: string } } }>(
      mutation,
      { input: { issueId, body } },
    );
    if (!data.commentCreate.success) {
      throw new IntegrationError('Linear commentCreate returned success=false');
    }
    return data.commentCreate.comment;
  }
}
