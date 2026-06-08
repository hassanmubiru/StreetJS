# Security Hardening Guide

Defense-in-depth controls shipped in the framework, plus operational guidance.

## Headers

- Always-on `securityHeaders` middleware sets CSP, HSTS (2y, preload),
  `X-Content-Type-Options`, `X-Frame-Options: DENY`, COOP, CORP, Referrer-Policy,
  and Permissions-Policy.
- Configurable preset: `securityHeadersMiddleware(opts)` + `buildCsp(directives)`
  / `computeSecurityHeaders(opts)` for per-app CSP/HSTS/frame tuning.
- CRLF/response-splitting is prevented by the Node HTTP layer (rejects invalid
  header characters) — verified in `tests/security-headers.test.ts`.

## Transport

- Webhooks: HTTPS-only, SSRF private-range blocklist, DNS-rebinding check, HMAC
  signatures, optional private-CA `tls` per target.
- DB: parameterized queries; MySQL `caching_sha2_password` refuses cleartext over
  non-TLS (use TLS or `mysql_native_password`).

## Cryptography

- AES-256-GCM with per-operation random IV + auth tag; scrypt KDF (raised work
  factor); `timingSafeEqual` for all secret comparisons; JWT `alg:none` blocked.

## Supply chain

- 2 production dependencies (`reflect-metadata`, `ws`); `npm audit` clean.
- SBOM: `node scripts/generate-sbom.mjs` emits CycloneDX 1.5 with a sha256 digest.
- CI publishes with **npm provenance** (`--provenance`) on tagged releases.
- Actions pinned to immutable commit SHAs; `zizmor` workflow security lint;
  `policy-checks` job scans for banned markers + runs `npm audit --audit-level=high`.

## Recommended operational hardening (deployment-side)

- Terminate TLS at/below the app; never set `rejectUnauthorized: false` in prod.
- Supply explicit CORS origins (never `['*']` for authenticated APIs).
- Rotate KEK/JWT/session secrets via `SecretRotationManager`.
- Run behind a WAF; enable a DAST stage (Schemathesis against the generated
  OpenAPI, OWASP ZAP baseline) in your delivery pipeline — see the roadmap.

## Status

Zero Critical / High findings. Header, transport, crypto, and supply-chain
controls verified by executable tests and `npm audit`.
