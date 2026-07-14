/**
 * Runnable example: `node dist/examples/integration.js`
 *
 * Demonstrates a stateless encrypted session cookie flow: issue a session on
 * login, read it back on a later request, and reject a tampered cookie.
 */

import { randomBytes } from 'node:crypto';
import { SessionManager, type SessionData } from '../index.js';

function main(): void {
  // In production this key comes from config/secret storage (openssl rand -hex 32).
  const sessions = new SessionManager(randomBytes(32).toString('hex'));

  // Login: build a session with a CSRF token and issue it as an opaque cookie value.
  const csrf = SessionManager.generateCsrf();
  const session: SessionData = { userId: 'u_42', email: 'ada@example.com', roles: ['admin'], csrf };
  const cookie = sessions.encrypt(session);
  process.stdout.write(`Set-Cookie: sid=${cookie.slice(0, 24)}… (${cookie.length} chars)\n`);

  // Later request: decrypt and authorize.
  const restored = sessions.decrypt(cookie);
  process.stdout.write(`restored userId=${restored?.userId} roles=${JSON.stringify(restored?.roles)}\n`);
  process.stdout.write(`csrf matches: ${restored?.csrf === csrf}\n`);

  // Tampering: any modification fails authentication.
  const tampered = Buffer.from(cookie, 'base64');
  tampered[tampered.length - 1] ^= 0x01;
  const bad = sessions.decrypt(tampered.toString('base64'));
  process.stdout.write(`tampered cookie decrypts to: ${bad === null ? 'null (rejected)' : 'UNEXPECTED'}\n`);
}

main();
