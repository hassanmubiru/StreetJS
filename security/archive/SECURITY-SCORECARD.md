# StreetJS Security Scorecard — 2026 (Adversarial Pass)

> Point-in-time, evidence-based scoring derived from `SECURITY-AUDIT-2026.md` (adversarial pass), `PAYMENTS-SECURITY-REVIEW.md`, and `PLUGIN-SIGNING-REVIEW.md`. Scores are 0–100 per dimension with an equal-weight composite. "Current" reflects verified source state **after** the Q1 hardening (secure-by-default cookies, WS origin/auth gate, manifest schema + freeze, Stripe idempotency migration). "Target" is the posture after the remediation plan below. Scores are reasoned judgments grounded in findings, not a certification.

## Composite

| | Score | Band |
|---|------:|------|
| **Current composite** | **87 / 100** | Hardened framework; isolated high-severity gaps |
| **Target composite (post-remediation)** | **96 / 100** | Enterprise-ready, externally reviewable |

The Q1 quick wins moved several dimensions up materially. This adversarial pass then **discovered new high-severity issues** (marketplace zip-slip, fail-open OIDC verification, MFA brute-force, phantom Stripe verify) that hold the current composite at 87 despite the broad hardening. Closing the 8 HIGH/CRITICAL items (mostly Low–Medium effort) is what unlocks 95+.

## Dimensions

| Dimension | Current | Target | Rationale (current) | Gap to target |
|---|------:|------:|---|---|
| **Cryptography & primitives** | 93 | 96 | JWT alg-pinning, AES-256-GCM sessions, CSRF, scrypt vault, refresh-family revocation, sound Ed25519 manifest binding — all verified. | Session `exp`; stronger password KDF. |
| **Authentication** | 74 | 93 | Strong JWT/CSRF/refresh design, BUT fail-open OIDC verify (AUTH-1), MFA unthrottled (AUTH-2), no session expiry/revocation (AUTH-3), refresh-as-access (AUTH-4), no login rate limit (AUTH-6). | Fail-closed OIDC; MFA throttle; session exp; type/exp/aud checks; login RL. |
| **Authorization / multi-tenancy** | 82 | 93 | `orgScopedRepo` proven by property tests. Residual: webhook→org binding attacker-influenceable (PAY-4); channel authz caller-asserted (F-R5). | Verified-customer tenant binding; channel authz. |
| **Realtime security** | 80 | 90 | Q1 added `authFn` warning + `allowedOrigins` origin gate. Residual: channel authz (F-R5), per-IP upgrade RL (F-R3), inbound frame schema (F-R4). | Channel authz + identity propagation; WS RL + validation. |
| **Payments** | 72 | 93 | Idempotency atomic + amounts server-verified (strong). BUT Stripe signature verify is a phantom control (PAY-1), PayPal has no webhook verification (PAY-2), MarzPay lacks idempotency/tenant binding (PAY-3/PAY-4). | Real Stripe verify + wiring; PayPal verify; MarzPay event store + tenant derivation. |
| **Plugin host / signing** | 70 | 92 | Excellent signing crypto + fail-closed publish + registry-mediated install + deep-freeze. BUT consumer installer is default-open (PS-2) with a zip-slip extractor (PS-1, CRITICAL); single key/no rotation (PS-4). | Containment + mandatory verify in installer; key rotation/`keyId`. |
| **Supply chain (npm/provenance)** | 91 | 95 | Provenance + attestation gate, cosign, SBOM, dep-review, secret-scan, signed plugins, 3-dep core. | Owner-add gating (CI-1); tag-only publish (CI-2); key rotation. |
| **Infrastructure / CI-CD** | 90 | 94 | SHA-pinned + zizmor-linted actions, least-privilege, no `pull_request_target`, no expression injection, `persist-credentials:false`. | Approval env for owner-add; tag-gated publish; E403 handling. |
| **Input validation / rendering** | 82 | 91 | Zod `@Validate`, parameterized SQL, default HTMX escaping + bounded recursion. Residual: HTMX context-insensitive escaping (HTMX-1), raw passthrough (HTMX-2), view traversal (HTMX-3), no auto-CSRF for HTMX (HTMX-5); WS frames unvalidated (F-R4). | Context-aware HTMX helpers + CSRF wiring; WS frame schema. |
| **AI security** | 55 | 80 | Not re-verified this pass (AI-1) — RAG + tool-calling present, guardrails unconfirmed. | Dedicated AI review. |
| **Secure defaults (generated apps)** | 80 | 94 | Project-name regex, no real secrets emitted, prod fail-fast on CORS/secrets. Residual: hardcoded fallback secrets in `street.config.ts` (GEN-1); caret-ranged deps (GEN-2). | Remove literal secret fallbacks; pin deps / always emit lockfile. |

(Composite = mean of the 11 dimension scores.)

## Severity tally (this pass)

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 1 | PS-1 |
| HIGH | 7 | PS-2, AUTH-1, AUTH-2, AUTH-3, PAY-1, PAY-2, PAY-3 |
| MEDIUM | 14 | HTMX-1..5, AUTH-4..7, PAY-4, PS-3, PS-4, CI-1, CI-2, GEN-1 |
| LOW | 11 | HTMX-6, AUTH-8..11, PAY-5, GEN-2, GEN-3, CI-3..5 |
| INFO | 3 | PS-5, AI-1, (registry key-pinning) |

## Trajectory to 95+

1. **Immediate (Low effort, highest ROI) → composite ≈ 91**
   - PS-1 zip-slip containment (CRITICAL, Low).
   - PS-2 mandatory installer signature + manifest schema + https pin (HIGH, Low).
   - GEN-1 remove hardcoded fallback secrets (MEDIUM, Low).
   - AUTH-4/AUTH-5/AUTH-6 token-type + exp + login rate limit (Low).
2. **Short (Medium effort) → composite ≈ 95**
   - AUTH-1 fail-closed OIDC verification (alg allow-list, aud-contains, iss exact, fail-closed).
   - AUTH-2 MFA throttling + TOTP step-reuse guard.
   - AUTH-3 session `exp` + optional revocation/key-epoch.
   - PAY-1 real Stripe `verify` + raw-body wiring; PAY-2 PayPal webhook verification; PAY-3 MarzPay event store + tenant derivation.
   - HTMX-1/3/5 context-aware helpers, view containment, CSRF wiring.
   - PS-4 key rotation/`keyId`; CI-1 owner-add gating; CI-2 tag-only publish.
3. **Sustaining (toward 96+ and audited evidence)**
   - AI-1 dedicated AI review; F-R3/F-R4/F-R5 realtime hardening; ORM injection sweep; **external security review + pen-test** (the highest enterprise-trust unlock).

## Method & honesty notes

- Scores derive from confirmed source findings; no dimension is inflated. AI scores low because it was **not** deeply audited this pass (stated, not penalized as if broken).
- The single CRITICAL (PS-1) is a conventional archive-extraction arbitrary-file-write, reachable without a signature in the default-open installer path — not fabricated to inflate severity.
- The composite is a planning instrument, not a certificate; "enterprise-ready" is gated on the external review.
- Guardrails for every remediation: **no new runtime dependency** (reuse `node:crypto`/`node:path`/`zod`/`RateLimiter`), **secure-by-default with explicit escape hatches**, and **each fix ships with a test** (property test where a security invariant exists).
