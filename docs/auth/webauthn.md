---
title: WebAuthn / Passkeys
parent: Authentication
nav_order: 3
---

# WebAuthn / Passkeys Guide

Street's `WebAuthnService` implements the [WebAuthn Level 2](https://www.w3.org/TR/webauthn-2/) specification, enabling phishing-resistant passkey authentication. Users authenticate with a biometric sensor, hardware key, or device PIN — no password required.

## Security Properties

| Property | How Street Enforces It |
|----------|----------------------|
| **Phishing-resistant** | `origin` is bound to the credential at registration; a different origin is rejected during authentication |
| **Replay protection** | Each challenge is single-use and stored with an `expiresAt` timestamp |
| **No credential leakage** | Public keys are stored as JWK JSON; private keys never leave the authenticator |
| **Signature verification** | Every authentication assertion verifies the ECDSA-P256 signature over `authData + SHA-256(clientDataJSON)` |

---

## How the Flow Works

### Registration (Passkey Creation)

1. Server generates a random challenge and stores it with the user's ID.
2. Browser calls `navigator.credentials.create()` with the challenge.
3. Authenticator creates a P-256 key pair; returns an `AttestationObject` containing the public key in COSE format.
4. Server calls `finishRegistration()`, which:
   - Verifies the `clientDataJSON` type is `webauthn.create` and the origin matches.
   - Verifies the challenge matches the stored one.
   - Parses the COSE EC2 public key from `authData` and stores it as JWK JSON.

### Authentication (Passkey Assertion)

1. Server generates a fresh challenge and stores it.
2. Browser calls `navigator.credentials.get()`.
3. Authenticator signs `authData + SHA-256(clientDataJSON)` with the registered private key.
4. Server calls `finishAuthentication()`, which:
   - Verifies challenge is present and not expired.
   - Loads the stored JWK public key.
   - Verifies the ECDSA-P256 signature.
   - Updates the stored `signCount` (replay detection).

---

## Setup

### 1. Run the migration

```typescript
import { WEBAUTHN_MIGRATION_SQL } from '@streetjs/core';

await pool.query(WEBAUTHN_MIGRATION_SQL);
```

### 2. Implement a session store

`WebAuthnService` requires a `WebAuthnSession` — any object with `getChallenge`, `setChallenge`, and `clearChallenge`. You can use `SessionManager` or a custom store:

```typescript
import { SessionManager } from '@streetjs/core';

const sessions = new SessionManager({ secret: process.env.SESSION_KEY! });

// Adapter to WebAuthnSession interface:
const webAuthnSession = {
  async getChallenge(userId: string) {
    const data = await sessions.getRaw(userId);
    return data ?? null;
  },
  async setChallenge(userId: string, challenge: string, expiresAt: number) {
    await sessions.setRaw(userId, { challenge, expiresAt });
  },
  async clearChallenge(userId: string) {
    await sessions.destroyRaw(userId);
  },
};
```

### 3. Create the service

```typescript
import { WebAuthnService } from '@streetjs/core';

const webAuthn = new WebAuthnService(
  {
    rpName: 'My App',
    rpId: 'myapp.com',          // Must match the domain used in the browser
    origin: 'https://myapp.com', // Must match exactly
  },
  pool,
  webAuthnSession,
);
```

---

## Registration Endpoints

```typescript
// GET /auth/passkey/register/options
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/auth/passkey/register/options') {
    const userId = ctx.user!.id;
    const options = await webAuthn.startRegistration(userId);
    ctx.json(options);
    return;
  }
  await next();
});

// POST /auth/passkey/register/finish
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/auth/passkey/register/finish') {
    const userId = ctx.user!.id;
    const result = await webAuthn.finishRegistration(userId, ctx.body);
    ctx.json({ credentialId: result.credentialId }, 201);
    return;
  }
  await next();
});
```

---

## Authentication Endpoints

```typescript
// GET /auth/passkey/login/options
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path === '/auth/passkey/login/options') {
    const { userId } = ctx.query as { userId: string };
    const options = await webAuthn.startAuthentication(userId);
    ctx.json(options);
    return;
  }
  await next();
});

// POST /auth/passkey/login/finish
app.use(async (ctx, next) => {
  if (ctx.method === 'POST' && ctx.path === '/auth/passkey/login/finish') {
    const { userId } = ctx.query as { userId: string };
    const result = await webAuthn.finishAuthentication(userId, ctx.body);
    if (result.verified) {
      // Issue JWT or create server session
      const token = jwt.sign({ sub: userId });
      ctx.json({ token });
    } else {
      ctx.json({ error: 'Authentication failed' }, 401);
    }
    return;
  }
  await next();
});
```

---

## COSE Key Storage

Street stores public keys as **JWK JSON strings** in the database. During registration, `parseCredentialPublicKey()` reads the COSE EC2 key from `authData` and converts it:

```
COSE map: { kty=2, alg=-7, crv=1, x=<32 bytes>, y=<32 bytes> }
  →  JWK JSON: { "kty":"EC","crv":"P-256","x":"<base64url>","y":"<base64url>" }
```

This means public keys can be inspected and exported without a custom CBOR decoder.

---

## Client-Side Integration

On the browser side, use the [SimpleWebAuthn](https://simplewebauthn.dev/) library which handles the low-level `navigator.credentials.*` calls and serialization to/from base64url.
