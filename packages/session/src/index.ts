/**
 * @streetjs/session — the StreetJS session foundation.
 *
 * Stateless, encrypted session tokens using AES-256-GCM (authenticated
 * encryption) with key-entropy validation and CSRF/session-id helpers. Zero
 * runtime dependencies. Public API only.
 *
 * ```ts
 * import { SessionManager } from '@streetjs/session';
 *
 * const sessions = new SessionManager(process.env.SESSION_KEY!); // 64-char hex (32 bytes)
 * const token = sessions.encrypt({ userId: '7', roles: ['admin'] });
 * const data = sessions.decrypt(token); // SessionData | null (null if tampered)
 * ```
 *
 * > This is the standalone home of the session manager that also backs
 * > `streetjs/session`; the `streetjs` framework re-exports it, so there is a
 * > single implementation.
 */

export { SessionManager, type SessionData } from './session.js';

/**
 * Dependency-injection token for a {@link SessionManager}. `@streetjs/session`
 * depends on no container, so the token is a plain unique symbol.
 */
export const SESSION_MANAGER: unique symbol = Symbol.for('@streetjs/session:SessionManager');
