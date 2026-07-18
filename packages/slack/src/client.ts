// src/client.ts
// Typed Slack Web API client built on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions } from '@streetjs/integrations';

/** Slack Web API always returns `{ ok, error?, ... }` even on HTTP 200. */
export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface PostMessageInput {
  channel: string;
  text?: string;
  /** Block Kit blocks (opaque; passed through). */
  blocks?: unknown[];
  /** Reply in a thread. */
  thread_ts?: string;
  /** Post as ephemeral to this user (uses chat.postEphemeral). */
  ephemeralTo?: string;
}

export interface SlackClientOptions {
  /** Bot/user OAuth token (xoxb-… / xoxp-…). */
  token: string;
  /** Override the API base (default https://slack.com/api). */
  baseUrl?: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

/**
 * A typed Slack Web API client. Every call posts JSON with the bot token and
 * unwraps Slack's `{ ok, error }` envelope — a `{ ok: false }` body throws an
 * {@link IntegrationError} carrying the Slack error code, even though the HTTP
 * status was 200.
 */
export class SlackClient extends HttpConnector {
  constructor(options: SlackClientOptions) {
    if (!options?.token) throw new IntegrationError('SlackClient: token is required');
    const opts: ConnectorOptions = {
      baseUrl: options.baseUrl ?? 'https://slack.com/api',
      auth: { type: 'bearer', token: options.token },
      defaultHeaders: { 'content-type': 'application/json; charset=utf-8' },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Call a Web API `method`, throwing on the Slack `{ ok: false }` envelope. */
  async call<T extends SlackApiResponse = SlackApiResponse>(
    method: string,
    body: Record<string, unknown> = {},
  ): Promise<T> {
    const res = await this.request<T>(`/${method}`, { method: 'POST', body });
    if (!res || res.ok !== true) {
      throw new IntegrationError(`Slack ${method} failed: ${res?.error ?? 'unknown_error'}`);
    }
    return res;
  }

  /** Post a message (or ephemeral message) to a channel. */
  async postMessage(input: PostMessageInput): Promise<SlackApiResponse> {
    const body: Record<string, unknown> = { channel: input.channel };
    if (input.text !== undefined) body['text'] = input.text;
    if (input.blocks !== undefined) body['blocks'] = input.blocks;
    if (input.thread_ts !== undefined) body['thread_ts'] = input.thread_ts;
    if (input.ephemeralTo !== undefined) {
      body['user'] = input.ephemeralTo;
      return this.call('chat.postEphemeral', body);
    }
    return this.call('chat.postMessage', body);
  }

  /** Edit a previously-posted message. */
  async updateMessage(channel: string, ts: string, text: string): Promise<SlackApiResponse> {
    return this.call('chat.update', { channel, ts, text });
  }

  /** Delete a message. */
  async deleteMessage(channel: string, ts: string): Promise<SlackApiResponse> {
    return this.call('chat.delete', { channel, ts });
  }

  /** Add an emoji reaction to a message. */
  async addReaction(channel: string, ts: string, name: string): Promise<SlackApiResponse> {
    return this.call('reactions.add', { channel, timestamp: ts, name });
  }

  /** List conversations (channels) the token can see. */
  async listConversations(params: { types?: string; limit?: number; cursor?: string } = {}): Promise<SlackApiResponse> {
    return this.call('conversations.list', { ...params });
  }
}
