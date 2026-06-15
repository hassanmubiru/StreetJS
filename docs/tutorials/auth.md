---
layout:    default
title:     "Authentication & Authorization"
parent:    "Tutorials"
nav_order: 4
permalink: /tutorials/auth/
description: "Add authentication and authorization to StreetJS — JWT issuance and verification, role-based access control (RBAC), and TOTP multi-factor auth (MFA)."
---

# Authentication & Authorization

**Level:** Beginner–Intermediate · **Time:** ~25 minutes · **Prerequisites:** [Your First API](/tutorials/first-api/)

This tutorial covers issuing and verifying JWTs, protecting routes, enforcing
roles (RBAC), and adding TOTP multi-factor authentication — all with built-in
StreetJS services.

---

## 1. Issue and verify JWTs

`JwtService` signs and verifies tokens. Register it once with your secret:

```typescript
// src/main.ts
import { JwtService, container } from 'streetjs';

const jwt = new JwtService(process.env['JWT_SECRET'] ?? 'dev-secret');
container.register(JwtService, jwt);
```

A login handler signs a token carrying the user id, email, and roles:

```typescript
import { Controller, Post, Injectable, JwtService } from 'streetjs';
import type { StreetContext } from 'streetjs';

@Injectable()
@Controller('/auth')
export class AuthController {
  constructor(private readonly jwt: JwtService) {}

  @Post('/login')
  async login(ctx: StreetContext): Promise<void> {
    const { email, password } = ctx.body as { email: string; password: string };

    // 1. Verify credentials against your user store (hash compare) …
    const user = await this.findAndVerify(email, password);

    // 2. Sign a token. expiresInSeconds is enforced on verify().
    const token = this.jwt.sign(
      { sub: user.id, email: user.email, roles: user.roles },
      { expiresInSeconds: 3600 },
    );
    ctx.json({ token });
  }
}
```

Verify on the way in with middleware that populates `ctx.user`:

```typescript
// src/middleware/auth.ts
import { container, JwtService, UnauthorizedException } from 'streetjs';
import type { StreetContext } from 'streetjs';

export async function authenticate(ctx: StreetContext, next: () => Promise<void>): Promise<void> {
  const header = ctx.headers['authorization'];
  if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');

  try {
    ctx.user = container.resolve(JwtService).verify(header.slice(7));
    await next();
  } catch {
    throw new UnauthorizedException('Invalid or expired token');
  }
}
```

`verify()` throws on a bad signature **or** an expired token, so an expired JWT
is rejected automatically.

---

## 2. Role-based access control (RBAC)

Compose a `requireRole` guard that runs after `authenticate`:

```typescript
export function requireRole(...roles: string[]) {
  return async (ctx: StreetContext, next: () => Promise<void>): Promise<void> => {
    const user = ctx.user;
    if (!user?.roles || !roles.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException('Insufficient permissions');
    }
    await next();
  };
}
```

Apply guards per controller or per route:

```typescript
@Controller('/admin', { middleware: [authenticate, requireRole('admin')] })
export class AdminController {
  @Get('/metrics')
  async metrics(ctx: StreetContext): Promise<void> {
    ctx.json({ ok: true }); // only reachable by authenticated admins
  }
}
```

> Need richer policies (per-tenant roles, audited permission grants)? The
> enterprise RBAC + audit logging building blocks back the
> [`@streetjs/admin-ui`](https://www.npmjs.com/package/@streetjs/admin-ui)
> `RoleManager` and `AuditLogViewer` components — see [Enterprise](/enterprise/).

---

## 3. Multi-factor authentication (TOTP)

`MfaService` implements RFC 6238 TOTP with recovery codes, backed by a table it
defines. Apply its migration once:

```typescript
import { MfaService, MFA_MIGRATION_SQL, container, PgPool } from 'streetjs';

await container.resolve(PgPool).query(MFA_MIGRATION_SQL); // creates street_mfa
const mfa = new MfaService(container.resolve(PgPool), { issuer: 'MyApp' });
container.register(MfaService, mfa);
```

Enrollment is a two-step flow — begin (returns an `otpauth://` URL for the
authenticator app + recovery codes), then confirm with the first code:

```typescript
@Post('/mfa/setup')
async beginMfa(ctx: StreetContext): Promise<void> {
  const { otpauthUrl, secret, recoveryCodes } =
    await this.mfa.beginEnrollment(ctx.user!.sub, ctx.user!.email);
  ctx.json({ otpauthUrl, secret, recoveryCodes }); // render the URL as a QR code
}

@Post('/mfa/verify')
async confirmMfa(ctx: StreetContext): Promise<void> {
  const { code } = ctx.body as { code: string };
  const ok = await this.mfa.confirmEnrollment(ctx.user!.sub, code);
  ctx.json({ enabled: ok }, ok ? 200 : 400);
}
```

Enforce MFA on sensitive routes with the `mfaGuard` middleware; verify codes at
sign-in with `mfa.verify(userId, code)`. Recovery codes are single-use.

The [`@streetjs/auth-ui`](https://www.npmjs.com/package/@streetjs/auth-ui)
`MFASetup` and `LoginForm` components implement this flow on the frontend — see
[Full-Stack with React](/tutorials/fullstack-react/).

---

## 4. Sessions (cookie-based)

For server-rendered or cookie-first apps, `SessionManager` issues encrypted
session cookies as an alternative to bearer tokens:

```typescript
import { SessionManager, container } from 'streetjs';
container.register(SessionManager, new SessionManager(process.env['SESSION_KEY']!));
// Set an httpOnly, Secure, SameSite cookie after login via ctx.setCookie(...)
```

See [MFA](/mfa/) and [Security](/security/) for hardening (rotation, CSRF,
cookie flags).

---

## Best practices

- Store only password **hashes** (the platform provides hashing utilities).
- Keep access tokens short-lived; use refresh tokens for long sessions.
- Set cookies `httpOnly`, `Secure`, `SameSite=Lax|Strict`.
- Return generic auth errors — never reveal whether the email or the password was wrong.

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| Valid token rejected | Server clock skew, or the secret differs between signer and verifier. |
| `ctx.user` is undefined in a guard | `authenticate` did not run before `requireRole` — check middleware order. |
| MFA confirm always fails | Authenticator clock drift, or you passed the secret instead of the 6-digit code. |
