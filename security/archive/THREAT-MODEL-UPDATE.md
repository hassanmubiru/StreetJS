# StreetJS Threat Model — 2026 Update

> Updates `docs/THREAT-MODEL.md` with the trust boundaries, attacker models, and
> mitigations reflecting the 2026 security audit (`SECURITY-AUDIT-2026.md`). Every
> control referenced is verified in source. Findings IDs (F-*) cross-reference the audit.

## 1. Assets

- **Credentials & secrets:** JWT signing key, `SESSION_KEY`, `KEK`, DB creds, plugin
  signing key, payment API keys / webhook secrets.
- **User & tenant data:** per-org rows (multi-tenant isolation), PII, audit logs.
- **Money movement & billing state:** subscriptions / billing records.
- **Code & release integrity:** published npm packages, signed plugin manifests.
- **Availability:** HTTP/WS servers, the demo fleet.

## 2. Trust boundaries

```
 Internet ─┬─ HTTP edge (TLS, securityHeaders, CORS, CSRF, RateLimiter, @Validate/Zod)
           ├─ WebSocket upgrade  ⚠ boundary weak by default (F-R1 authFn optional, F-R2 no Origin)
           ├─ Payment webhooks (UNAUTHENTICATED route; trust = provider signature / re-verify)
           │     • Stripe: signature + 300s tolerance + idempotency (strong)
           │     • MarzPay: fail-closed; server-side re-verify; ⚠ no idempotency (F-PAY1)
           └─ Plugin host (in-process)  ⚠ NOT a sandbox (F-P2); signature optional (F-P1)
 Tenant boundary: orgScopedRepo(org_id) — enforced in data layer; webhook→org binding is
                  mapping/ctx-derived (⚠ F-PAY5), not cryptographically event-bound.
 Supply chain boundary: provenance + cosign + Ed25519 plugin signatures (strong);
                  single signing key (⚠ F-SC1).
```

## 3. Attacker models & mitigations

### A. Unauthenticated network attacker
- **HTTP:** mitigated — TLS, security headers, CORS allowlist, CSRF synchronizer token (constant-time), Zod validation, rate limiting, SSRF-safe outbound webhooks (HTTPS-only + IP blocklist + DNS-rebinding re-check).
- **WebSocket:** **partially exposed** — if the app omits `authFn` (F-R1) or relies on cookies without an Origin check (F-R2), the attacker can connect cross-site (CSWSH) and, once connected, join arbitrary channels as any `memberId` (F-R5). Connection floods are bounded only globally (F-R3).
- **Payment webhooks:** Stripe path is robust (signature + replay window + idempotency). MarzPay path is fail-closed today; the design lacks idempotency/replay (F-PAY1/F-PAY2) for when settlement is enabled.

### B. Authenticated tenant attacker (cross-tenant)
- **Mitigated** at the data layer by `orgScopedRepo(org_id)` (proven by the SaaS/CRM tenant-isolation property tests). **Residual:** webhook→tenant binding is mapping/ctx-derived (F-PAY5) — a misconfigured webhook route could cross tenants; realtime channels lack server-side authz (F-R5).

### C. Malicious/compromised dependency or plugin
- **Mitigated** for official plugins: Ed25519 signatures + npm provenance + dependency review + secret scanning + 3-dep core.
- **Residual:** the in-process plugin host is **not a sandbox** (F-P2) and signature verification is **opt-in** (F-P1) — a host without the official key, or treating untrusted plugins as sandboxed, is exposed. TOCTOU on the manifest reference (F-P4).

### D. Supply-chain / release attacker
- **Mitigated:** provenance, cosign keyless release signing, SHA-pinned + zizmor-linted Actions, protected `main`, SBOM.
- **Residual:** single plugin-signing key without rotation/HSM (F-SC1); bus factor 1 for response (F-CI1).

### E. Token/secret theft (XSS/MITM)
- **Mitigated:** AES-256-GCM tamper-evident sessions, HttpOnly/Secure/SameSite *available*.
- **Residual:** cookie flags are opt-in (F-A1) → XSS/MITM exposure if omitted; no server-side session revocation (F-A3).

### F. Prompt-injection / tool abuse (AI)
- **Unverified** in this pass (F-AI1) — RAG + tool-calling exist; guardrails need a dedicated review.

## 4. Changes since the previous threat model

- **Realtime** elevated from "auth on upgrade" to a tracked boundary weakness (auth + origin are not default-on).
- **Plugin host** reframed: it is an **integrity + permission-declaration** layer, **not** a runtime sandbox — documented explicitly to avoid a false sense of isolation.
- **Payments** split by provider: Stripe = strong reference; MarzPay = fail-closed with an idempotency gap to close before enabling settlement.
- **Multi-tenant webhook binding** added as an explicit residual risk.
- **MFA** moved from "ready" to "implemented" (TOTP/HOTP + step-up).

## 5. Non-goals / accepted risks (documented)

- The plugin host does not isolate untrusted third-party code (by design today); only **signed, trusted** plugins are supported. True isolation is a roadmap initiative (`SECURITY-ROADMAP.md`).
- Stateless sessions trade server-side revocation for zero session storage; revocation is opt-in via a future store.
- Performance/availability numbers remain MEASURED-only.
