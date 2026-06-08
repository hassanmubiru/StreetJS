---
title: OAuth2 / OIDC
parent: Authentication
nav_order: 2
---

# OAuth2 + OIDC Guide

Street's `OAuthManager` implements the OAuth2 Authorization Code flow with **PKCE** (Proof Key for Code Exchange, RFC 7636). PKCE is mandatory for all Street OAuth flows — it prevents authorization code interception attacks without requiring a client secret to be embedded in the browser.

## How the PKCE Flow Works

1. **User clicks "Sign in with Google"** — your server generates a random `code_verifier`, computes `code_challenge = SHA-256(verifier)` (base64url encoded), stores the verifier in the session, and redirects the user to the provider's authorization URL with `code_challenge` and `state`.
2. **Provider authenticates the user** and redirects back to your `redirectUri` with `code` and `state`.
3. **Your server verifies `state`**, retrieves the `code_verifier` from the session, and exchanges `code` + `verifier` for tokens. No client secret is sent to the browser at any point.
4. **`OAuthManager.handleCallback()`** fetches the user's profile and calls your `onSuccess` callback.

---

## Setup

```typescript
import {
  OAuthManager, SessionManager,
  type OAuthProvider, type OAuthProfile,
} from '@streetjs/core';

const sessions = new SessionManager({ secret: process.env.SESSION_KEY! });

const oauth = new OAuthManager({
  sessionManager: sessions,   // REQUIRED — stores PKCE verifier and state
  providers: [
    {
      name: 'google',
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      redirectUri: 'https://your-app.com/auth/google/callback',
      scopes: ['openid', 'email', 'profile'],
    },
    {
      name: 'github',
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      redirectUri: 'https://your-app.com/auth/github/callback',
    },
    {
      name: 'microsoft',
      clientId: process.env.MICROSOFT_CLIENT_ID!,
      clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
      redirectUri: 'https://your-app.com/auth/microsoft/callback',
      authorizationUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
      tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    },
  ],
});
```

> **Note:** `sessionManager` is required. `OAuthManager` will throw at construction time if it is not provided.

---

## Initiating the Authorization Flow

Wire `GET /auth/:provider` to redirect users to the provider:

```typescript
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path.startsWith('/auth/') && !ctx.path.includes('/callback')) {
    const provider = ctx.path.split('/')[2];
    if (!provider) { await next(); return; }

    // generateAuthUrl sets state + code_verifier in the session cookie
    const { url } = await oauth.generateAuthUrl(provider, ctx);
    ctx.res.writeHead(302, { Location: url });
    ctx.res.end();
    return;
  }
  await next();
});
```

---

## Handling the Callback

```typescript
app.use(async (ctx, next) => {
  if (ctx.method === 'GET' && ctx.path.includes('/callback')) {
    const provider = ctx.path.split('/')[2];
    const query = ctx.query as Record<string, string>;
    const { code, state } = query;

    if (!code || !state || !provider) {
      ctx.json({ error: 'Missing OAuth2 parameters' }, 400);
      return;
    }

    try {
      const profile: OAuthProfile = await oauth.handleCallback(
        provider,
        code,
        state,
        (await sessions.get(ctx))?.['oauthState'] as string,
        (await sessions.get(ctx))?.['codeVerifier'] as string,
      );

      // profile: { id, email, name, picture, raw }
      // Find or create the user in your DB, then issue a JWT or session
      await sessions.set(ctx, { userId: profile.id, email: profile.email });
      ctx.res.writeHead(302, { Location: '/dashboard' });
      ctx.res.end();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'OAuth error';
      ctx.json({ error: message }, 400);
    }
    return;
  }
  await next();
});
```

---

## JWKS Cache

`OAuthManager` includes a `JwksCache` for validating OIDC `id_token` JWTs against the provider's public keys. The cache automatically refreshes keys when a `kid` (key ID) is not found, preventing unnecessary round-trips.

```typescript
import { JwksCache } from '@streetjs/core';

const jwksCache = new JwksCache('https://accounts.google.com/.well-known/openid-configuration');
const publicKey = await jwksCache.getKey(kid);
```

---

## Security Properties

- **PKCE** — Mandatory for all flows; prevents code interception.
- **State parameter** — Validated on every callback; prevents CSRF.
- **No secrets in browser** — The `clientSecret` is only used server-side in the token exchange.
- **Short-lived codes** — Authorization codes are single-use and expire after 60–600 seconds depending on the provider.

---

## Multiple Providers

`OAuthManager` supports any number of providers simultaneously. The `name` field in each provider config must match the URL segment used in your routes (e.g. `google` → `/auth/google` and `/auth/google/callback`).
