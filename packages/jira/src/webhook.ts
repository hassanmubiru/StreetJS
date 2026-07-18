// src/webhook.ts
// Jira webhook verification (HMAC-SHA256).
//
// Jira Cloud "system" webhooks are unauthenticated by default. This verifier is
// for the recommended hardening: configure the webhook (or a Jira Automation
// "Send web request" rule) to include an HMAC-SHA256 signature of the raw body
// keyed by a shared secret, and validate it here before trusting the payload.

import { verifyHmacSignature } from '@streetjs/integrations';

export interface JiraVerifyInput {
  /** The shared secret configured on the signing side. */
  secret: string;
  /** The exact raw request body bytes. */
  body: string;
  /** The hex HMAC-SHA256 signature header value. */
  signature: string;
  /** Optional prefix to strip from `signature` (e.g. `sha256=`). */
  prefix?: string;
}

/**
 * Verify an inbound Jira webhook whose sender includes an HMAC-SHA256 signature
 * (hex) of the raw body. Comparison is constant-time. Returns false for an
 * empty signature.
 */
export function verifyJiraWebhook(input: JiraVerifyInput): boolean {
  if (!input.signature) return false;
  const opts: {
    algorithm: string;
    secret: string;
    payload: string;
    signature: string;
    prefix?: string;
  } = {
    algorithm: 'sha256',
    secret: input.secret,
    payload: input.body,
    signature: input.signature,
  };
  if (input.prefix !== undefined) opts.prefix = input.prefix;
  return verifyHmacSignature(opts);
}
