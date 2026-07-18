// src/webhook.ts
// Microsoft Teams outgoing-webhook verification (HMAC-SHA256, base64).
//
// A Teams *outgoing webhook* signs each request to your endpoint. It sends
// `Authorization: HMAC <base64signature>`, where the signature is
// HMAC-SHA256 of the raw body bytes keyed by the base64-decoded security token
// Teams gave you at registration. Unlike the hex-based schemes, both the key
// and the signature are base64 — so this uses node:crypto directly and reuses
// the shared constant-time comparison.

import { createHmac } from 'node:crypto';
import { timingSafeCompare } from '@streetjs/integrations';

export interface TeamsVerifyInput {
  /** The base64 security token from the outgoing-webhook registration. */
  secret: string;
  /** The exact raw request body bytes. */
  body: string;
  /** The `Authorization` header value, e.g. `HMAC <base64sig>`. */
  authorization: string;
}

/** Compute the expected `HMAC <base64>` value for a body + base64 key. */
export function computeTeamsSignature(secret: string, body: string): string {
  const key = Buffer.from(secret, 'base64');
  const digest = createHmac('sha256', key).update(Buffer.from(body, 'utf8')).digest('base64');
  return `HMAC ${digest}`;
}

/**
 * Verify an inbound Teams outgoing-webhook request. Reconstructs the expected
 * `HMAC <base64>` value and compares it to the `Authorization` header in
 * constant time. Returns false for a missing or non-`HMAC ` header.
 */
export function verifyTeamsOutgoingWebhook(input: TeamsVerifyInput): boolean {
  if (!input.authorization || !input.authorization.startsWith('HMAC ')) return false;
  const expected = computeTeamsSignature(input.secret, input.body);
  return timingSafeCompare(expected, input.authorization);
}
