// src/webhook.ts
// Notion webhook verification (X-Notion-Signature, HMAC-SHA256).
//
// Notion signs the raw request body with HMAC-SHA256 keyed by the verification
// token issued when the webhook subscription is created, and sends
// `sha256=<hex>` in the `X-Notion-Signature` header.

import { verifyHmacSignature } from '@streetjs/integrations';

export interface NotionVerifyInput {
  /** The verification token issued for the webhook subscription. */
  secret: string;
  /** The exact raw request body bytes. */
  body: string;
  /** The `X-Notion-Signature` header value, e.g. `sha256=<hex>`. */
  signature: string;
}

/**
 * Verify an inbound Notion webhook. Notion HMAC-SHA256-signs the raw body with
 * the subscription's verification token and sends `sha256=<hex>` in the
 * `X-Notion-Signature` header. Comparison is constant-time; a missing or
 * non-`sha256=` signature returns false.
 */
export function verifyNotionWebhook(input: NotionVerifyInput): boolean {
  if (!input.signature || !input.signature.startsWith('sha256=')) return false;
  return verifyHmacSignature({
    algorithm: 'sha256',
    secret: input.secret,
    payload: input.body,
    signature: input.signature,
    prefix: 'sha256=',
  });
}
