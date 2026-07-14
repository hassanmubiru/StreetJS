// HS256 JWT implementation using node:crypto only.

import { createHmac, timingSafeEqual } from 'node:crypto';

/** JWT claims. `sub` is required; standard + custom claims are permitted. */
export interface JwtPayload {
  sub: string;
  email?: string;
  roles?: string[];
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/** Options for signing and verification. */
export interface JwtOptions {
  expiresInSeconds?: number;
  issuer?: string;
  audience?: string;
}

const HEADER = base64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

/**
 * Sign, verify, and decode HS256 JSON Web Tokens.
 *
 * Verification is hardened against algorithm confusion (the header must declare
 * exactly `HS256`/`JWT`), uses a timing-safe signature comparison, and enforces
 * `exp`/`nbf`/`iat` (with clock skew) plus optional `iss`/`aud`.
 */
export class JwtService {
  private readonly secret: Buffer;

  /** @param secret signing secret, at least 32 characters. */
  constructor(secret: string) {
    if (secret.length < 32) {
      throw new Error('JWT secret must be at least 32 characters');
    }
    this.secret = Buffer.from(secret, 'utf8');
  }

  /** Sign a payload and return a compact JWT string. */
  sign(payload: JwtPayload, options: JwtOptions = {}): string {
    const now = Math.floor(Date.now() / 1000);
    const claims: JwtPayload = {
      ...payload,
      iat: now,
      ...(options.expiresInSeconds !== undefined ? { exp: now + options.expiresInSeconds } : {}),
      ...(options.issuer ? { iss: options.issuer } : {}),
      ...(options.audience ? { aud: options.audience } : {}),
    };

    const payloadEncoded = base64urlEncode(JSON.stringify(claims));
    const message = `${HEADER}.${payloadEncoded}`;
    const signature = this.signMessage(message);

    return `${message}.${signature}`;
  }

  /** Verify a JWT and return its payload, or `null` if invalid/expired/mismatched. */
  verify(token: string, options: JwtOptions = {}): JwtPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

    // Verify the header declares exactly HS256 / JWT — prevents algorithm
    // confusion (e.g. alg:none) and accidental acceptance of other algorithms.
    try {
      const header = JSON.parse(base64urlDecode(headerB64)) as Record<string, unknown>;
      if (header['alg'] !== 'HS256' || header['typ'] !== 'JWT') {
        return null;
      }
    } catch {
      return null;
    }

    const message = `${headerB64}.${payloadB64}`;
    const expectedSig = this.signMessage(message);

    // Timing-safe comparison.
    try {
      const givenSig = Buffer.from(sigB64, 'base64url');
      const expectedSigBuf = Buffer.from(expectedSig, 'base64url');
      if (givenSig.length !== expectedSigBuf.length) {
        return null;
      }
      if (!timingSafeEqual(givenSig, expectedSigBuf)) {
        return null;
      }
    } catch {
      return null;
    }

    let payload: JwtPayload;
    try {
      payload = JSON.parse(base64urlDecode(payloadB64)) as JwtPayload;
    } catch {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (payload.exp !== undefined && payload.exp < now) {
      return null;
    }
    if (typeof payload.nbf === 'number' && payload.nbf > now) {
      return null;
    }
    if (payload.iat !== undefined && payload.iat > now + 60) {
      return null; // issued too far in the future (clock skew guard)
    }
    if (options.issuer && payload.iss !== options.issuer) {
      return null;
    }
    if (options.audience && payload.aud !== options.audience) {
      return null;
    }

    return payload;
  }

  /** Decode a JWT payload without verifying the signature (inspection only). */
  decode(token: string): JwtPayload | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    try {
      return JSON.parse(base64urlDecode(parts[1]!)) as JwtPayload;
    } catch {
      return null;
    }
  }

  private signMessage(message: string): string {
    return createHmac('sha256', this.secret).update(message).digest('base64url');
  }
}

function base64urlEncode(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64urlDecode(str: string): string {
  return Buffer.from(str, 'base64url').toString('utf8');
}
