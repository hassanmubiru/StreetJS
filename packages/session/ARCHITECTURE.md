# @streetjs/session — Architecture

## Goals

- A single, generic stateless-session primitive for StreetJS and any application.
- Zero runtime dependencies (Node core `crypto` only).
- Authenticated encryption by default; fail closed on any tampering.
- Strongly typed; strict TypeScript; no circular dependencies.

## Module layout

```
src/
  session.ts   SessionManager (AES-256-GCM encrypt/decrypt + CSRF/id helpers).
  index.ts     Curated public API + SESSION_MANAGER DI token.
```

## Extraction & single source of truth

This package is the standalone home of the session manager that previously lived inside
`streetjs` core. Core now depends on `@streetjs/session` and its `src/security/session.ts`
re-exports from it, so the `streetjs/session` subpath and all internal imports keep
working against one implementation (dependency inversion, not duplication or a shim).

## Cryptography

- **Algorithm:** AES-256-GCM (authenticated encryption with associated data). A fresh
  96-bit IV is generated per `encrypt`; the 128-bit auth tag is stored alongside the
  ciphertext.
- **Token layout:** `base64( iv[12] | tag[16] | ciphertext[N] )`.
- **Decryption** verifies the tag before returning; any tampering (or a wrong key, or a
  truncated/malformed blob) throws internally and is surfaced as `null` — callers never
  see a partial or unauthenticated result.
- **Key validation:** the key must be a 64-char hex string (32 bytes). Keys with fewer
  than 8 distinct byte values are rejected to catch obviously-insecure defaults (e.g.
  all zeros); this is a guard against misconfiguration, not a substitute for a properly
  random key.
- **Randomness:** IVs, CSRF tokens, and session ids all come from `crypto.randomBytes`.

## Design boundaries (honest)

- Stateless only — there is no server-side session store, revocation list, or sliding
  expiry. Expiry/rotation are the caller's concern (embed an `exp` field and check it,
  or rotate the key). This keeps the primitive small and horizontally scalable.
- Transport concerns (cookie flags, headers) are out of scope; this package is the token
  crypto, usable from any HTTP layer.
- No key rotation ceremony is built in; rotating the key invalidates existing tokens by
  design (they fail to decrypt).

## Testing

`node --test`: key-length and low-entropy rejection, the entropy boundary, encrypt→decrypt
round-trip (including extra fields), non-deterministic IVs, tamper rejection, wrong-key
rejection, malformed/short-blob handling, and the CSRF/session-id generators. Coverage is
enforced at ≥90% (`c8`); the declaration-only types are excluded.
