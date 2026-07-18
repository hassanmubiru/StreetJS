// src/client.ts
// Typed Notion API client built on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions } from '@streetjs/integrations';

/** A Notion object (page/database/block); loosely typed to the fields we surface. */
export interface NotionObject {
  object: string;
  id: string;
  [key: string]: unknown;
}

/** A paginated list response from Notion. */
export interface NotionList<T = NotionObject> {
  object: 'list';
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
  [key: string]: unknown;
}

export interface CreatePageInput {
  /** Parent, e.g. `{ database_id }` or `{ page_id }`. */
  parent: Record<string, unknown>;
  /** Page properties keyed by name (Notion property-value objects). */
  properties: Record<string, unknown>;
  /** Optional child blocks. */
  children?: unknown[];
  /** Optional icon / cover. */
  icon?: unknown;
  cover?: unknown;
}

export interface QueryDatabaseInput {
  filter?: unknown;
  sorts?: unknown[];
  start_cursor?: string;
  page_size?: number;
}

export interface SearchInput {
  query?: string;
  filter?: { value: 'page' | 'database'; property: 'object' };
  start_cursor?: string;
  page_size?: number;
}

export interface NotionClientOptions {
  /** Internal integration token (`secret_…`) or OAuth access token. */
  token: string;
  /** `Notion-Version` header. Default `2022-06-28`. */
  notionVersion?: string;
  /** Override the API base (default https://api.notion.com/v1). */
  baseUrl?: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

/**
 * A typed Notion API client. Uses bearer-token auth, sends the required
 * `Notion-Version` header, and exposes typed methods over the shared
 * {@link HttpConnector}. Non-2xx responses throw `IntegrationRequestError`
 * with the status and the (truncated) Notion error body.
 */
export class NotionClient extends HttpConnector {
  constructor(options: NotionClientOptions) {
    if (!options?.token) throw new IntegrationError('NotionClient: token is required');
    const opts: ConnectorOptions = {
      baseUrl: options.baseUrl ?? 'https://api.notion.com/v1',
      auth: { type: 'bearer', token: options.token },
      defaultHeaders: {
        'content-type': 'application/json',
        'notion-version': options.notionVersion ?? '2022-06-28',
      },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Retrieve a page by id. */
  async retrievePage(pageId: string): Promise<NotionObject> {
    return this.request<NotionObject>(`/pages/${encodeURIComponent(pageId)}`);
  }

  /** Create a page (in a database or under a parent page). */
  async createPage(input: CreatePageInput): Promise<NotionObject> {
    return this.request<NotionObject>('/pages', { method: 'POST', body: { ...input } });
  }

  /** Update a page's properties (and optionally icon/cover/archived). */
  async updatePage(pageId: string, patch: Record<string, unknown>): Promise<NotionObject> {
    return this.request<NotionObject>(`/pages/${encodeURIComponent(pageId)}`, {
      method: 'PATCH',
      body: { ...patch },
    });
  }

  /** Retrieve a database by id. */
  async retrieveDatabase(databaseId: string): Promise<NotionObject> {
    return this.request<NotionObject>(`/databases/${encodeURIComponent(databaseId)}`);
  }

  /** Query a database with optional filter/sorts/pagination. */
  async queryDatabase(databaseId: string, input: QueryDatabaseInput = {}): Promise<NotionList> {
    return this.request<NotionList>(`/databases/${encodeURIComponent(databaseId)}/query`, {
      method: 'POST',
      body: { ...input },
    });
  }

  /** Append child blocks to a page or block. */
  async appendBlockChildren(blockId: string, children: unknown[]): Promise<NotionObject> {
    return this.request<NotionObject>(`/blocks/${encodeURIComponent(blockId)}/children`, {
      method: 'PATCH',
      body: { children },
    });
  }

  /** Search across pages and databases the integration can access. */
  async search(input: SearchInput = {}): Promise<NotionList> {
    return this.request<NotionList>('/search', { method: 'POST', body: { ...input } });
  }
}
