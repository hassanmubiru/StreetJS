/**
 * @streetjs/webhooks — the StreetJS webhooks foundation.
 *
 * Generic outbound webhook signing and delivery (HMAC-SHA256, timestamped
 * signatures, retries) plus constant-time incoming verification with replay
 * protection. Zero runtime dependencies. Public API only.
 *
 * ```ts
 * import { WebhookDispatcher, verifySignature } from '@streetjs/webhooks';
 *
 * // Sender:
 * const dispatcher = new WebhookDispatcher();
 * await dispatcher.dispatch(
 *   { url: 'https://consumer.example/hooks', secret: whsec },
 *   { type: 'user.created', data: { id: 7 } },
 * );
 *
 * // Receiver:
 * const result = verifySignature(rawBody, req.headers['webhook-signature'], whsec);
 * if (!result.valid) return res.status(400).end(result.reason);
 * ```
 */

export {
  signPayload,
  verifySignature,
  parseSignatureHeader,
} from './signature.js';

export {
  WebhookDispatcher,
  buildEnvelope,
  HEADER_SIGNATURE,
  HEADER_ID,
  HEADER_EVENT,
  HEADER_TIMESTAMP,
  type DispatcherOptions,
} from './dispatcher.js';

export { FetchWebhookTransport, type FetchTransportOptions } from './transport.js';

export type {
  SignOptions,
  SignatureResult,
  VerifyOptions,
  VerifyResult,
  WebhookEndpoint,
  WebhookEvent,
  DeliveryRequest,
  DeliveryResponse,
  WebhookTransport,
  DispatchResult,
  SleepFn,
  Clock,
} from './types.js';

/**
 * Dependency-injection token for a {@link WebhookDispatcher}. `@streetjs/webhooks`
 * depends on no container, so the token is a plain unique symbol.
 */
export const WEBHOOK_DISPATCHER: unique symbol = Symbol.for('@streetjs/webhooks:Dispatcher');
