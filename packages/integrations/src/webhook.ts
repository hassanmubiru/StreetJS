// src/webhook.ts
// Inbound-webhook signature verification primitives shared by connectors.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Compute a hex HMAC of `data` with `secret` using the named algorithm. */
export function hmacHex(algorithm: string, secret: string, data: string): string {
  return createHmac(algorithm, secret).update(data, 'utf8').digest('hex');
}

/**
 * Constant-time string comparison. Returns false for differing lengths without
 * leaking timing about where they differ.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify an HMAC-hex signature over `payload`. `expected` may include a prefix
 * like `sha256=<hex>` (as GitHub sends); it is stripped before comparison.
 */
export function verifyHmacSignature(opts: {
  algorithm: string;
  secret: string;
  payload: string;
  signature: string;
  /** Optional prefix to strip from `signature`, e.g. 'sha256='. */
  prefix?: string;
}): boolean {
  let sig = opts.signature;
  if (opts.prefix && sig.startsWith(opts.prefix)) sig = sig.slice(opts.prefix.length);
  const computed = hmacHex(opts.algorithm, opts.secret, opts.payload);
  return timingSafeCompare(computed, sig);
}
