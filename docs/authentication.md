---
layout:      default
title:       "Authentication"
permalink:   /authentication/
nav_exclude: true
description:  "Authentication in StreetJS — JWT access tokens, server-side sessions, API keys, OAuth2/OIDC with PKCE, WebAuthn passkeys, and role-based access control. No external auth service required."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Capability</span>
<h1>Authentication</h1>
<p>A complete, production-grade authentication stack built into the framework — JWT access tokens, server-side sessions, API keys, OAuth2/OIDC with PKCE, WebAuthn passkeys, refresh tokens, and role-based access control. No third-party auth service required.</p>
</div>

<style>
.cap-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin:24px 0}
.cap-card{display:flex;flex-direction:column;gap:8px;border:1px solid var(--border);background:var(--elevated);border-radius:14px;padding:20px}
.cap-card h3{margin:0;font-size:16px}
.cap-card p{margin:0;color:var(--text-secondary);font-size:14px;line-height:1.6}
.cap-card a{font-weight:600;font-size:14px;margin-top:auto}
.cap-note{border:1px solid var(--border);background:var(--elevated);border-radius:12px;padding:16px 18px;color:var(--text-secondary);margin:22px 0}
</style>

StreetJS treats authentication as a first-class concern rather than a plugin you bolt on later. Every layer of a modern auth stack ships in the box and is covered by tests.

## What's included

<div class="cap-grid">

<div class="cap-card">
<h3>JWT &amp; sessions</h3>
<p>Signed JWT access tokens plus server-side sessions and refresh tokens, with secure cookie handling out of the box.</p>
<a href="{{ '/auth/' | relative_url }}">Auth guide →</a>
</div>

<div class="cap-card">
<h3>OAuth2 / OIDC</h3>
<p>Authorization Code flow with PKCE for social and enterprise identity providers.</p>
<a href="{{ '/auth/oauth2/' | relative_url }}">OAuth2 docs →</a>
</div>

<div class="cap-card">
<h3>WebAuthn passkeys</h3>
<p>Passwordless, phishing-resistant authentication using platform and roaming authenticators.</p>
<a href="{{ '/auth/webauthn/' | relative_url }}">WebAuthn docs →</a>
</div>

<div class="cap-card">
<h3>Role-based access control</h3>
<p>Roles, permissions, and route guards for authorizing requests once a user is authenticated.</p>
<a href="{{ '/auth/rbac/' | relative_url }}">RBAC docs →</a>
</div>

</div>

## Hosted identity providers

Prefer a managed identity service? First-party plugins integrate StreetJS auth with external providers:

- [Auth0](https://www.npmjs.com/package/@streetjs/plugin-auth0)
- [Clerk](https://www.npmjs.com/package/@streetjs/plugin-clerk)
- [Firebase](https://www.npmjs.com/package/@streetjs/plugin-firebase)
- [Supabase](https://www.npmjs.com/package/@streetjs/plugin-supabase)

See the full list on the [Plugins]({{ '/plugins/' | relative_url }}) page.

<div class="cap-note">
Authentication and authorization are part of the broader <a href="{{ '/security/' | relative_url }}">Security &amp; Trust Center</a>, which also covers the encrypted vault, rate limiting, CORS, CSRF, XSS sanitization, and security headers.
</div>

## Next steps

- Read the [Authentication guide]({{ '/auth/' | relative_url }})
- Review the [Security model]({{ '/security/' | relative_url }})
- Start a project with the [Getting Started guide]({{ '/getting-started/' | relative_url }})
