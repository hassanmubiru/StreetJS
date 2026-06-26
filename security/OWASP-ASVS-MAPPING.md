# StreetJS — OWASP ASVS v4 Mapping

> Maps StreetJS framework + plugin controls to OWASP Application Security
> Verification Standard chapters. Scope: framework-provided controls and official
> plugins (not end-user app code). ✅ provided · ◑ partial/opt-in · ⬜ app-responsibility.

| ASVS area | Status | Evidence |
|---|---|---|
| V1 Architecture | ✅ | Threat model (`security/THREAT-MODEL-2026.md`), classification, charter |
| V2 Authentication | ✅ | Core JWT/sessions/OAuth2-OIDC; identity plugins (auth0/clerk/firebase/supabase) |
| V3 Session management | ✅ | Core session keys (64-hex required), secure-by-default boot |
| V4 Access control | ✅ | RBAC `requireRoles`, multi-tenant `org_id` row scoping (SaaS starter) |
| V5 Validation/encoding | ✅ | Plugin input validators throw before I/O; htmx auto HTML-escaping; per-segment percent-encoding |
| V6 Cryptography | ✅ | Ed25519 manifest signing, HMAC webhook verify (`timingSafeEqual`), KEK; secret-provider abstraction |
| V7 Errors & logging | ✅ | No secret/PII logging (verified 0 secret logs in plugins); errors carry status only |
| V8 Data protection | ◑ | KEK + field encryption available; at-rest encryption is deploy-config |
| V9 Communications | ◑ | HTTPS-only outbound for HTTP plugins; DB/broker TLS is opt-in (gap noted) |
| V10 Malicious code | ✅ | No eval/Function/child_process/exec in plugins (verified); signed supply chain |
| V11 Business logic | ✅ | Idempotency + replay protection in payment overlay (marzpay) |
| V12 Files & resources | ✅ | Upload size caps, path-traversal guards (storage); SSRF note for configurable hosts |
| V13 API & web service | ◑ | Webhook verification fail-closed where provider supports; verifiers missing for stripe/twilio/paypal/sendgrid (gap) |
| V14 Configuration | ✅ | Secure defaults (refuses prod boot without `ALLOWED_ORIGINS`/secrets); secret management policy |

## Focus areas requested
- **Secrets:** config/env only, never logged, never runtime-mutable; CI secret-scanning + RESTRICTED gitignore.
- **Webhook security:** constant-time HMAC + equal-length guard, fail-closed; provider-less plugins require server-side re-verify.
- **Payments:** marzpay overlay — server re-verify before persist, atomic idempotency (`UNIQUE(reference)`), server-derived tenant binding.
- **Supply chain:** signed+verified manifests, provenance, SBOM, pinned deps.

## Gaps → actions
- V9: surface TLS options for redis/mongodb/nats/kafka/rabbitmq.
- V13: ship webhook verifiers for stripe/twilio/paypal/sendgrid.
- (Both are plugin runtime changes — tracked in `audits/PLUGIN-SECURITY-REPORT.md`, out of scope for governance pass.)
