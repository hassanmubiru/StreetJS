# @streetjs/security — Architecture

## Goals

- A single, generic JWT primitive for StreetJS and any application.
- Zero runtime dependencies (Node core `crypto` only).
- Secure by default: HS256-only, timing-safe, fail-closed.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  jwt.ts     JwtService (HS256 sign/verify/decode + base64url helpers).
  index.ts   Curated public API + JWT_SERVICE DI token.
```

## Extraction & single source of truth

This package is the standalone home of the JWT service previously embedded in `streetjs`
core. Core now depends on `@streetjs/security` and its `src/security/jwt.ts` re-exports
from it, so the `streetjs/security` subpath and all internal imports resolve to one
implementation (dependency inversion — not duplication, not a shim).

## Token format & verification pipeline

Compact JWS: `base64url(header) . base64url(payload) . base64url(HMAC-SHA256)`, header
fixed to `{ alg: HS256, typ: JWT }`.

`verify` runs, in order, returning `null` at the first failure (never throwing):

1. Three segments present.
2. Header parses and declares exactly `HS256`/`JWT` (algorithm-confusion guard).
3. Recompute the HMAC over `header.payload`; compare **timing-safely** (length check
   first, then `timingSafeEqual`).
4. Payload parses as JSON.
5. Claims: `exp` not past; `nbf` not future; `iat` not more than 60s in the future
   (clock-skew guard); `iss`/`aud` match when the caller supplies them.

`decode` parses the payload only, with no signature or claim checks — for inspection.

## Design boundaries (honest)

- **HS256 only.** Asymmetric algorithms (RS/ES) are intentionally out of scope for this
  minimal primitive; adding them would change the key model and API surface.
- **No key rotation / JWKS.** Multiple keys or `kid`-based selection are the caller's
  concern (verify against each candidate key).
- **No refresh-token machinery.** This is the token codec; session/refresh flows compose
  on top (e.g. with `@streetjs/session`).

## Testing

`node --test`: short-secret rejection, sign→verify round-trip and `iat` stamping, segment
shape, tamper rejection, wrong-secret rejection, expiry, future `nbf`, algorithm confusion
(`alg:none`), `iss`/`aud` enforcement, malformed tokens, wrong-length signature, a
correctly-signed but non-JSON payload, and `decode` (including its non-JSON path).
Coverage is enforced at ≥90% (`c8`); the declaration-only types are excluded.
