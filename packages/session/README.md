# @streetjs/session

The session foundation for StreetJS: **stateless, encrypted session tokens** using
AES-256-GCM (authenticated encryption), with key-entropy validation and CSRF/session-id
helpers.

**Zero runtime dependencies.** Built on Node.js core (`crypto`) only, matching the
StreetJS minimal, carefully curated dependency footprint. Generic and reusable by any
application.

```bash
npm install @streetjs/session
```

> This is the standalone home of the session manager that also backs `streetjs/session`;
> the `streetjs` framework re-exports it, so there is a single implementation.

## Quick start

```ts
import { SessionManager } from '@streetjs/session';

// 64-char hex key (32 bytes). Generate with: openssl rand -hex 32
const sessions = new SessionManager(process.env.SESSION_KEY!);

const token = sessions.encrypt({ userId: '7', roles: ['admin'], csrf });
const data = sessions.decrypt(token); // SessionData | null (null when tampered/invalid)
```

## How it works

- **Stateless** — the session lives entirely in the encrypted token (e.g. a cookie),
  so there is no server-side session store to scale or invalidate.
- **Authenticated encryption** — AES-256-GCM produces `iv | tag | ciphertext`; any
  modification fails the auth tag and `decrypt` returns `null`. Plaintext is never
  retained.
- **Key validation** — the constructor requires a 64-char hex key (32 bytes) and rejects
  low-entropy keys (e.g. an all-zeros default) to prevent an insecure misconfiguration.

## API

```ts
const sm = new SessionManager(hexKey);
sm.encrypt(data: SessionData): string;          // base64 token
sm.decrypt(token: string): SessionData | null;  // null if tampered/invalid

SessionManager.generateCsrf(): string;          // base64url, 32 random bytes
SessionManager.generateSessionId(): string;     // base64url, 24 random bytes
```

`SessionData` is an open shape (`userId?`, `email?`, `roles?`, `csrf?`, plus any extra
fields), so you can store whatever your app needs.

## Security notes

- Keep the key secret and rotate it via your secret store; a key change invalidates all
  existing tokens (they simply fail to decrypt).
- Set the cookie `HttpOnly`, `Secure`, and `SameSite` at the HTTP layer; this package
  handles only the token crypto.
- Pair with the CSRF token for state-changing requests (double-submit or header check).

## Dependency injection

Depends on no container. Exports a `SESSION_MANAGER` token (a global `Symbol`):

```ts
import { SESSION_MANAGER, SessionManager } from '@streetjs/session';
container.register(SESSION_MANAGER, new SessionManager(key));
```

## Public API

`SessionManager` · `SessionData` · `SESSION_MANAGER` token.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for design notes, and
`src/examples/integration.ts` for a runnable cookie-session example.

## License

MIT © street contributors
