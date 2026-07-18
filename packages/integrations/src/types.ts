// src/types.ts
// Shared contracts for integration connectors.

/** Minimal HTTP response shape the connector consumes. */
export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

/** Injectable fetch used by every connector, so requests are unit-testable. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<HttpResponseLike>;

/** Authentication strategy applied to outbound requests. */
export type AuthStrategy =
  | { type: 'bearer'; token: string }
  | { type: 'header'; name: string; value: string }
  | { type: 'none' };

export interface ConnectorOptions {
  /** Base URL for the vendor API (no trailing slash required). */
  baseUrl: string;
  /** Auth applied to every request. Default `{ type: 'none' }`. */
  auth?: AuthStrategy;
  /** Injectable fetch. Defaults to the global `fetch`. */
  fetch?: FetchLike;
  /** Default headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Idempotent-retry attempts on network errors / 429 / 5xx. Default 2. */
  retries?: number;
  /** Sleep function for backoff between retries (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
}

/** Options for a single request. */
export interface RequestOptions {
  method?: string;
  /** Query parameters appended to the path. */
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON body (serialized) or a raw string. */
  body?: unknown;
  /** Per-request header overrides. */
  headers?: Record<string, string>;
}

/** Metadata describing a connector (for a registry/marketplace listing). */
export interface ConnectorInfo {
  /** Vendor slug, e.g. 'slack', 'github'. */
  vendor: string;
  /** Human-readable name. */
  displayName: string;
  /** Capabilities the connector exposes, e.g. ['chat.post', 'webhooks']. */
  capabilities: string[];
}
