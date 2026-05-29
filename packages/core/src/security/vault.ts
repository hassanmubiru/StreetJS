// src/security/vault.ts
// Vault: loads encrypted config from env vars, decrypts at runtime using KEK.
// Secrets are never written to disk in plaintext.

import { createDecipheriv, createCipheriv, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { getConfigFields } from '../core/decorators.js';
import type { Constructor } from '../core/types.js';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;
const SALT_LEN = 32;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 32;

/** Derive a 32-byte key from a passphrase + salt using scrypt */
function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
}

/** Encrypt a plaintext value using the KEK */
export function encryptSecret(plaintext: string, kek: string): string {
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(kek, salt);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(plaintext, 'utf8')),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Layout: [32 salt][12 iv][16 tag][N ciphertext]
  return Buffer.concat([salt, iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a vault-encrypted value using the KEK */
export function decryptSecret(blob: string, kek: string): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < SALT_LEN + IV_LEN + TAG_LEN + 1) {
    throw new Error('Vault: encrypted blob is too short');
  }

  const salt = buf.subarray(0, SALT_LEN);
  const iv = buf.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const tag = buf.subarray(SALT_LEN + IV_LEN, SALT_LEN + IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(SALT_LEN + IV_LEN + TAG_LEN);

  const key = deriveKey(kek, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  try {
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    throw new Error('Vault: decryption failed — data may be tampered or KEK is incorrect');
  }
}

/** Populate @Config-decorated fields on a class instance from environment variables */
export function loadConfig<T extends object>(instance: T, kek?: string): T {
  const fields = getConfigFields(instance.constructor as Constructor);

  for (const field of fields) {
    const envValue = process.env[field.envKey];

    if (field.required && (envValue === undefined || envValue === '')) {
      throw new Error(`Missing required environment variable: ${field.envKey}`);
    }

    if (envValue === undefined) continue;

    let value: string;
    if (field.encrypted) {
      if (!kek) throw new Error(`KEK required to decrypt ${field.envKey}`);
      value = decryptSecret(envValue, kek);
    } else {
      value = envValue;
    }

    (instance as Record<string, unknown>)[field.propertyKey] = value;
  }

  return instance;
}

/** Verify two secrets are equal in constant time */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Still compare to prevent timing leak on length
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
