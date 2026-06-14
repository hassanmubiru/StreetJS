// packages/plugin-mongodb/src/scram.ts
// SCRAM-SHA-256 client implementation (RFC 5802 / RFC 7677), used for MongoDB
// authentication. Pure functions over node:crypto — fully offline-verifiable
// against the published RFC 7677 test vector.

import { pbkdf2Sync, createHmac, createHash, randomBytes } from 'node:crypto';

export class ScramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScramError';
  }
}

/** GS2 header for no channel binding, base64 'n,,' = 'biws'. */
export const GS2_HEADER_B64 = 'biws';

/** Escape a SCRAM username: ',' → '=2C', '=' → '=3D'. */
export function escapeUsername(user: string): string {
  return user.replace(/=/g, '=3D').replace(/,/g, '=2C');
}

/** Generate a printable client nonce (base64 of random bytes). */
export function generateNonce(bytes = 24): string {
  return randomBytes(bytes).toString('base64');
}

/** The client-first-message bare: `n=<user>,r=<nonce>`. */
export function clientFirstBare(user: string, nonce: string): string {
  return `n=${escapeUsername(user)},r=${nonce}`;
}

export interface ServerFirst {
  raw: string;
  nonce: string;
  salt: Buffer;
  iterations: number;
}

/** Parse a server-first-message: `r=<nonce>,s=<base64 salt>,i=<iterations>`. */
export function parseServerFirst(raw: string): ServerFirst {
  const fields = new Map<string, string>();
  for (const part of raw.split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const nonce = fields.get('r');
  const saltB64 = fields.get('s');
  const iterStr = fields.get('i');
  if (!nonce || !saltB64 || !iterStr) throw new ScramError(`malformed server-first message: "${raw}"`);
  const iterations = Number.parseInt(iterStr, 10);
  if (!Number.isInteger(iterations) || iterations <= 0) throw new ScramError('invalid SCRAM iteration count');
  return { raw, nonce, salt: Buffer.from(saltB64, 'base64'), iterations };
}

function hmac(key: Buffer, data: string | Buffer): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest();
}

function xor(a: Buffer, b: Buffer): Buffer {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! ^ b[i]!;
  return out;
}

export interface ScramProof {
  /** Full client-final-message with the proof: `c=biws,r=<nonce>,p=<proof>`. */
  clientFinal: string;
  /** base64 server signature, to verify the server-final message. */
  serverSignature: string;
  /** The auth message (client-first-bare,server-first,client-final-no-proof). */
  authMessage: string;
}

/**
 * Compute the SCRAM-SHA-256 client proof and the expected server signature.
 * `password` is used as-is (callers should pre-hash per the MongoDB-SCRAM
 * convention when required; the RFC vector uses the raw password).
 */
export function computeClientProof(args: {
  password: string;
  clientFirstBare: string;
  serverFirst: ServerFirst;
}): ScramProof {
  const { password, clientFirstBare: cfb, serverFirst } = args;
  const saltedPassword = pbkdf2Sync(password, serverFirst.salt, serverFirst.iterations, 32, 'sha256');
  const clientKey = hmac(saltedPassword, 'Client Key');
  const storedKey = sha256(clientKey);
  const clientFinalNoProof = `c=${GS2_HEADER_B64},r=${serverFirst.nonce}`;
  const authMessage = `${cfb},${serverFirst.raw},${clientFinalNoProof}`;
  const clientSignature = hmac(storedKey, authMessage);
  const clientProof = xor(clientKey, clientSignature);
  const serverKey = hmac(saltedPassword, 'Server Key');
  const serverSignature = hmac(serverKey, authMessage);
  return {
    clientFinal: `${clientFinalNoProof},p=${clientProof.toString('base64')}`,
    serverSignature: serverSignature.toString('base64'),
    authMessage,
  };
}

/** Verify a server-final message `v=<base64>` matches the expected signature. */
export function verifyServerSignature(serverFinal: string, expectedB64: string): boolean {
  const m = /(^|,)v=([^,]+)/.exec(serverFinal);
  if (!m) return false;
  return m[2] === expectedB64;
}
