// src/client.ts
// Typed Microsoft Graph client for Teams messaging, on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions, type FetchLike } from '@streetjs/integrations';

/** A Graph object (subset of fields the connector surfaces). */
export interface GraphObject {
  id: string;
  [key: string]: unknown;
}

/** A Graph collection response. */
export interface GraphList<T = GraphObject> {
  value: T[];
  [key: string]: unknown;
}

/** Message content type accepted by Graph chat/channel messages. */
export type MessageContentType = 'text' | 'html';

export interface TeamsClientOptions {
  /** A Microsoft Graph OAuth access token (bearer). */
  accessToken: string;
  /** Override the Graph base (default https://graph.microsoft.com/v1.0). */
  baseUrl?: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

function messageBody(content: string, contentType: MessageContentType): Record<string, unknown> {
  return { body: { contentType, content } };
}

/**
 * A typed Microsoft Graph client for Teams messaging. Authenticates with a
 * bearer access token and posts channel/chat messages via the shared
 * {@link HttpConnector}. Non-2xx responses throw `IntegrationRequestError`.
 */
export class TeamsClient extends HttpConnector {
  constructor(options: TeamsClientOptions) {
    if (!options?.accessToken) throw new IntegrationError('TeamsClient: accessToken is required');
    const opts: ConnectorOptions = {
      baseUrl: options.baseUrl ?? 'https://graph.microsoft.com/v1.0',
      auth: { type: 'bearer', token: options.accessToken },
      defaultHeaders: { 'content-type': 'application/json' },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Fetch a team's metadata. */
  async getTeam(teamId: string): Promise<GraphObject> {
    return this.request<GraphObject>(`/teams/${seg(teamId)}`);
  }

  /** List a team's channels. */
  async listChannels(teamId: string): Promise<GraphObject[]> {
    const res = await this.request<GraphList>(`/teams/${seg(teamId)}/channels`);
    return res.value ?? [];
  }

  /** Post a message to a channel. */
  async sendChannelMessage(
    teamId: string,
    channelId: string,
    content: string,
    contentType: MessageContentType = 'html',
  ): Promise<GraphObject> {
    return this.request<GraphObject>(
      `/teams/${seg(teamId)}/channels/${seg(channelId)}/messages`,
      { method: 'POST', body: messageBody(content, contentType) },
    );
  }

  /** Post a message to a 1:1 or group chat. */
  async sendChatMessage(
    chatId: string,
    content: string,
    contentType: MessageContentType = 'html',
  ): Promise<GraphObject> {
    return this.request<GraphObject>(`/chats/${seg(chatId)}/messages`, {
      method: 'POST',
      body: messageBody(content, contentType),
    });
  }
}

export interface IncomingWebhookOptions {
  /** Injectable fetch (defaults to the global `fetch`). */
  fetch?: FetchLike;
}

/**
 * Post a card (MessageCard or Adaptive Card) to a Teams **Incoming Webhook**
 * URL. Incoming webhooks are authenticated by the secret URL itself, so no
 * token is needed. Throws on a non-2xx response.
 */
export async function sendIncomingWebhook(
  webhookUrl: string,
  card: Record<string, unknown>,
  options: IncomingWebhookOptions = {},
): Promise<void> {
  if (!webhookUrl) throw new IntegrationError('sendIncomingWebhook: webhookUrl is required');
  const fetchImpl = options.fetch ?? (globalThis as { fetch?: unknown }).fetch;
  if (typeof fetchImpl !== 'function') {
    throw new IntegrationError('No fetch available; pass options.fetch');
  }
  const res = await (fetchImpl as FetchLike)(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(card),
  });
  if (!res.ok) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      text = '';
    }
    throw new IntegrationError(`Teams incoming webhook failed: ${res.status} ${text.slice(0, 500)}`);
  }
}
