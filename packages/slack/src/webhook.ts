// src/webhook.ts
// Slack request-signature (v0) verification for inbound events/interactions.

import { hmacHex, timingSafeCompare } from '@streetjs/integrations';

export interface SlackVerifyInput {
  /** App signing secret (Slack app → Basic Information → Signing Secret). */
  signingSecret: string;
  /** Value of the `X-Slack-Request-Timestamp` header (unix seconds). */
  timestamp: string | number;
  /** The exact raw request body bytes. */
  body: string;
  /** Value of the `X-Slack-Signature` header, e.g. `v0=<hex>`. */
  signature: string;
  /** Reject requests older than this many seconds (replay guard). Default 300. */
  toleranceSeconds?: number;
  /** Current unix seconds; injectable for tests. Default `Date.now()/1000`. */
  nowSeconds?: number;
}

/**
 * Verify a Slack request signature. Slack signs the base string
 * `v0:{timestamp}:{body}` with HMAC-SHA256 and sends `v0=<hex>`. This also
 * rejects timestamps outside `toleranceSeconds` to blunt replay attacks.
 */
export function verifySlackRequest(input: SlackVerifyInput): boolean {
  const ts = Number(input.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? 300;
  if (Math.abs(now - ts) > tolerance) return false;

  const base = `v0:${input.timestamp}:${input.body}`;
  const expected = `v0=${hmacHex('sha256', input.signingSecret, base)}`;
  return timingSafeCompare(expected, input.signature);
}
