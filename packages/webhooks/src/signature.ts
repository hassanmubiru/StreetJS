/**
 * HMAC-SHA256 webhook signing and constant-time verification.
 *
 * Signature scheme (generic, Stripe-style):
 *   signed content = `${timestamp}.${payload}`
 *   header value   = `t=${timestamp},v1=${hex(HMAC-SHA256(secret, signedContent))}`
 *
 * Depends on `node:crypto` and `types`.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { SignatureResult, SignOptions, VerifyOptions, VerifyResult } from './types.js';

const DEFAULT_TOLERANCE_SEC = 300;

function hmacHex(secret: string, data: string): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

/** Constant-time comparison of two hex strings. Length/decoding mismatches fail. */
function timingSafeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  // Buffer.from(_, 'hex') truncates at the first non-hex char rather than
  // throwing, so a decoded length mismatch catches malformed input.
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length === 0 || bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/** Sign a payload string with the shared secret. */
export function signPayload(payload: string, secret: string, options: SignOptions = {}): SignatureResult {
  const timestamp = options.timestamp ?? Math.floor(Date.now() / 1000);
  const signature = hmacHex(secret, `${timestamp}.${payload}`);
  return { timestamp, signature, header: `t=${timestamp},v1=${signature}` };
}

/** Parse a `t=…,v1=…` header into its parts, or `null` when malformed. */
export function parseSignatureHeader(header: string): { t: number; v1: string } | null {
  if (typeof header !== 'string') {
    return null;
  }
  let t: number | undefined;
  let v1: string | undefined;
  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't' && /^\d+$/.test(value)) {
      t = Number(value);
    } else if (key === 'v1') {
      v1 = value;
    }
  }
  if (t === undefined || v1 === undefined) {
    return null;
  }
  return { t, v1 };
}

/**
 * Verify a signed payload against a header and secret. Checks the HMAC in
 * constant time and enforces the timestamp tolerance (replay protection).
 */
export function verifySignature(
  payload: string,
  header: string,
  secret: string,
  options: VerifyOptions = {},
): VerifyResult {
  const parsed = parseSignatureHeader(header);
  if (!parsed) {
    return { valid: false, reason: 'malformed signature header' };
  }
  const expected = hmacHex(secret, `${parsed.t}.${payload}`);
  if (!timingSafeHexEqual(parsed.v1, expected)) {
    return { valid: false, reason: 'signature mismatch' };
  }
  const tolerance = options.toleranceSec ?? DEFAULT_TOLERANCE_SEC;
  const now = options.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - parsed.t) > tolerance) {
    return { valid: false, reason: 'timestamp outside tolerance' };
  }
  return { valid: true };
}
