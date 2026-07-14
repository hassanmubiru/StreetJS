/**
 * The default fetch-based webhook transport.
 *
 * Depends on `types` only (uses global `fetch`).
 */

import type { DeliveryRequest, DeliveryResponse, WebhookTransport } from './types.js';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface FetchTransportOptions {
  /** Injectable fetch. Default global `fetch`. */
  readonly fetch?: FetchLike;
  /** Per-request timeout in ms. Default `10000`. */
  readonly timeoutMs?: number;
}

/** Delivers webhooks over HTTP POST using `fetch`, with a bounded timeout. */
export class FetchWebhookTransport implements WebhookTransport {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: FetchTransportOptions = {}) {
    const injected = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!injected) {
      throw new Error('No fetch implementation available; pass options.fetch');
    }
    this.fetchImpl = injected;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async send(request: DeliveryRequest): Promise<DeliveryResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    try {
      const response = await this.fetchImpl(request.url, {
        method: 'POST',
        headers: request.headers,
        body: request.body,
        signal: controller.signal,
      });
      return { status: response.status };
    } finally {
      clearTimeout(timer);
    }
  }
}
