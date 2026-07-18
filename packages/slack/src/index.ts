/**
 * @streetjs/slack — the StreetJS Slack connector.
 *
 * A typed Slack Web API client built on `@streetjs/integrations` (post/update/
 * delete messages, reactions, conversations), unwrapping Slack's `{ ok, error }`
 * envelope into thrown errors, plus `verifySlackRequest` for validating inbound
 * event/interaction signatures (the `v0:{ts}:{body}` scheme with a replay guard).
 *
 * ```ts
 * import { SlackClient, verifySlackRequest } from '@streetjs/slack';
 *
 * const slack = new SlackClient({ token: process.env.SLACK_BOT_TOKEN! });
 * await slack.postMessage({ channel: '#general', text: 'Deploy complete :rocket:' });
 * ```
 */

export { SlackClient } from './client.js';
export type { SlackClientOptions, PostMessageInput, SlackApiResponse } from './client.js';

export { verifySlackRequest } from './webhook.js';
export type { SlackVerifyInput } from './webhook.js';
