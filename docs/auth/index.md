---
title: Authentication
nav_order: 3
has_children: true
---

# Authentication

Street provides a complete, production-grade authentication system out of the box. It covers every layer of a modern auth stack — JWT access tokens, server-side sessions, API keys, OAuth2/OIDC with PKCE, WebAuthn passkeys, refresh tokens, and role-based access control (RBAC). No external auth service required.

## Overview

| Feature | Class / Helper | Guide |
|---------|---------------|-------|
| JWT access tokens | `JwtService` | [below](#jwt) |
| Server-side sessions | `SessionManager` | [below](#sessions) |
| API key authentication | `ApiKeyService`, `apiKeyMiddleware` | [below](#api-keys) |
| OAuth2 + PKCE | `OAuthManager` | [OAuth2 Guide](./oauth2.md) |
| WebAuthn / Passkeys | `WebAuthnService` | [WebAuthn Guide](./webauthn.md) |
| Refresh tokens | `RefreshTokenService` | [below](#refresh-tokens) |
| RBAC | `RbacService`, `@Roles()`, `@Permissions()` | [RBAC Guide](./rbac.md) |

---

## JWT {#jwt}

`JwtService` provides HMAC-SHA256 or RS256 signed tokens with expiry, subject, and arbitrary claims.

```typescript
import { JwtService } from '@streetjs/core';

const jwt = new JwtService({ secret: process.env.JWT_SECRET! });

// Sign a token (expires in 15 min by default)
const token = jwt.sign({ sub: user.id, roles: user.roles }, { expiresIn: '15m' });

// Verify and decode
const payload = jwt.verify(token);
// → { sub: '...', roles: [...], iat: ..., exp: ... }
```

Use `authMiddleware` to automatically validate Bearer tokens on every request:

```typescript
import { authMiddleware } from '@streetjs/core';

app.use(authMiddleware(jwt));
// ctx.user is now populated for authenticated requests
```

---

## Sessions {#sessions}

For cookie-based server sessions, use `SessionManager`. It encrypts session data with AES-256-GCM using a key derived from `SESSION_KEY`.

```typescript
import { SessionManager } from '@streetjs/core';

const sessions = new SessionManager({ secret: process.env.SESSION_KEY! });

// In a login route:
await sessions.set(ctx, { userId: user.id, roles: user.roles });

// In a protected route:
const session = await sessions.get(ctx);
if (!session) throw new UnauthorizedException();

// Logout:
await sessions.destroy(ctx);
```

Sessions are stored in a signed, encrypted cookie. The session data never leaves the browser unencrypted.

---

## API Keys {#api-keys}

`ApiKeyService` generates and verifies long-lived API keys suitable for machine-to-machine authentication. Keys are hashed in the database (SHA-256 + prefix storage) and never stored in plaintext.

### Setup

Run the migration first:

```typescript
import { API_KEYS_MIGRATION_SQL, ApiKeyService } from '@streetjs/core';

await pool.query(API_KEYS_MIGRATION_SQL);
const apiKeys = new ApiKeyService(pool);
```

### Generate a key

```typescript
const { key, record } = await apiKeys.generate({
  ownerId: 'user-123',
  name: 'Production API Key',
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
});

// `key` is the plaintext key — show to user ONCE and never store it.
// `record` contains the database row (id, prefix, ownerId, createdAt).
console.log('Your API key:', key); // sk_live_xxxxxxxx...
```

### Verify a key (middleware)

Use the built-in `apiKeyMiddleware`:

```typescript
import { apiKeyMiddleware } from '@streetjs/core';

app.use(apiKeyMiddleware(apiKeys));
// Sets ctx.user if the X-API-Key header contains a valid key
```

### Revoke a key

```typescript
await apiKeys.revoke(record.id);
```

---

## Refresh Tokens {#refresh-tokens}

`RefreshTokenService` implements single-use refresh token rotation with replay detection. Stolen tokens are automatically invalidated via the `TokenReplayError` mechanism.

```typescript
import {
  RefreshTokenService,
  REFRESH_TOKENS_MIGRATION_SQL,
  TokenReplayError,
} from '@streetjs/core';

await pool.query(REFRESH_TOKENS_MIGRATION_SQL);
const refreshSvc = new RefreshTokenService(pool, { ttlMs: 7 * 24 * 60 * 60 * 1000 });

// On login — issue both tokens:
const accessToken = jwt.sign({ sub: user.id });
const refreshToken = await refreshSvc.issue(user.id);

// On token refresh endpoint:
try {
  const newRefresh = await refreshSvc.rotate(incomingRefreshToken);
  const newAccess = jwt.sign({ sub: userId });
  ctx.json({ accessToken: newAccess, refreshToken: newRefresh });
} catch (err) {
  if (err instanceof TokenReplayError) {
    // Token was already used — revoke all tokens for this user
    await refreshSvc.revokeAll(userId);
    throw new UnauthorizedException('Token reuse detected');
  }
  throw err;
}
```

---

## RBAC

See the dedicated [RBAC Guide](./rbac.md) for full documentation on `@Roles()`, `@Permissions()`, `RoleHierarchy`, and `rbacGuard`.

---

## OAuth2

See the dedicated [OAuth2 Guide](./oauth2.md) for full documentation on `OAuthManager`, PKCE flow, and provider configuration.

---

## WebAuthn / Passkeys

See the dedicated [WebAuthn Guide](./webauthn.md) for full documentation on passkey registration and authentication.

---

## Security Checklist

- Rotate `JWT_SECRET` and `SESSION_KEY` via your secrets manager (see [Cloud Secret Providers](../cloud/secrets.md)).
- Set `expiresIn` to ≤15 minutes for access tokens; use refresh tokens for long sessions.
- Enable `securityHeaders` middleware to set HSTS, CSP, and other security headers.
- Use `requireRoles` guards on all admin routes.
- Store API keys hashed — never log or return the plaintext key after generation.
