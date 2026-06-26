# StreetJS Threat Model — 2026 (Adversarial)

> Companion to `SECURITY-AUDIT-2026.md`. Defines assets, trust boundaries, attacker models, and the mitigations/residual-risks reflecting the 2026 adversarial pass. Every control referenced is verified in source; finding IDs (PS-/AUTH-/PAY-/HTMX-/CI-/GEN-) cross-reference the audit.

## 1. Assets

| Asset | Why it matters |
|---|---|
| Signing & app secrets | Plugin signing key (`STREET_PLUGIN_SIGNING_KEY`), `JWT_SECRET`, `SESSION_KEY`, `KEK`, DB creds, payment API keys / webhook secrets |
| `NPM_TOKEN` & publish identity | Controls what ships to every downstream consumer |
| User & tenant data | Per-org rows (multi-tenant isolation), PII, audit logs |
| Money movement & billing state | Subscriptions, billing records, settlements |
| Code & release integrity | Published npm packages (provenance), signed plugin manifests, marketplace tarballs |
| Availability | HTTP/WS servers, demo fleet |

## 2. Trust boundaries (2026)

```
 Internet ─┬─ HTTP edge        TLS · securityHeaders · CORS · CSRF(synchronizer) · RateLimiter · @Validate/Zod      [STRONG]
           ├─ WebSocket upgrade  authFn + allowedOrigins gate (Q1 fix); channel authz still caller-asserted (F-R5)  [IMPROVED]
           ├─ Payment webhooks (UNAUTHENTICATED routes; trust = provider signature / re-verify)
           │     • Stripe : idempotent + atomic upsert (STRONG) BUT signature verify is a phantom control (PAY-1)
           │     • PayPal : NO inbound verification exists (PAY-2)
           │     • MarzPay: fail-closed today; no idempotency/tenant binding when enabled (PAY-3/PAY-4)
           ├─ Federated identity (OAuth/OIDC)  verifyIdToken FAIL-OPEN: sig/aud/iss not enforced (AUTH-1)           [WEAK]
           ├─ Plugin host (in-process)  signed=trusted, NOT a sandbox (documented); host opt-in verify (F-P1)
           └─ Marketplace install (PluginInstaller)  default-open verify (PS-2) + zip-slip extraction (PS-1)        [CRITICAL]
 Tenant boundary : orgScopedRepo(org_id) enforced in the data layer (property-tested). Webhook→org binding is
                   mapping/ctx-derived (PAY-4), not cryptographically event-bound.
 Supply chain    : npm provenance + cosign + SHA-pinned/zizmor-linted Actions + Ed25519 plugin signatures [STRONG];
                   single signing key, no rotation (PS-3); owner-add automation ungated (CI-1).
```

## 3. Attacker models & mitigations

### A. Unauthenticated network attacker
- **HTTP:** Mitigated — TLS, security headers, CORS allow-list, CSRF synchronizer token (constant-time), Zod validation, rate limiting, SSRF-safe outbound webhooks.
- **WebSocket:** Improved — `authFn` + `allowedOrigins` now gate the upgrade (Q1). Residual: caller-asserted `memberId` channel authz (F-R5), no per-IP upgrade rate limit (F-R3), inbound frames unvalidated (F-R4).
- **Federated login:** **Exposed** — `verifyIdToken` is fail-open (AUTH-1): an attacker who can influence the ID token or JWKS (hostile/compromised IdP, mis-set `jwksUri`) can pass an unsigned or wrong-audience/issuer token and impersonate a user.
- **Payment webhooks:** Stripe upsert is idempotent/atomic, but the **authenticity** layer is a phantom (PAY-1); PayPal has none (PAY-2); MarzPay is fail-closed today with latent idempotency/tenant gaps (PAY-3/PAY-4). A forged event is the primary risk once webhooks are wired.

### B. Authenticated tenant attacker (cross-tenant)
- **Mitigated** at the data layer by `orgScopedRepo(org_id)` (property-tested).
- **Residual:** webhook→tenant binding via `client_reference_id`/`metadata.org_id` is attacker-influenceable (PAY-4); realtime channels lack server-side authz (F-R5).

### C. Malicious/compromised dependency, plugin, or registry
- **Mitigated for official plugins:** Ed25519 manifest signatures over a complete canonical body, checksum recomputed at verify (no body-swap), CI re-verifies the packed manifest, npm provenance, 3-dependency core.
- **Exposed via the consumer installer:** `PluginInstaller` verifies signatures only when a `publicKey` is configured (PS-2) and extracts tarballs with a **zip-slip-vulnerable** parser (PS-1). A malicious/compromised/MITM'd registry → arbitrary file write → RCE in the default-open configuration. This is the highest-severity boundary in the 2026 model.

### D. Supply-chain / release attacker
- **Mitigated:** provenance + attestation-verification gate, cosign keyless signing, SHA-pinned + zizmor-linted Actions, protected `main`, no `pull_request_target`, no expression injection, least-privilege permissions.
- **Residual:** `transfer-npm-owner` can grant persistent npm co-ownership with no approval gate/allow-list (CI-1); publish triggers on push-to-`main` (CI-2); single plugin-signing key without rotation/revocation (PS-3).

### E. Token/secret theft (XSS/MITM) & session abuse
- **Mitigated:** AES-256-GCM tamper-evident sessions; secure-by-default cookies (Q1); JWT alg-confusion blocked; refresh-token replay-family revocation.
- **Residual:** stateless sessions have **no expiry and no revocation** (AUTH-3) → a leaked blob authenticates indefinitely; refresh JWT accepted as access token (AUTH-4); no `/login` rate limit (AUTH-6); MFA verify unthrottled + TOTP replay window (AUTH-2).

### F. Browser-side attacker against server-rendered HTML (HTMX)
- **Mitigated:** default `{{ }}` escaping, bounded partial recursion, CRLF blocked at the HTTP layer.
- **Residual:** context-insensitive escaping (unquoted-attr / `javascript:` sinks — HTMX-1), raw `{{{ }}}`/`fragment()` passthrough (HTMX-2), view-name traversal (HTMX-3), open redirect via `HX-Redirect`/`HX-Location` (HTMX-4), no automatic CSRF wiring for HTMX mutations (HTMX-5).

### G. Developer running `street create` & downstream app users
- **Mitigated:** project-name regex blocks traversal/injection; no real secrets emitted; prod fail-fast on wildcard CORS/missing secrets.
- **Residual:** generated config ships hardcoded fallback secrets (GEN-1) → forgeable sessions/JWTs if env unset; caret-ranged deps (GEN-2).

### H. Prompt-injection / tool abuse (AI)
- **Unverified** this pass (AI-1) — dedicated review required.

## 4. Changes since the previous threat model

- **Marketplace installer** elevated to the top boundary risk: default-open verification + zip-slip = unauthenticated-registry → RCE (PS-1/PS-2).
- **Federated identity** added as a WEAK boundary: the OIDC ID-token verifier is fail-open (AUTH-1).
- **Payments** reframed: idempotency/atomicity are strong, but **authenticity wiring** is the gap (Stripe phantom verify, PayPal none, MarzPay latent).
- **Sessions** sharpened: not just "no revocation" but "no expiry" → indefinite replay (AUTH-3).
- **HTMX** added as a rendering boundary with escaping-context and CSRF-wiring residuals.
- **Pipeline** confirmed strong; residuals are owner-add automation (CI-1) and push-to-main publish (CI-2).

## 5. Non-goals / accepted risks (documented)

- The plugin host does not isolate untrusted third-party code (by design); only signed, trusted plugins are supported. True isolation (`worker_threads`/`vm`) remains a roadmap initiative.
- Stateless sessions trade server-side revocation for zero storage; revocation/expiry is the AUTH-3 remediation.
- MarzPay settlement remains fail-closed until the vendor publishes a signature scheme; the re-verify path is the documented trust anchor.
- Performance/availability numbers remain MEASURED-only.

## 6. Priority remediation order (risk-reduction ÷ effort)

1. **PS-1 (CRITICAL)** zip-slip containment — Low effort, removes an RCE primitive.
2. **PS-2 (HIGH)** mandatory installer signature + manifest schema — Low.
3. **AUTH-1 (HIGH)** fail-closed OIDC verification (alg allow-list, aud-contains, iss exact) — Medium.
4. **AUTH-2 (HIGH)** MFA throttling + TOTP step-reuse guard — Medium.
5. **AUTH-3 (HIGH)** session `exp` + optional revocation/key-epoch — Medium.
6. **PAY-1/PAY-2 (HIGH)** real Stripe `verify` + raw-body wiring; PayPal webhook verification — Medium.
7. **PAY-3 (HIGH)** MarzPay idempotency store + tenant derivation — Medium.
8. **GEN-1, AUTH-4/5/6/7, PAY-4, PS-3/PS-4, CI-1/CI-2 (MEDIUM)** — mostly Low–Medium.
9. **LOW tier** (AUTH-8…11, HTMX-6, PAY-5, GEN-2/3, CI-3…5) — hardening.


---

## Addendum (Phase 12) — Supply-chain & ecosystem threats

| Threat | Vector | Mitigation (in place) | Residual / action |
|---|---|---|---|
| **Dependency confusion** | Internal name resolves to public malicious pkg | Scoped `@streetjs/*` names; dependency-free plugin design; `dependency-review.yml` | Reserve scopes; keep deps minimal |
| **Typosquatting (consumed)** | Look-alike dep names | Minimal deps; Dependency Review; lockfile pinning | Commit `web/` lockfiles |
| **Typosquatting (of us)** | Fake `@streetjs/*` look-alikes | Official scope + signed manifests verified against anchor | Publish trust docs (Trust Center) |
| **Plugin compromise** | Malicious/hijacked plugin | Ed25519 signing + CI verify against `officialPluginPublicKey()`; `no-plugin-dockerfiles`; code-safety (0 eval/exec) | Keyless signing (P2) |
| **Webhook forgery** | Spoofed provider callback | Constant-time HMAC + fail-closed; server-side re-verify (marzpay) | Verifiers for stripe/twilio/paypal/sendgrid (P1) |
| **CI compromise** | Malicious workflow / token abuse | Least-privilege `permissions:`, SHA-pinned actions, no `pull_request_target`, zizmor, `secrets-guard` rule #1 | Branch protection (P0) |
| **Credential leakage** | Secret committed | gitleaks + trufflehog + `secrets-guard` + RESTRICTED `.gitignore` + push protection | Enable push protection (P0); purge history (P0) |
| **Malicious pull requests** | Hostile contributor PR | CODEOWNERS review, required checks, no fork secret exposure | Branch protection + CODEOWNERS teams |
| **Registry attacks / package hijacking** | npm account/token compromise | npm provenance, automation token in CI only, 2FA-bypassing token scoped | npm org 2FA + publish-from-CI-only enforcement |
| **Release-pipeline compromise** | Tampered build/sign step | Version-lockstep gate, signed manifests verified, provenance, cosign | SLSA L3 (keyless + isolation) |
| **Social engineering** | Maintainer impersonation | Private disclosure channel, advisory process | Grow MAINTAINERS; security-team verification |
| **Insider threats** | Trusted-actor abuse | CODEOWNERS, audit logs, signed commits (recommended), dual-control releases | Enforce signed commits + dual-control (P2) |

Cross-reference: `audits/OPENSSF-REVIEW.md`, `security/SLSA-ASSESSMENT.md`,
`security/SECURITY-ROADMAP.md`.
