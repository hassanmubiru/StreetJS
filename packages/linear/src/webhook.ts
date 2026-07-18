// src/webhook.ts
// Linear webhook verification (Linear-Signature, HMAC-SHA256).
//
// Linear signs the raw request body with HMAC-SHA256 keyed by the webhook
// signing secret and sends the hex digest in the `Linear-Signature` header
// (no prefix).

import { verifyHmacSignature } from '@streetjs/integrations';

export interface LinearVerifyInput {
  /** The webhook signing secret from Linear's webhook settings. */
  secret: string;
  /** The exact raw request body bytes. */
  body: string;
  /** The `Linear-Signature` header value (hex). */
  signature: string;
}

/**
 * Verify an inbound Linear webhook. Linear HMAC-SHA256-signs the raw body and
 * sends the hex digest in `Linear-Signature`. Comparison is constant-time;
 * an empty signature returns false.
 */
export function verifyLinearWebhook(input: LinearVerifyInput): boolean {
  if (!input.signature) return false;
  return verifyHmacSignature({
    algorithm: 'sha256',
    secret: input.secret,
    payload: input.body,
    signature: input.signature,
  });
}
