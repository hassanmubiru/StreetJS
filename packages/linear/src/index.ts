/**
 * @streetjs/linear — the StreetJS Linear connector.
 *
 * A typed Linear GraphQL API client built on `@streetjs/integrations` (viewer,
 * issues, comments, and a generic `query` escape hatch), unwrapping GraphQL
 * `errors` into thrown errors, plus `verifyLinearWebhook` for validating the
 * inbound `Linear-Signature` HMAC-SHA256 header.
 *
 * ```ts
 * import { LinearClient, verifyLinearWebhook } from '@streetjs/linear';
 *
 * const linear = new LinearClient({ apiKey: process.env.LINEAR_API_KEY! });
 * const issue = await linear.createIssue({ teamId, title: 'Deploy failed' });
 * ```
 */

export { LinearClient } from './client.js';
export type {
  LinearClientOptions,
  LinearAuthType,
  LinearViewer,
  LinearIssue,
  CreateIssueInput,
  GraphQLResponse,
  GraphQLError,
} from './client.js';

export { verifyLinearWebhook } from './webhook.js';
export type { LinearVerifyInput } from './webhook.js';
