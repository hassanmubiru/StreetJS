---
layout: default
title: Security Guide
nav_order: 6
description: "Backend security in StreetJS — JWT, AES-256-GCM sessions, rate limiting, CSRF, CORS and CSP built into the TypeScript framework."
---

# Security Guide

This document covers StreetJS's built-in security features and best practices.

## Authentication

### JWT Tokens

StreetJS's `JwtService` uses HMAC-SHA256 by default with configurable expiry.

```typescript
import { JwtService } from 'streetjs';

const jwt = new JwtService(process.env.JWT_SECRET, { expiresIn: '1h' });
const token = jwt.sign({ userId: '123', roles: ['user'] });
const payload = jwt.verify(token); // throws if invalid or expired
```

JWT secrets must be at least 256 bits (32 bytes). Set via `JWT_SECRET` environment variable.

### Refresh Tokens

The `RefreshTokenService` implements single-use refresh tokens with replay detection.

```typescript
import { RefreshTokenService } from 'streetjs';

const tokenService = new RefreshTokenService({ pool, jwtService });
const { accessToken, refreshToken } = await tokenService.issue(userId);
const refreshed = await tokenService.refresh(refreshToken); // throws TokenReplayError on reuse
```

### WebAuthn / Passkeys

```typescript
import { WebAuthnService } from 'streetjs';

const webauthn = new WebAuthnService({
  rpName: 'My App',
  rpId: 'example.com',
  origin: 'https://example.com',
  pool,
});
```

## Authorization

### Role-Based Access Control (RBAC)

```typescript
import { RbacService, Roles, Permissions, rbacGuard } from 'streetjs';

const rbac = new RbacService({
  admin: ['user:read', 'user:write', 'admin:*'],
  user: ['user:read'],
});

@Roles('admin', 'user')
@Controller('/api')
class ApiController {
  @Get('/data')
  @Permissions('user:read')
  async getData(ctx) { ... }
}
```

### API Keys

```typescript
import { ApiKeyService, apiKeyMiddleware } from 'streetjs';

const apiKeys = new ApiKeyService({ pool });
app.use(apiKeyMiddleware(apiKeys));
```

## Encryption

### Field-Level Encryption

Use `@Encrypt()` on entity fields for transparent AES-256-GCM encryption at the repository layer.

```typescript
import { Encrypt } from 'streetjs';

class UserProfile {
  @Encrypt()
  ssn: string;

  @Encrypt()
  creditCardNumber: string;
}
```

The encryption key is loaded from the vault (see Vault section below).

### Data Classification

```typescript
import { Classify } from 'streetjs';

class Document {
  @Classify('public')
  title: string;

  @Classify('confidential')
  contents: string;

  @Classify('restricted')
  internalNotes: string;
}
```

## Secret Management

### Vault

StreetJS uses AES-256-GCM envelope encryption with a Key Encryption Key (KEK).

```typescript
import { encryptSecret, decryptSecret, loadConfig } from 'streetjs';

const encrypted = encryptSecret('my-secret', process.env.KEK);
const decrypted = decryptSecret(encrypted, process.env.KEK);
```

The KEK is loaded from `KEK` environment variable. Rotate keys using `street key:rotate`.

### External Secret Providers

```typescript
import { VaultSecretProvider, AwsSecretsManagerProvider } from 'streetjs';

// HashiCorp Vault
const vaultProvider = new VaultSecretProvider({ address: 'https://vault.example.com', token: '...' });

// AWS Secrets Manager
const awsProvider = new AwsSecretsManagerProvider({ region: 'us-east-1' });
```

## Network Security

### Security Headers

StreetJS applies security headers by default with `securityHeaders` middleware:

- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Content-Security-Policy` (configurable)

### CORS

```typescript
import { corsMiddleware } from 'streetjs';

app.use(corsMiddleware(['https://app.example.com']));
```

### CSRF Protection

```typescript
import { csrfMiddleware } from 'streetjs';

app.use(csrfMiddleware()); // Double-submit cookie pattern
```

### Rate Limiting

```typescript
import { RateLimiter } from 'streetjs';

const limiter = new RateLimiter({ windowMs: 60_000, maxRequests: 100 });
app.use(limiter.middleware());
```

## Audit Logging

All security-sensitive operations should be logged via `AuditLogger`:

```typescript
import { AuditLogger } from 'streetjs';

const audit = new AuditLogger({ pool, signingKey: process.env.AUDIT_KEY });

await audit.log({
  category: 'auth',
  actorId: userId,
  action: 'login',
  ip: ctx.headers['x-forwarded-for'],
  userAgent: ctx.headers['user-agent'],
});
```

Audit logs use an HMAC-SHA256 hash chain to detect tampering.

## XSS Protection

```typescript
import { xssMiddleware, sanitizeString } from 'streetjs';

app.use(xssMiddleware); // Sanitizes all string body fields

// Manual sanitization
const safe = sanitizeString(userInput);
```

## Secure-by-default Cookies

`ctx.setCookie(name, value, options?)` follows the framework's
**secure-by-default, escape-hatch-explicit** principle: cookies are written with the
secure option unless you explicitly opt out, and every opt-out is an explicit,
visible choice.

### Defaults

When an option is **not specified**, `setCookie` resolves it to the secure default:

| Flag | Default when unspecified | Emitted attribute |
|------|--------------------------|-------------------|
| `httpOnly` | `true` | `HttpOnly` — cookie is not readable by JavaScript |
| `secure` | `true` in production (`NODE_ENV === 'production'`), otherwise omitted | `Secure` — cookie only sent over HTTPS |
| `sameSite` | `'Lax'` | `SameSite=Lax` — cookie not attached on cross-site sub-requests |

```typescript
// In production this emits: session=abc; HttpOnly; Secure; SameSite=Lax
ctx.setCookie('session', 'abc');
```

### Explicit per-flag opt-out

Each secure default can be overridden by passing the flag explicitly. Opting out is
always deliberate:

| Override | Effect |
|----------|--------|
| `httpOnly: false` | Omits `HttpOnly` (cookie becomes readable by JavaScript) |
| `secure: false` | Omits `Secure` regardless of runtime mode — even in production |
| `secure: true` | Forces `Secure` even outside production (e.g. behind a TLS-terminating proxy in development) |
| `sameSite: 'Strict' \| 'Lax' \| 'None'` | Emits the exact value you provide instead of the `'Lax'` default |

```typescript
// Readable by JS, no Secure in dev, cross-site allowed — every relaxation is explicit
ctx.setCookie('theme', 'dark', { httpOnly: false, sameSite: 'None', secure: true });
```

Leaving a flag `undefined` always falls back to the secure default; an opt-out must be
expressed explicitly to take effect.

### Multiple cookies on one response

`setCookie` appends to the response's `Set-Cookie` list rather than overwriting it.
Calling it N times produces N `Set-Cookie` values, preserved in the order they were
written, so pairing cookies (for example a session cookie and a CSRF cookie) are both
delivered to the client.

```typescript
ctx.setCookie('session', sessionId);   // first Set-Cookie
ctx.setCookie('csrf', csrfToken);      // second Set-Cookie — the first is not dropped
```

## Security Checklist

- [ ] Set `JWT_SECRET` to a cryptographically random 256-bit value
- [ ] Set `KEK` for field-level encryption
- [ ] Set `SESSION_KEY` for session signing
- [ ] Enable HTTPS in production
- [ ] Configure `ALLOWED_ORIGINS` for CORS
- [ ] Enable rate limiting on public endpoints
- [ ] Enable CSRF protection for state-changing endpoints
- [ ] Review `@Classify` annotations on all entity fields
- [ ] Run `npm audit --audit-level=high` before each release
