// src/client.ts
// Typed Discord REST API client built on the shared HttpConnector.

import { HttpConnector, IntegrationError, type ConnectorOptions } from '@streetjs/integrations';

/** A Discord message (subset of fields the connector surfaces). */
export interface DiscordMessage {
  id: string;
  channel_id: string;
  content: string;
  [key: string]: unknown;
}

/** A Discord channel (subset). */
export interface DiscordChannel {
  id: string;
  type: number;
  name?: string;
  [key: string]: unknown;
}

export interface CreateMessageInput {
  content?: string;
  /** Rich embeds (opaque; passed through). */
  embeds?: unknown[];
  /** Read the message aloud. */
  tts?: boolean;
  /** Allowed-mentions object (opaque; passed through). */
  allowed_mentions?: unknown;
  /** Message components (buttons/selects; opaque). */
  components?: unknown[];
}

export interface DiscordClientOptions {
  /** Bot token (sent as `Authorization: Bot <token>`). */
  token: string;
  /** Override the API base (default https://discord.com/api/v10). */
  baseUrl?: string;
  /** Injectable fetch + retry knobs (forwarded to HttpConnector). */
  fetch?: ConnectorOptions['fetch'];
  retries?: number;
  sleep?: ConnectorOptions['sleep'];
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

/**
 * A typed Discord REST API client. Authenticates with the bot-token scheme
 * (`Authorization: Bot <token>`) and exposes typed methods over the shared
 * {@link HttpConnector}. Non-2xx responses throw `IntegrationRequestError`
 * carrying the Discord status and (truncated) error body.
 */
export class DiscordClient extends HttpConnector {
  constructor(options: DiscordClientOptions) {
    if (!options?.token) throw new IntegrationError('DiscordClient: token is required');
    const opts: ConnectorOptions = {
      baseUrl: options.baseUrl ?? 'https://discord.com/api/v10',
      auth: { type: 'header', name: 'Authorization', value: `Bot ${options.token}` },
      defaultHeaders: { 'content-type': 'application/json' },
    };
    if (options.fetch) opts.fetch = options.fetch;
    if (options.retries !== undefined) opts.retries = options.retries;
    if (options.sleep) opts.sleep = options.sleep;
    super(opts);
  }

  /** Fetch a channel's metadata. */
  async getChannel(channelId: string): Promise<DiscordChannel> {
    return this.request<DiscordChannel>(`/channels/${seg(channelId)}`);
  }

  /** Post a message to a channel. */
  async createMessage(channelId: string, input: CreateMessageInput): Promise<DiscordMessage> {
    return this.request<DiscordMessage>(`/channels/${seg(channelId)}/messages`, {
      method: 'POST',
      body: { ...input },
    });
  }

  /** Edit a message the bot previously sent. */
  async editMessage(
    channelId: string,
    messageId: string,
    input: CreateMessageInput,
  ): Promise<DiscordMessage> {
    return this.request<DiscordMessage>(
      `/channels/${seg(channelId)}/messages/${seg(messageId)}`,
      { method: 'PATCH', body: { ...input } },
    );
  }

  /** Delete a message. Returns nothing (Discord answers 204 No Content). */
  async deleteMessage(channelId: string, messageId: string): Promise<void> {
    await this.request<void>(`/channels/${seg(channelId)}/messages/${seg(messageId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Add a reaction to a message. `emoji` is the unicode emoji or a custom
   * `name:id`. Returns nothing (204 No Content).
   */
  async createReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
    await this.request<void>(
      `/channels/${seg(channelId)}/messages/${seg(messageId)}/reactions/${seg(emoji)}/@me`,
      { method: 'PUT' },
    );
  }

  /**
   * Execute an incoming webhook (post as the webhook, not the bot). Provide the
   * webhook id and its token.
   */
  async executeWebhook(
    webhookId: string,
    webhookToken: string,
    input: CreateMessageInput,
  ): Promise<void> {
    await this.request<void>(`/webhooks/${seg(webhookId)}/${seg(webhookToken)}`, {
      method: 'POST',
      body: { ...input },
    });
  }
}
