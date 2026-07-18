/**
 * @streetjs/discord — the StreetJS Discord connector.
 *
 * A typed Discord REST API client built on `@streetjs/integrations` (channel
 * messages, edits, deletes, reactions, and incoming-webhook execution), plus
 * `verifyDiscordInteraction` for validating inbound interaction requests via
 * their Ed25519 signature (`X-Signature-Ed25519` / `X-Signature-Timestamp`).
 *
 * ```ts
 * import { DiscordClient, verifyDiscordInteraction } from '@streetjs/discord';
 *
 * const discord = new DiscordClient({ token: process.env.DISCORD_BOT_TOKEN! });
 * await discord.createMessage('123456789', { content: 'Deploy complete :rocket:' });
 * ```
 */

export { DiscordClient } from './client.js';
export type {
  DiscordClientOptions,
  DiscordMessage,
  DiscordChannel,
  CreateMessageInput,
} from './client.js';

export { verifyDiscordInteraction, ed25519PublicKeyFromHex } from './interactions.js';
export type { DiscordVerifyInput } from './interactions.js';
