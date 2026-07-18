// src/interactions.ts
// Discord interaction-request verification (Ed25519).
//
// Discord signs interaction webhooks with Ed25519 (NOT HMAC), so this uses
// node:crypto directly rather than the shared HMAC helpers. The application's
// public key is provided as hex in the Developer Portal.

import { createPublicKey, verify, type KeyObject } from 'node:crypto';

// DER SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Build a public KeyObject from a raw 32-byte Ed25519 key in hex. */
export function ed25519PublicKeyFromHex(hex: string): KeyObject {
  const raw = Buffer.from(hex, 'hex');
  if (raw.length !== 32) {
    throw new Error('Discord public key must be 32 bytes (64 hex chars)');
  }
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw]);
  return createPublicKey({ key: der, format: 'der', type: 'spki' });
}

export interface DiscordVerifyInput {
  /** The application public key (hex) from the Developer Portal. */
  publicKey: string;
  /** Value of the `X-Signature-Ed25519` header (hex). */
  signature: string;
  /** Value of the `X-Signature-Timestamp` header. */
  timestamp: string;
  /** The exact raw request body bytes. */
  body: string;
}

/**
 * Verify an inbound Discord interaction request. Discord signs
 * `timestamp + body` with the application's Ed25519 private key; this checks
 * the `X-Signature-Ed25519` header against the configured public key. Any
 * malformed input (bad hex, wrong key length) is treated as a failed
 * verification rather than throwing.
 */
export function verifyDiscordInteraction(input: DiscordVerifyInput): boolean {
  if (!input.signature || !input.timestamp) return false;
  try {
    const key = ed25519PublicKeyFromHex(input.publicKey);
    const message = Buffer.from(input.timestamp + input.body, 'utf8');
    const sig = Buffer.from(input.signature, 'hex');
    if (sig.length !== 64) return false;
    return verify(null, message, key, sig);
  } catch {
    return false;
  }
}
