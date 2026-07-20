/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Issues a short-lived JWT on login, verifies it on a later request, and shows
 * that tampering and expiry are rejected.
 */

import { JwtService, KeyRing, generateEncryptionKey } from '../index.js';

function main(): void {
  const jwt = new JwtService('example-secret-that-is-at-least-32-chars');

  // Login: issue an access token.
  const token = jwt.sign({ sub: 'u_42', roles: ['admin'] }, { expiresInSeconds: 3600, issuer: 'street' });
  process.stdout.write(`token: ${token.slice(0, 32)}… (${token.length} chars)\n`);

  // Later request: verify and authorize.
  const claims = jwt.verify(token, { issuer: 'street' });
  process.stdout.write(`verified sub=${claims?.sub} roles=${JSON.stringify(claims?.roles)}\n`);

  // Tampering: change the payload, keep the signature → rejected.
  const [h, , s] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ sub: 'u_42', roles: ['superadmin'] })).toString('base64url');
  process.stdout.write(`forged token verifies: ${jwt.verify(`${h}.${forged}.${s}`) === null ? 'null (rejected)' : 'UNEXPECTED'}\n`);

  // Expiry.
  const expired = jwt.sign({ sub: 'u_42' }, { expiresInSeconds: -1 });
  process.stdout.write(`expired token verifies: ${jwt.verify(expired) === null ? 'null (rejected)' : 'UNEXPECTED'}\n`);

  // ── Field encryption at rest, with key rotation ─────────────────────────────
  const ring = new KeyRing([{ id: 'k1', key: generateEncryptionKey() }]);
  // AAD binds the ciphertext to a record/field so it can't be transplanted.
  const enc = ring.encrypt('user@example.com', 'user:42:email');
  process.stdout.write(`\nencrypted field: ${enc.slice(0, 28)}… (key ${KeyRing.keyIdOf(enc)})\n`);
  process.stdout.write(`decrypted: ${ring.decrypt(enc, 'user:42:email')}\n`);
  process.stdout.write(`wrong AAD: ${ring.tryDecrypt(enc, 'user:99:email') === null ? 'null (rejected)' : 'UNEXPECTED'}\n`);

  // Rotate to a new primary key; old ciphertexts still decrypt.
  ring.addKey('k2', generateEncryptionKey());
  const fresh = ring.encrypt('new-secret', 'user:42:token');
  process.stdout.write(`after rotation → new writes use key ${KeyRing.keyIdOf(fresh)}; legacy still reads: ${ring.decrypt(enc, 'user:42:email')}\n`);
}

main();
