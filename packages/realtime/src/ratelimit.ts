// src/ratelimit.ts
// Per-connection and per-channel rate-limit configuration types.
//
// Reuses the core `RateLimitStore` sliding-window abstraction. The limiter is
// enabled by default with documented defaults (per-connection 20/1s,
// per-channel 200/1s). Enforcement is implemented in task 8.1; this scaffold
// establishes the exported typed surface (Req 11).

import type { RateLimitStore } from 'streetjs';

/** A single quota rule: N requests per window. */
export interface RateLimitQuota {
  /** Maximum number of requests allowed within the window. */
  requests: number;
  /** Window length as a human-readable string (e.g. "1s") or milliseconds. */
  window: string | number;
}

/** Per-connection and per-channel quotas (Req 11). Enabled by default. */
export interface RateLimitConfig {
  /** Whether rate limiting is enabled. Defaults to `true` (Req 11.5). */
  enabled?: boolean;
  /** Per-connection quota. Defaults to `{ requests: 20, window: "1s" }`. */
  perConnection?: RateLimitQuota;
  /** Per-channel quota. Defaults to `{ requests: 200, window: "1s" }`. */
  perChannel?: RateLimitQuota;
  /** Backing store; defaults to the core in-memory rate-limit store (Req 11). */
  store?: RateLimitStore;
}
