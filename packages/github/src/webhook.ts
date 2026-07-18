// src/webhook.ts
// GitHub webhook signature verification (X-Hub-Signature-256).

import { verifyHmacSignature } from '@streetjs/integrations';

export interface GitHubVerifyInput {
  /** The webhook secret configured on the repo/org/app. */
  secret: string;
  /** The exact raw request body bytes (before JSON parsing). */
  body: string;
  /**
   * The `X-Hub-Signature-256` header value, e.g. `sha256=<hex>`.
   * The legacy `X-Hub-Signature` (`sha1=…`) is intentionally not accepted.
   */
  signature: string;
}

/**
 * Verify an inbound GitHub webhook. GitHub signs the raw request body with
 * HMAC-SHA256 keyed by the webhook secret and sends `sha256=<hex>` in the
 * `X-Hub-Signature-256` header. The comparison is constant-time.
 */
export function verifyGitHubWebhook(input: GitHubVerifyInput): boolean {
  if (!input.signature || !input.signature.startsWith('sha256=')) return false;
  return verifyHmacSignature({
    algorithm: 'sha256',
    secret: input.secret,
    payload: input.body,
    signature: input.signature,
    prefix: 'sha256=',
  });
}
