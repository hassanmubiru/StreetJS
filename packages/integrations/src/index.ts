/**
 * @streetjs/integrations — the shared foundation for StreetJS vendor connectors.
 *
 * Provides the reusable pieces every third-party integration (Slack, GitHub,
 * GitLab, Jira, Linear, Notion, Teams, …) needs, so each connector package is a
 * thin, typed veneer rather than a re-implementation of HTTP/auth/webhook logic:
 *
 * - **`HttpConnector`** — an injectable-`fetch` base client with token auth,
 *   query building, JSON (de)serialization, normalized errors, and idempotent
 *   retry/backoff.
 * - **Webhook verification** — `verifyHmacSignature` / `hmacHex` /
 *   `timingSafeCompare` for validating inbound webhook signatures.
 * - **Typed errors** and a `ConnectorInfo` descriptor for registries.
 *
 * ```ts
 * import { HttpConnector } from '@streetjs/integrations';
 * class MyApi extends HttpConnector {
 *   listThings() { return this.request<Thing[]>('/things'); }
 * }
 * new MyApi({ baseUrl: 'https://api.vendor.com', auth: { type: 'bearer', token } });
 * ```
 */

export { HttpConnector } from './connector.js';
export { IntegrationError, IntegrationRequestError, WebhookVerificationError } from './errors.js';
export { hmacHex, timingSafeCompare, verifyHmacSignature } from './webhook.js';

export type {
  FetchLike,
  HttpResponseLike,
  AuthStrategy,
  ConnectorOptions,
  RequestOptions,
  ConnectorInfo,
} from './types.js';
