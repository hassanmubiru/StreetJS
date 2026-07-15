/**
 * @streetjs/webhook-dispatcher — the StreetJS outbound webhook dispatcher.
 *
 * An SSRF-hardened, HTTPS-only delivery queue with HMAC-SHA256 signatures,
 * bounded queue + concurrency, exponential-backoff retries, DNS-rebinding
 * protection, and private-CA TLS. Zero runtime dependencies. Public API only.
 *
 * > Distinct from `@streetjs/webhooks` (a generic sign/verify/deliver library):
 * > this is the framework's hardened *sender*, and it also backs the
 * > `streetjs/webhook` subpath, so there is a single implementation.
 *
 * ```ts
 * import { WebhookDispatcher } from '@streetjs/webhook-dispatcher';
 *
 * const dispatcher = new WebhookDispatcher();
 * dispatcher.enqueue({ url: 'https://consumer.example/hooks', secret }, 'user.created', { id: 7 });
 * // ... on shutdown:
 * dispatcher.stop();
 * ```
 */

export {
  WebhookDispatcher,
  buildRequestOptions,
  type WebhookPayload,
  type WebhookTarget,
  type WebhookJob,
} from './dispatcher.js';

/**
 * Dependency-injection token for a {@link WebhookDispatcher}. This package
 * depends on no container, so the token is a plain unique symbol.
 */
export const WEBHOOK_DISPATCHER: unique symbol = Symbol.for('@streetjs/webhook-dispatcher:Dispatcher');
