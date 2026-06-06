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
