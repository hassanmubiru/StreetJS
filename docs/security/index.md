---
layout:    default
title:     "Security"
nav_order: 7
has_children: true
permalink: /security/
description: "Security features in Street Framework — JWT, sessions, AES-256-GCM vault, rate limiting, XSS sanitization, CORS, security headers."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Security</span>
<h1>Security</h1>
<p>JWT, AES-256-GCM sessions, scrypt vault, rate limiting, XSS sanitizer, CSRF, CORS, CSP — all built in, no plugins needed.</p>
</div>

Street includes a complete security layer built on `node:crypto`. No third-party auth libraries — every primitive is implemented directly.

---

## JWT authentication

```typescript
import { JwtService, container } from 'streetjs';

const jwt = new JwtService(process.env['JWT_SECRET']!);
container.register(JwtService, jwt);

// Sign a token (default 7 days)
const token = jwt.sign({ userId: '123', roles: ['admin'] }, '7d');

// Verify — throws if invalid or expired
const payload = jwt.verify(token) as { userId: string; roles: string[] };
```

Auth middleware:

```typescript
import { authMiddleware, requireRoles } from 'streetjs';

// Require valid JWT on all routes
app.use(authMiddleware);

// Require specific role
app.use(requireRoles('admin'));
```

Or per-controller:

```typescript
import { UnauthorizedException, container, JwtService } from 'streetjs';
import type { StreetContext } from 'streetjs';

async function authenticate(ctx: StreetContext, next: () => Promise<void>) {
  const auth = ctx.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) throw new UnauthorizedException();
  const jwt = container.resolve(JwtService);
  const payload = jwt.verify(auth.slice(7));
  ctx.user = payload as StreetContext['user'];
  await next();
}
```

---

## Sessions (AES-256-GCM)

```typescript
import { SessionManager, container } from 'streetjs';

const sessions = new SessionManager(process.env['SESSION_KEY']!);
container.register(SessionManager, sessions);

// Encrypt session data
const blob = sessions.encrypt({ userId: '123', roles: ['user'] });

// Set as cookie
ctx.setCookie('session', blob, {
  httpOnly: true,
  secure:   true,
  sameSite: 'Lax',
  maxAge:   86400,
});

// Decrypt on subsequent requests
const session = sessions.decrypt(ctx.cookie('session') ?? '');
```

Generate a session key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Rate limiting

Sliding-window rate limiter with BigInt nanosecond precision:

```typescript
import { RateLimiter } from 'streetjs';

const limiter = new RateLimiter({
  windowMs:    60_000,   // 1-minute window
  maxRequests: 100,      // max 100 requests per IP per window
});

app.use(limiter.middleware());

// Clean up on shutdown
process.once('SIGTERM', () => limiter.destroy());
```

The limiter tracks up to 100K IPs and 1K timestamps per IP. Stale entries are swept periodically to prevent unbounded growth.

---

## XSS sanitization

```typescript
import { xssMiddleware, sanitizeDeep, sanitizeString } from 'streetjs';

// Global middleware — sanitizes all request bodies
app.use(xssMiddleware);

// Manual sanitization
const clean = sanitizeString('<script>alert(1)</script>Hello');
// → 'Hello'

const cleanObj = sanitizeDeep({
  name: '<b>Alice</b>',
  bio:  'Hello <script>evil()</script> world',
});
// → { name: 'Alice', bio: 'Hello  world' }
```

---

## Security headers

```typescript
import { securityHeaders } from 'streetjs';

app.use(securityHeaders);
```

Sets:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `X-XSS-Protection: 1; mode=block`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`

---

## CORS

```typescript
import { corsMiddleware } from 'streetjs';

// Allow specific origins
app.use(corsMiddleware(['https://app.example.com', 'https://admin.example.com']));

// Allow all origins (development only)
app.use(corsMiddleware(['*']));
```

---

## Vault mode (KEK-based secret decryption)

For encrypting secrets at rest (e.g. database passwords in config files):

```typescript
import { encryptSecret, decryptSecret, loadConfig } from 'streetjs';

// Encrypt a secret with a Key Encryption Key
const encrypted = await encryptSecret('my-db-password', process.env['KEK']!);
// → 'enc:v1:...' (store this in your config file)

// Decrypt at runtime
const dbPassword = await decryptSecret(encrypted, process.env['KEK']!);

// Or load an entire config object, decrypting all 'enc:v1:...' values
const config = await loadConfig({
  pgPassword: 'enc:v1:...',
  jwtSecret:  'enc:v1:...',
}, process.env['KEK']!);
```

Generate a KEK:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Security checklist

Before going to production:

- [ ] `JWT_SECRET` is at least 32 random characters — never a dictionary word
- [ ] `SESSION_KEY` is a 64-character hex string (32 random bytes)
- [ ] `KEK` is set if using vault mode
- [ ] `NODE_ENV=production` is set
- [ ] HTTPS is terminated at the load balancer or reverse proxy
- [ ] `corsMiddleware` lists only your actual frontend origins — not `['*']`
- [ ] Rate limiter is configured for your expected traffic
- [ ] `securityHeaders` middleware is applied globally
- [ ] `xssMiddleware` is applied globally
- [ ] Database password is not in source code
- [ ] `.env` is in `.gitignore`
