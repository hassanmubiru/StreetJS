// src/security/session.ts
// AES-256-GCM session manager using node:crypto.
// Encrypts session data per-request, never retains plaintext.

import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;   // 96-bit IV for GCM
const TAG_LEN = 16;  // 128-bit auth tag

export interface SessionData {
  userId?: string;
  email?: string;
  roles?: string[];
  csrf?: string;
  [key: string]: unknown;
}

export class SessionManager {
  private readonly key: Buffer;

  constructor(hexKey: string) {
    if (hexKey.length !== 64) {
      throw new Error('Session key must be a 64-char hex string (32 bytes). Generate with: openssl rand -hex 32');
    }
    const key = Buffer.from(hexKey, 'hex');

    // Finding 10 fix: reject keys with dangerously low entropy (e.g. all-zeros default).
    // Count distinct byte values — a real random key will have many unique bytes.
    const uniqueBytes = new Set(key).size;
    if (uniqueBytes < 8) {
      throw new Error(
        'Session key has insufficient entropy (too many repeated bytes). ' +
        'Generate a secure key with: openssl rand -hex 32'
      );
    }

    this.key = key;
  }

  /** Encrypt session data → base64 blob (iv + tag + ciphertext) */
  encrypt(data: SessionData): string {
    const iv = randomBytes(IV_LEN);
    const plain = Buffer.from(JSON.stringify(data), 'utf8');
    const cipher = createCipheriv(ALGO, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Layout: [12 bytes IV][16 bytes tag][N bytes ciphertext]
    const out = Buffer.concat([iv, tag, encrypted]);
    return out.toString('base64');
  }

  /** Decrypt session blob → SessionData or null if tampered/invalid */
  decrypt(blob: string): SessionData | null {
    try {
      const buf = Buffer.from(blob, 'base64');
      if (buf.length < IV_LEN + TAG_LEN + 2) return null;

      const iv = buf.subarray(0, IV_LEN);
      const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
      const ciphertext = buf.subarray(IV_LEN + TAG_LEN);

      const decipher = createDecipheriv(ALGO, this.key, iv);
      decipher.setAuthTag(tag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return JSON.parse(decrypted.toString('utf8')) as SessionData;
    } catch {
      return null; // tampered or malformed
    }
  }

  /** Generate a cryptographically random CSRF token */
  static generateCsrf(): string {
    return randomBytes(32).toString('base64url');
  }

  /** Generate a secure random session ID */
  static generateSessionId(): string {
    return randomBytes(24).toString('base64url');
  }
}
