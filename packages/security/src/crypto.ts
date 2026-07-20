// src/crypto.ts
// Authenticated field encryption (AES-256-GCM) with key rotation.
//
// Encrypts individual values (PII, transcripts, tokens) at rest. Every token is
// self-describing — it carries the key id used — so a `KeyRing` can hold several
// keys, encrypt with the current one, and still decrypt data written under
// older keys during/after rotation. Additional authenticated data (AAD) can
// bind a ciphertext to a context (e.g. a record id or field name) so it cannot
// be transplanted elsewhere.
//
// node:crypto only; zero runtime dependencies.

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/** Compact token prefix identifying the format/version. */
const TOKEN_PREFIX = 'sjc1';
/** AES-256 key length in bytes. */
const KEY_BYTES = 32;
/** GCM IV (nonce) length in bytes (96-bit, the GCM-recommended size). */
const IV_BYTES = 12;
/** GCM authentication tag length in bytes. */
const TAG_BYTES = 16;
/** Key ids must be non-empty and free of the token delimiter. */
const KEY_ID_RE = /^[A-Za-z0-9_-]+$/;

/** Raised on any decryption/parse/authentication failure. */
export class EncryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionError';
  }
}

/** Generate a fresh 256-bit key as hex (64 chars). */
export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}

/** Coerce a key input (32-byte Buffer, 64-char hex, or base64/base64url) to a 32-byte Buffer. */
function coerceKey(key: string | Buffer): Buffer {
  let buf: Buffer;
  if (Buffer.isBuffer(key)) {
    buf = key;
  } else if (/^[0-9a-fA-F]{64}$/.test(key)) {
    buf = Buffer.from(key, 'hex');
  } else {
    // Try base64 / base64url.
    buf = Buffer.from(key, 'base64');
  }
  if (buf.length !== KEY_BYTES) {
    throw new EncryptionError(`encryption key must be ${KEY_BYTES} bytes (got ${buf.length})`);
  }
  return buf;
}

function assertKeyId(id: string): string {
  if (!KEY_ID_RE.test(id)) {
    throw new EncryptionError(`invalid key id ${JSON.stringify(id)} (allowed: A-Z a-z 0-9 _ -)`);
  }
  return id;
}

/**
 * A set of named AES-256-GCM keys with a designated primary used for
 * encryption. Rotation is "add a new primary, keep the old keys": new writes
 * use the new key while existing ciphertexts remain decryptable until re-encrypted.
 */
export class KeyRing {
  private readonly keys = new Map<string, Buffer>();
  private primary: string;

  constructor(entries: Array<{ id: string; key: string | Buffer }>, primaryId?: string) {
    if (!Array.isArray(entries) || entries.length === 0) {
      throw new EncryptionError('KeyRing requires at least one key');
    }
    for (const { id, key } of entries) {
      this.keys.set(assertKeyId(id), coerceKey(key));
    }
    const chosen = primaryId ?? entries[entries.length - 1]!.id;
    if (!this.keys.has(chosen)) {
      throw new EncryptionError(`primary key id "${chosen}" is not in the ring`);
    }
    this.primary = chosen;
  }

  /** The id of the key currently used for encryption. */
  get primaryId(): string {
    return this.primary;
  }

  /** All key ids in the ring. */
  keyIds(): string[] {
    return [...this.keys.keys()];
  }

  /** Add a key. `makePrimary` (default true) rotates encryption to it. */
  addKey(id: string, key: string | Buffer, options: { makePrimary?: boolean } = {}): void {
    this.keys.set(assertKeyId(id), coerceKey(key));
    if (options.makePrimary !== false) this.primary = id;
  }

  /** Make an existing key the primary (encryption) key. */
  rotateTo(id: string): void {
    if (!this.keys.has(id)) throw new EncryptionError(`unknown key id "${id}"`);
    this.primary = id;
  }

  /** Encrypt `plaintext` with the primary key, returning a self-describing token. */
  encrypt(plaintext: string, aad?: string): string {
    const key = this.keys.get(this.primary)!;
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ct = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      TOKEN_PREFIX,
      this.primary,
      iv.toString('base64url'),
      ct.toString('base64url'),
      tag.toString('base64url'),
    ].join('.');
  }

  /** Decrypt a token, throwing {@link EncryptionError} on any failure. */
  decrypt(token: string, aad?: string): string {
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) {
      throw new EncryptionError('malformed ciphertext token');
    }
    const [, keyId, ivB64, ctB64, tagB64] = parts as [string, string, string, string, string];
    const key = this.keys.get(keyId);
    if (!key) throw new EncryptionError(`unknown key id "${keyId}"`);

    let iv: Buffer;
    let ct: Buffer;
    let tag: Buffer;
    try {
      iv = Buffer.from(ivB64, 'base64url');
      ct = Buffer.from(ctB64, 'base64url');
      tag = Buffer.from(tagB64, 'base64url');
    } catch {
      throw new EncryptionError('malformed ciphertext encoding');
    }
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new EncryptionError('malformed ciphertext parameters');
    }

    try {
      const decipher = createDecipheriv('aes-256-gcm', key, iv);
      if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString('utf8');
    } catch {
      // Wrong key, tampered ciphertext/tag, or AAD mismatch.
      throw new EncryptionError('decryption failed (authentication error)');
    }
  }

  /** Decrypt, returning `null` instead of throwing on failure. */
  tryDecrypt(token: string, aad?: string): string | null {
    try {
      return this.decrypt(token, aad);
    } catch {
      return null;
    }
  }

  /** The key id a token was encrypted under (without decrypting). Null if malformed. */
  static keyIdOf(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) return null;
    return parts[1]!;
  }
}

/**
 * Single-key convenience over {@link KeyRing} for the common case of one active
 * key. `keyId` defaults to `'0'`.
 */
export class FieldCipher {
  private readonly ring: KeyRing;

  constructor(key: string | Buffer, keyId = '0') {
    this.ring = new KeyRing([{ id: keyId, key }], keyId);
  }

  encrypt(plaintext: string, aad?: string): string {
    return this.ring.encrypt(plaintext, aad);
  }

  decrypt(token: string, aad?: string): string {
    return this.ring.decrypt(token, aad);
  }

  tryDecrypt(token: string, aad?: string): string | null {
    return this.ring.tryDecrypt(token, aad);
  }
}

/** Constant-time equality for two strings (e.g. comparing opaque tokens). */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
