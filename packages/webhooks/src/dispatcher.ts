/**
 * Webhook dispatch: build a canonical payload, sign it, and deliver with retries.
 *
 * Depends on `types`, `signature`, and `transport`.
 */

import { randomUUID } from 'node:crypto';
import type {
  Clock,
  DispatchResult,
  SleepFn,
  WebhookEndpoint,
  WebhookEvent,
  WebhookTransport,
} from './types.js';
import { signPayload } from './signature.js';
import { FetchWebhookTransport } from './transport.js';

/** Header names used on delivery requests. */
export const HEADER_SIGNATURE = 'webhook-signature';
export const HEADER_ID = 'webhook-id';
export const HEADER_EVENT = 'webhook-event';
export const HEADER_TIMESTAMP = 'webhook-timestamp';

export interface DispatcherOptions {
  /** Delivery transport. Default a fetch-based transport. */
  readonly transport?: WebhookTransport;
  /** Additional delivery attempts after the first. Default `3`. */
  readonly retries?: number;
  /** Base backoff in ms (doubled per attempt). Default `200`. */
  readonly baseDelayMs?: number;
  /** Maximum backoff in ms. Default `5000`. */
  readonly maxDelayMs?: number;
  /** Injectable delay. Default a real unref'd timer. */
  readonly sleep?: SleepFn;
  /** Injectable clock (epoch ms). Default `Date.now`. */
  readonly clock?: Clock;
}

const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Serialize an event into the canonical JSON envelope that gets signed. */
export function buildEnvelope(event: WebhookEvent, id: string, created: number): string {
  return JSON.stringify({ id, type: event.type, created, data: event.data });
}

export class WebhookDispatcher {
  private readonly transport: WebhookTransport;
  private readonly retries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: SleepFn;
  private readonly clock: Clock;

  constructor(options: DispatcherOptions = {}) {
    this.transport = options.transport ?? new FetchWebhookTransport();
    this.retries = options.retries ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 200;
    this.maxDelayMs = options.maxDelayMs ?? 5000;
    this.sleep = options.sleep ?? realSleep;
    this.clock = options.clock ?? Date.now;
  }

  /** Sign and deliver an event to an endpoint, retrying transient failures. */
  async dispatch(endpoint: WebhookEndpoint, event: WebhookEvent): Promise<DispatchResult> {
    const id = event.id ?? randomUUID();
    const created = event.created ?? Math.floor(this.clock() / 1000);
    const body = buildEnvelope(event, id, created);
    const { header } = signPayload(body, endpoint.secret, { timestamp: created });

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [HEADER_SIGNATURE]: header,
      [HEADER_ID]: id,
      [HEADER_EVENT]: event.type,
      [HEADER_TIMESTAMP]: String(created),
      ...(endpoint.headers ?? {}),
    };

    let attempt = 0;
    for (;;) {
      try {
        const response = await this.transport.send({ url: endpoint.url, headers, body });
        if (response.status >= 200 && response.status < 300) {
          return { delivered: true, id, attempts: attempt + 1, status: response.status };
        }
        if (attempt < this.retries) {
          await this.sleep(this.backoff(attempt));
          attempt++;
          continue;
        }
        return { delivered: false, id, attempts: attempt + 1, status: response.status };
      } catch (error) {
        if (attempt < this.retries) {
          await this.sleep(this.backoff(attempt));
          attempt++;
          continue;
        }
        return {
          delivered: false,
          id,
          attempts: attempt + 1,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  private backoff(attempt: number): number {
    return Math.min(this.baseDelayMs * 2 ** attempt, this.maxDelayMs);
  }
}
