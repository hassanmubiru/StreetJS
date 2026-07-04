/**
 * @streetjs/gateway — response security headers and request-size limits.
 *
 * A pure, side-effect-free security layer:
 *
 *  - {@link DEFAULT_SECURITY_HEADERS} — conservative defaults applied to every
 *    response.
 *  - {@link applySecurityHeaders} — merge defaults + policy overrides over an
 *    existing response header bag, producing a new (lower-cased) bag.
 *  - {@link enforceBodyLimit} — reject over-limit request bodies with a
 *    {@link PayloadTooLargeError}.
 *  - {@link resolveHeaderTimeoutMs} — surface the configured header-completion
 *    timeout.
 *
 * Slowloris / header-timeout protection is expressed here only as configuration
 * ({@link resolveHeaderTimeoutMs}). Actual socket-level enforcement — closing a
 * connection whose headers do not arrive within the budget — belongs to the HTTP
 * server owning the socket, not to this pure module.
 */

import type { Headers, SecurityPolicy } from "./types.js";
import { PayloadTooLargeError } from "./errors.js";

/**
 * Conservative, broadly-safe security headers applied to every response unless
 * overridden by a {@link SecurityPolicy}. Keys are lower-cased.
 */
export const DEFAULT_SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "x-dns-prefetch-control": "off",
};

/**
 * Produce a new header bag: the existing response `headers`, then
 * {@link DEFAULT_SECURITY_HEADERS}, then `policy.headers` overrides, merged in
 * that order (later wins). All keys are normalized to lower case, so overrides
 * take effect regardless of the casing used by the caller.
 */
export function applySecurityHeaders(headers: Headers, policy?: SecurityPolicy): Headers {
  const merged: Record<string, string | string[] | undefined> = {};

  // Start from the existing response headers, lower-casing keys.
  for (const [key, value] of Object.entries(headers)) {
    merged[key.toLowerCase()] = value;
  }

  // Defaults win over pre-existing headers of the same (lower-cased) name.
  for (const [key, value] of Object.entries(DEFAULT_SECURITY_HEADERS)) {
    merged[key.toLowerCase()] = value;
  }

  // Policy overrides win over everything.
  if (policy?.headers) {
    for (const [key, value] of Object.entries(policy.headers)) {
      merged[key.toLowerCase()] = value;
    }
  }

  return merged;
}

/**
 * Reject an over-large request body. When `policy.maxBodyBytes` is set and the
 * body's `byteLength` exceeds it, throw {@link PayloadTooLargeError} carrying the
 * limit. A missing body, unset limit, or a body at/under the limit is a no-op.
 */
export function enforceBodyLimit(body: Uint8Array | undefined, policy?: SecurityPolicy): void {
  const limit = policy?.maxBodyBytes;
  if (limit === undefined) return;
  if (body !== undefined && body.byteLength > limit) {
    throw new PayloadTooLargeError(limit);
  }
}

/**
 * Return the configured header-completion timeout in ms, or `undefined` when
 * none is set. This is configuration only; the HTTP server owning the socket is
 * responsible for the actual slowloris enforcement.
 */
export function resolveHeaderTimeoutMs(policy?: SecurityPolicy): number | undefined {
  return policy?.headerTimeoutMs;
}
