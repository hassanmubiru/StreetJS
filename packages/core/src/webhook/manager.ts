// src/webhook/manager.ts
// Webhook endpoint registry, event publication, signed delivery logging, and
// inbound signature verification. Builds on the existing WebhookDispatcher.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { WebhookDispatcher } from './dispatcher.js';

// ── Migration SQL ─────────────────────────────────────────────────────────────

export const WEBHOOK_ENDPOINTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_webhook_endpoints (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  url         TEXT NOT NULL,
  events      JSONB NOT NULL DEFAULT '[]',
  secret      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_webhook_endpoints_url_idx ON street_webhook_endpoints (url);
`.trim();

export const WEBHOOK_DELIVERIES_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_webhook_deliveries (
  id            BIGSERIAL PRIMARY KEY,
  endpoint_id   TEXT NOT NULL,
  event         TEXT NOT NULL,
  status        TEXT NOT NULL,
  response_code INT,
  response_body TEXT,
  attempt       INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_webhook_deliveries_endpoint_idx ON street_webhook_deliveries (endpoint_id);
`.trim();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WebhookManagerPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, string | null>[]; rowCount: number; command: string }>;
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: string[];
  secret: string;
  createdAt: string;
}

export interface WebhookDelivery {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  responseCode: number | null;
  responseBody: string | null;
  attempt: number;
  createdAt: string;
}

/** Compute the HMAC-SHA256 signature for a webhook body (matches dispatcher). */
export function signWebhookPayload(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verify an inbound webhook signature in constant time.
 * `signature` is the value of the `X-Street-Signature` header.
 */
export function verifyIncomingWebhook(secret: string, signature: string, rawBody: string): boolean {
  const expected = signWebhookPayload(rawBody, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(signature, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── WebhookManager ────────────────────────────────────────────────────────────

export interface WebhookManagerOptions {
  pool: WebhookManagerPool;
  dispatcher?: WebhookDispatcher;
}

export class WebhookManager {
  private readonly _pool: WebhookManagerPool;
  private readonly _dispatcher: WebhookDispatcher;

  constructor(opts: WebhookManagerOptions) {
    this._pool = opts.pool;
    this._dispatcher = opts.dispatcher ?? new WebhookDispatcher();
  }

  /** Register a webhook endpoint. Generates a secret if none is provided. */
  async registerEndpoint(url: string, events: string[], secret?: string): Promise<WebhookEndpoint> {
    const sec = secret ?? randomBytes(32).toString('base64url');
    const result = await this._pool.query(
      `INSERT INTO street_webhook_endpoints (url, events, secret)
       VALUES ($1, $2, $3)
       RETURNING id, url, events, secret, created_at`,
      [url, JSON.stringify(events), sec],
    );
    return rowToEndpoint(result.rows[0]!);
  }

  /** List all endpoints subscribed to a given event type. */
  async endpointsForEvent(event: string): Promise<WebhookEndpoint[]> {
    const result = await this._pool.query(
      `SELECT id, url, events, secret, created_at FROM street_webhook_endpoints`,
    );
    return result.rows
      .map(rowToEndpoint)
      .filter((e) => e.events.includes(event) || e.events.includes('*'));
  }

  /**
   * Publish an event: find matching endpoints and enqueue a signed delivery for
   * each via the underlying dispatcher. A pending delivery row is recorded.
   */
  async publish(event: string, payload: unknown): Promise<{ delivered: number }> {
    const endpoints = await this.endpointsForEvent(event);
    for (const endpoint of endpoints) {
      this._dispatcher.enqueue(
        { url: endpoint.url, secret: endpoint.secret },
        event,
        payload,
      );
      await this._recordDelivery(endpoint.id, event, 'pending', null, null, 0);
    }
    return { delivered: endpoints.length };
  }

  /** Record a delivery attempt outcome (truncates body to 1 KB). */
  async recordResult(
    endpointId: string,
    event: string,
    responseCode: number,
    responseBody: string,
    attempt: number,
  ): Promise<void> {
    const status = responseCode >= 200 && responseCode < 300 ? 'success' : 'failed';
    await this._recordDelivery(endpointId, event, status, responseCode, responseBody.slice(0, 1024), attempt);
  }

  /** Read the recent delivery log for an endpoint. */
  async deliveryLog(endpointId: string, limit = 50): Promise<WebhookDelivery[]> {
    const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 1000);
    const result = await this._pool.query(
      `SELECT id, endpoint_id, event, status, response_code, response_body, attempt, created_at
       FROM street_webhook_deliveries WHERE endpoint_id = $1
       ORDER BY created_at DESC LIMIT $2`,
      [endpointId, safeLimit],
    );
    return result.rows.map(rowToDelivery);
  }

  /** Remove an endpoint registration. */
  async revokeEndpoint(id: string): Promise<void> {
    await this._pool.query(`DELETE FROM street_webhook_endpoints WHERE id = $1`, [id]);
  }

  /**
   * Compute the exponential-backoff delay (ms) for a given attempt, capped so
   * the cumulative retry window does not exceed ~72 hours.
   * delay = min(initialDelayMs * 2^attempt, maxDelayMs).
   */
  static backoffMs(attempt: number, initialDelayMs = 1_000, maxDelayMs = 6 * 60 * 60 * 1000): number {
    return Math.min(initialDelayMs * Math.pow(2, attempt), maxDelayMs);
  }

  /** Maximum delivery window: deliveries stop being retried after 72 hours. */
  static readonly MAX_RETRY_WINDOW_MS = 72 * 60 * 60 * 1000;

  /**
   * Deliver a single attempt result. When `attempt` reaches `maxAttempts` (or
   * the cumulative backoff would exceed the 72h window) and the response is not
   * 2xx, the delivery is recorded with status `dead_letter` (at-least-once:
   * retried until exhaustion, then parked rather than dropped).
   */
  async recordAttempt(
    endpointId: string,
    event: string,
    responseCode: number,
    responseBody: string,
    attempt: number,
    maxAttempts = 20,
  ): Promise<{ status: string; nextDelayMs: number | null }> {
    const ok = responseCode >= 200 && responseCode < 300;
    if (ok) {
      await this._recordDelivery(endpointId, event, 'success', responseCode, responseBody.slice(0, 1024), attempt);
      return { status: 'success', nextDelayMs: null };
    }
    const nextDelay = WebhookManager.backoffMs(attempt);
    const exhausted = attempt + 1 >= maxAttempts || nextDelay >= WebhookManager.MAX_RETRY_WINDOW_MS;
    const status = exhausted ? 'dead_letter' : 'retrying';
    await this._recordDelivery(endpointId, event, status, responseCode, responseBody.slice(0, 1024), attempt);
    return { status, nextDelayMs: exhausted ? null : nextDelay };
  }

  private async _recordDelivery(
    endpointId: string,
    event: string,
    status: string,
    responseCode: number | null,
    responseBody: string | null,
    attempt: number,
  ): Promise<void> {
    await this._pool.query(
      `INSERT INTO street_webhook_deliveries (endpoint_id, event, status, response_code, response_body, attempt)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [endpointId, event, status, responseCode, responseBody, attempt],
    );
  }
}

function rowToEndpoint(row: Record<string, string | null>): WebhookEndpoint {
  let events: string[] = [];
  try { events = JSON.parse(row['events'] ?? '[]') as string[]; } catch { events = []; }
  return {
    id: row['id'] ?? '',
    url: row['url'] ?? '',
    events,
    secret: row['secret'] ?? '',
    createdAt: row['created_at'] ?? '',
  };
}

function rowToDelivery(row: Record<string, string | null>): WebhookDelivery {
  return {
    id: row['id'] ?? '',
    endpointId: row['endpoint_id'] ?? '',
    event: row['event'] ?? '',
    status: row['status'] ?? '',
    responseCode: row['response_code'] != null ? parseInt(row['response_code'], 10) : null,
    responseBody: row['response_body'],
    attempt: row['attempt'] != null ? parseInt(row['attempt'], 10) : 0,
    createdAt: row['created_at'] ?? '',
  };
}
