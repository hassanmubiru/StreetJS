/**
 * @streetjs/teams — the StreetJS Microsoft Teams connector.
 *
 * Three real Teams integration paths, all built on `@streetjs/integrations`:
 * - `TeamsClient` — a typed Microsoft Graph client for posting channel and chat
 *   messages with a bearer access token.
 * - `sendIncomingWebhook` — post a MessageCard / Adaptive Card to a Teams
 *   Incoming Webhook URL (authenticated by the secret URL itself).
 * - `verifyTeamsOutgoingWebhook` — validate the `Authorization: HMAC <base64>`
 *   signature Teams sends to your outgoing-webhook endpoint.
 *
 * ```ts
 * import { TeamsClient, sendIncomingWebhook } from '@streetjs/teams';
 *
 * const teams = new TeamsClient({ accessToken: token });
 * await teams.sendChannelMessage(teamId, channelId, 'Deploy complete');
 * ```
 */

export { TeamsClient, sendIncomingWebhook } from './client.js';
export type {
  TeamsClientOptions,
  GraphObject,
  GraphList,
  MessageContentType,
  IncomingWebhookOptions,
} from './client.js';

export { verifyTeamsOutgoingWebhook, computeTeamsSignature } from './webhook.js';
export type { TeamsVerifyInput } from './webhook.js';
