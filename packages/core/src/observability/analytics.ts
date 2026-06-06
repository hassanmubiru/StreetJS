// src/observability/analytics.ts
// API analytics: buffered event recording, batched inserts, aggregation report,
// and retention pruning. Built on the existing pool + cron primitives.

import type { StreetContext } from '../core/context.js';
import type { MiddlewareFn } from '../core/types.js';

// ── Migration SQL ─────────────────────────────────────────────────────────────

export const STREET_API_EVENTS_MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS street_api_events (
  id          BIGSERIAL PRIMARY KEY,
  route       TEXT NOT NULL,
  method      TEXT NOT NULL,
  status      INT  NOT NULL,
  duration_ms DOUBLE PRECISION NOT NULL,
  user_id     TEXT,
  api_key_id  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS street_api_events_created_idx ON street_api_events (created_at);
CREATE INDEX IF NOT EXISTS street_api_events_route_idx   ON street_api_events (route);
`.trim();

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AnalyticsPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, string | null>[]; rowCount: number; command: string }>;
}

export interface AnalyticsEvent {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  userId: string | null;
  apiKeyId: string | null;
}

export interface AnalyticsServiceOptions {
  pool: AnalyticsPool;
  batchSize?: number;       // default 100
  flushIntervalMs?: number; // default 5000
  retentionDays?: number;   // default 90
}

export interface RouteReportRow {
  route: string;
  method: string;
  count: number;
  avgLatencyMs: number;
  errorRate: number;
}

export interface AnalyticsReport {
  from: string;
  to: string;
  routes: RouteReportRow[];
}
