// src/webhook.ts
// GitLab webhook verification (X-Gitlab-Token secret comparison).
//
// GitLab does not HMAC-sign webhook bodies. Instead it echoes the secret token
// configured on the hook in the `X-Gitlab-Token` header, which the receiver
// compares against the expected secret. The comparison must be constant-time.

import { timingSafeCompare } from '@streetjs/integrations';

export interface GitLabVerifyInput {
  /** The secret token configured on the webhook. */
  secret: string;
  /** Value of the `X-Gitlab-Token` header. */
  token: string;
}

/**
 * Verify an inbound GitLab webhook by comparing the `X-Gitlab-Token` header to
 * the configured secret in constant time. Returns false if either value is
 * empty.
 */
export function verifyGitLabWebhook(input: GitLabVerifyInput): boolean {
  if (!input.secret || !input.token) return false;
  return timingSafeCompare(input.secret, input.token);
}
