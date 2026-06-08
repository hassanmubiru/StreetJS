// src/database/mysql/auth-scramble.ts
//
// MySQL Client/Server authentication challenge-response scrambles.
//
// This module is deliberately isolated to contain ONLY the protocol-mandated
// password scramble computations (mysql_native_password and caching_sha2_password).
// Both are fixed by the MySQL wire protocol and necessarily hash the user's
// password with SHA1/SHA256 to produce the handshake response. They are NOT
// at-rest password storage, and the algorithms cannot be changed without breaking
// authentication against a real MySQL server.
//
// CodeQL's `js/insufficient-password-hash` query flags these as a false positive
// (it cannot distinguish a protocol challenge-response from credential storage).
// Inline `// codeql[...]` suppression comments are not honored by GitHub code
// scanning (github/codeql#11427). Rather than dismiss the alerts manually or
// disable the rule repo-wide (which would mask genuinely-insecure password hashing
// elsewhere, e.g. the PBKDF2 storage in services/user.service.ts), this single,
// purpose-built file is excluded from analysis via .github/codeql/codeql-config.yml.
// The rest of the MySQL driver (wire.ts) remains fully scanned.

import { createHash } from 'node:crypto';

/**
 * Compute mysql_native_password response:
 *   SHA1(password) XOR SHA1(seed + SHA1(SHA1(password)))
 * @internal
 */
export function nativePasswordHash(password: string, seed: Buffer): Buffer {
  const sha1 = (data: Buffer | string): Buffer => createHash('sha1').update(data).digest();
  const pw = Buffer.from(password, 'utf8');
  const hash1 = sha1(pw); // SHA1(password)
  const hash2 = sha1(hash1); // SHA1(SHA1(password))
  const combined = Buffer.concat([seed, hash2]); // seed + SHA1(SHA1(password))
  const hash3 = sha1(combined); // SHA1(seed + SHA1(SHA1(password)))
  // XOR hash1 with hash3
  const result = Buffer.allocUnsafe(20);
  for (let i = 0; i < 20; i++) {
    result[i] = hash1[i]! ^ hash3[i]!;
  }
  return result;
}

/**
 * Compute caching_sha2_password challenge response:
 *   XOR(SHA256(password), SHA256(SHA256(SHA256(password)) + seed))
 *
 * An empty password yields an empty (zero-length) response, matching the
 * MySQL client protocol — the server treats an empty scramble as "no password".
 * @internal
 */
export function sha2PasswordHash(password: string, seed: Buffer): Buffer {
  if (password.length === 0) return Buffer.alloc(0);
  const sha256 = (data: Buffer | string): Buffer => createHash('sha256').update(data).digest();
  const pw = Buffer.from(password, 'utf8');
  const A = sha256(pw); // SHA256(password)
  const B = sha256(A); // SHA256(SHA256(password))
  const C = sha256(Buffer.concat([B, seed])); // SHA256(SHA256(SHA256(password)) + seed)
  // XOR A with C
  const result = Buffer.allocUnsafe(32);
  for (let i = 0; i < 32; i++) {
    result[i] = A[i]! ^ C[i]!;
  }
  return result;
}
