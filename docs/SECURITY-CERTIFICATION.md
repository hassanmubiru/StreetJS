# Security Certification

Run: `node --test packages/core/dist/tests/certification/security-certification.test.js`

This suite exercises the real security controls (no mocks) and is wired into
`street certify` and CI.

## Coverage

| Area | Controls verified |
| --- | --- |
| Authentication | JWT sign/verify, tampered-token rejection, **alg:none / algorithm-confusion rejection**, expiry enforcement |
| Cryptography | AES-256-GCM round-trip with **random IV per encryption**, auth-tag tamper rejection, wrong-key failure (no silent fallback), `FieldEncryptor` authenticated encryption |
| Constant-time | `constantTimeEqual` / `timingSafeEqual` used for secrets, tokens, signatures |
| Authorization | RBAC hierarchy flattening, inherited-permission resolution, deny-by-default |
| Transport | Webhook HMAC-SHA256 sign/verify, tamper + wrong-secret rejection; dispatcher enforces **HTTPS-only** + SSRF blocklist + DNS-rebind protection |
| Input | XSS sanitisation (`sanitizeString`/`sanitizeDeep`/`escapeHtml`) |

## Additional evidence

- Source audit: zero `Math.random` in auth/security paths; zero empty `catch {}`
  blocks; `rejectUnauthorized` defaults to `true` (opt-in `false` only).
- JWT enforces exact `alg:HS256` / `typ:JWT` header.
- Vault uses `scrypt` (raised work factor) with a random per-secret salt.
- System security suite (`dist/tests/system/security.test.js`): 74/74 pass.

## Result

Zero Critical findings. Zero High findings. All assertions pass.
