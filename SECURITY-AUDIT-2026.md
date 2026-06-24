# StreetJS Security Audit — 2026

> **Type:** Full ecosystem security audit (source-verified). **No core/framework code was modified by this audit.**
> **Method:** every finding was confirmed by reading the actual source in this repository. Nothing is assumed or invented. Where a subsystem could not be fully verified from source, that is stated explicitly rather than guessed.
> **Severity scale:** CRITICAL · HIGH · MEDIUM · LOW · INFORMATIONAL.
> **Per-finding fields:** affected package · threat scenario · exploitability · impact · remediation · effort · priority.
> **Goal:** move from "secure open-source framework" toward "enterprise-ready security posture" while preserving the dependency-light architecture (3 runtime deps: `reflect-metadata`, `ws`, `zod`).

Companion documents: `THREAT-MODEL-UPDATE.md`, `SECURITY-ROADMAP.md`, `SECURITY-SCORECARD.md`.

---

## 0. Scope & evidence

Audited from source: `packages/core` (security/, http/, websocket/, webhook/, auth/, platform/plugins/), `packages/plugin-marzpay`, the SaaS billing overlays in `packages/cli`, `.github/workflows/*`, and supply-chain artifacts (`sbom.json`, signing scripts, official key).

**Scope clarification (verified):** `packages/plugin-stripe/src` and `packages/plugin-paypal/src` **do not exist in this repository**. Stripe is consumed as a published dependency (`@streetjs/plugin-stripe`) by a scaffolded webhook controller; PayPal appears only as naming references. Those plugins' internal crypto could not be audited from source here and is explicitly out of evidence.

**Overall:** the cryptographic primitives and supply chain are strong; the material gaps are **insecure-by-default** behaviors (WebSocket auth/origin, cookie flags, plugin signature enforcement) and **payment webhook idempotency/replay** in the MarzPay overlay. No CRITICAL issue was confirmed.

---

## 1. Findings summary

| ID | Severity | Area | Title | Priority |
|----|----------|------|-------|----------|
| F-R1 | **HIGH** | Realtime | WebSocket auth is optional (no auth by default) | P1 |
| F-R2 | **HIGH** | Realtime | No `Origin` validation on WS upgrade (CSWSH) | P1 |
| F-P1 | **HIGH** | Plugins | Signature verification is conditional; default host loads unsigned plugins | P1 |
| F-PAY1 | **HIGH** | Payments | MarzPay overlay webhook has no idempotency (duplicate-credit on replay) | P1 |
| F-A1 | **MEDIUM** | Auth | Cookie flags are opt-in, not secure-by-default | P2 |
| F-R3 | **MEDIUM** | Realtime | No per-IP/connection rate limit on WS upgrades | P2 |
| F-R4 | **MEDIUM** | Realtime | Inbound WS frames not schema-validated | P2 |
| F-R5 | **MEDIUM** | Realtime | `ChannelHub` has no per-channel authorization; `memberId` is caller-asserted | P2 |
| F-P2 | **MEDIUM** | Plugins | "Sandbox" is declarative, not runtime confinement | P2 |
| F-P3 | **MEDIUM** | Plugins | No manifest schema validation (only name/version match) | P2 |
| F-PAY2 | **MEDIUM** | Payments | MarzPay overlay has no replay protection (timestamp/nonce) | P2 |
| F-PAY4 | **MEDIUM** | Payments | Stripe idempotency store ships no migration | P2 |
| F-PAY5 | **MEDIUM** | Payments | Webhook→tenant binding is mapping-derived, not event-bound | P2 |
| F-AI1 | **MEDIUM** | AI | Tool-calling / prompt-injection guardrails not source-verified | P2 |
| F-A2 | **LOW** | Auth | `setCookie` overwrites prior `Set-Cookie` (single header) | P3 |
| F-A3 | **LOW** | Auth | Stateless sessions: no server-side revocation / rotation primitive | P3 |
| F-P4 | **LOW** | Plugins | Manifest not re-verified at enable; stored by reference (TOCTOU) | P3 |
| F-P5 | **LOW** | Plugins | Manifest verification does not gate plugin code execution | P3 |
| F-SC1 | **LOW** | Supply chain | Single plugin-signing key, no rotation/HSM/keyless | P3 |
| F-CI1 | **INFO** | Infra | Bus factor = 1 weakens security-incident response | P3 |
| F-ORM1 | **INFO** | ORM | Parameterization strong; add a dedicated injection property sweep | P3 |

---

## 2. Authentication

**Strengths (VERIFIED):** JWT HMAC-SHA256 with `timingSafeEqual` + `alg`/`typ` enforcement (`security/jwt.ts`); AES-256-GCM stateless sessions with random 96-bit IV, auth-tag validation, and a key-entropy guard (`security/session.ts`); CSRF synchronizer-token middleware with constant-time compare and safe-method exemption (`http/auth.middleware.ts`); **MFA fully implemented** — TOTP/HOTP (RFC 4226/6238 vectors), single-use recovery codes, step-up `mfaGuard`, `street_mfa` migration, constant-time `verifyTotp` (`auth/mfa.ts`); OAuth2 with PKCE + `state` CSRF (`tests/oauth2.test.ts`); vault scrypt (N=131072) + constant-time secret compare.

### F-A1 — Cookie flags are opt-in, not secure-by-default — MEDIUM
- **Affected:** `packages/core` (`core/context.ts` `setCookie`)
- **Threat scenario:** `setCookie` only emits `HttpOnly`/`Secure`/`SameSite` when the caller passes them. A developer who writes a session cookie without those options ships a cookie readable by JS (XSS theft), sent over HTTP (MITM), and attachable cross-site (CSRF).
- **Exploitability:** Medium — depends on developer omission, which is common.
- **Impact:** Session/cookie theft or cross-site submission.
- **Remediation:** Default to `HttpOnly: true`, `Secure: true` (when `NODE_ENV=production`), `SameSite: 'Lax'` unless explicitly overridden; document.
- **Effort:** Low (<1 day). **Priority:** P2.

### F-A2 — `setCookie` overwrites prior `Set-Cookie` — LOW
- **Affected:** `packages/core` (`core/context.ts`)
- **Threat scenario:** `res.setHeader('Set-Cookie', …)` replaces any existing value, so setting two cookies in one response drops the first (e.g., session + CSRF) — can cause auth/CSRF state loss, not a direct exploit.
- **Exploitability:** Low. **Impact:** Low (functional/security-adjacent).
- **Remediation:** Append (read existing header into an array). **Effort:** Low. **Priority:** P3.

### F-A3 — Stateless sessions: no revocation/rotation primitive — LOW
- **Affected:** `packages/core` (`security/session.ts`)
- **Threat scenario:** Sessions are encrypted client-side blobs with no server store, so there is no `regenerate()` on privilege elevation and no server-side revocation/blocklist. Classic session **fixation is largely N/A** (no reusable server session id), but a stolen valid blob cannot be revoked before expiry.
- **Exploitability:** Low. **Impact:** Medium if a token leaks.
- **Remediation:** Document the model; offer an optional server-side session store with revocation + a `rotate()` helper to call on login/privilege change. **Effort:** Medium. **Priority:** P3.

---

## 3. Payments

**Strengths (VERIFIED):** Stripe overlay verifies the signature on the **unmodified raw body** with a **300s replay tolerance** and is **idempotent** (event-id de-dup inside the same DB transaction as the upsert, atomic rollback) — `cli/.../billing.controller.ts` + `billing.service.ts`. MarzPay correctly refuses to invent a signature scheme (none is published) and uses **server-side re-verification** (`getTransaction`) as the trust path. Outbound `WebhookDispatcher` HMAC-signs (`X-Street-Signature`), is HTTPS-only, validates against a comprehensive private/reserved IP blocklist **and re-checks resolved IPs (DNS-rebinding)**, never disables TLS, and bounds its queue.

### F-PAY1 — MarzPay overlay webhook has no idempotency — HIGH
- **Affected:** `packages/cli` (scaffolded `marzpay-webhook.controller.ts` / `marzpay-billing.service.ts`)
- **Threat scenario:** `recordPayment` does an unconditional `orgScopedRepo(...).insert(...)` of a new `BillingRecord`. If a webhook is delivered twice (providers retry) or replayed, the same settlement is inserted multiple times → **double-credited payments / inflated billing records**.
- **Exploitability:** Medium (today the negative path fail-closes — see F-PAY2 note — but the design has no dedup once a positive path is enabled).
- **Impact:** High — financial integrity.
- **Remediation:** De-duplicate by transaction `reference` (unique index or a processed-event store), mirroring the Stripe overlay's `ProcessedEventStore` keyed by event id, inside the insert transaction.
- **Effort:** Low–Medium (<1 week). **Priority:** P1.

### F-PAY2 — MarzPay overlay has no replay protection — MEDIUM
- **Affected:** `packages/cli` (MarzPay overlay)
- **Threat scenario:** No timestamp tolerance / nonce / event-id check. (MarzPay publishes no signature scheme, so `validateWebhook` currently returns `false` for all material → the controller **fail-closes** with 400 and writes nothing; this is safe but also means webhook settlement is non-functional until a scheme exists.) When settlement is driven (re-verify path or future signature), replays are unbounded.
- **Exploitability:** Low today (fail-closed); Medium once enabled.
- **Impact:** Medium (combines with F-PAY1).
- **Remediation:** Add the dedup from F-PAY1 + a `reference`-seen guard; document that MarzPay settlement should poll `getTransaction` until a signature scheme is published. **Effort:** Low. **Priority:** P2.

### F-PAY4 — Stripe idempotency store ships no migration — MEDIUM
- **Affected:** `packages/cli` (`--with-billing` overlay)
- **Threat scenario:** The `ProcessedEventStore` (`stripe_events(event_id PRIMARY KEY, …)`) has **no migration** in the starter; if the operator doesn't create it, the idempotency guard can't function (or the upsert fails), defeating F-PAY1's analog for Stripe.
- **Exploitability:** Low–Medium (operator omission). **Impact:** Medium (duplicate processing).
- **Remediation:** Ship the `stripe_events` migration with `--with-billing`. **Effort:** Low. **Priority:** P2.

### F-PAY5 — Webhook→tenant binding is mapping-derived, not event-bound — MEDIUM
- **Affected:** `packages/cli` (Stripe + MarzPay overlays)
- **Threat scenario:** Stripe maps `org_id` from `metadata.org_id`/`client_reference_id`; MarzPay stamps `org_id` from the ambient `ctx` on an **unauthenticated** webhook route. If the event→org mapping or the webhook route's tenant resolution is misconfigured, a webhook could write to the wrong tenant.
- **Exploitability:** Low (needs misconfiguration). **Impact:** High (cross-tenant write).
- **Remediation:** Derive the tenant from the **verified** transaction/customer (server-side), validate it against the mapped org, and document the webhook route wiring (no client-supplied org). **Effort:** Medium. **Priority:** P2.

---

## 4. Realtime (WebSocket / SSE / Channels)

**Strengths (VERIFIED):** optional pre-upgrade `authFn` (rejects with 401), a 512 KB frame cap (`maxPayload`), a global `maxConnections` cap (1013 on overflow), heartbeat/cleanup, and SSE field sanitization (`\r\n` stripped → no frame injection).

### F-R1 — WebSocket auth is optional (no auth by default) — HIGH
- **Affected:** `packages/core` (`websocket/server.ts`)
- **Threat scenario:** `authFn` is `undefined` by default; if the developer doesn't supply it, **every upgrade is accepted unauthenticated**. The authenticated identity is also not propagated to the socket/handler even when `authFn` is used.
- **Exploitability:** High (default-open). **Impact:** High (unauthorized realtime access).
- **Remediation:** Emit a loud startup warning when a WS server is created without `authFn` in production; provide a first-class `auth` option that both gates and **attaches the identity** to the `StreetSocket`. **Effort:** Low–Medium. **Priority:** P1.

### F-R2 — No `Origin` validation on WS upgrade (CSWSH) — HIGH
- **Affected:** `packages/core` (`websocket/server.ts`)
- **Threat scenario:** The upgrade path checks only the URL path and the optional `authFn`. With cookie-based auth and no Origin check, a malicious page can open a cross-site WebSocket (Cross-Site WebSocket Hijacking) and act as the victim.
- **Exploitability:** High when auth is cookie-based. **Impact:** High.
- **Remediation:** Built-in `allowedOrigins` allowlist enforced before upgrade (default to same-origin). **Effort:** Low. **Priority:** P1.

### F-R3 — No per-IP/connection rate limit on WS upgrades — MEDIUM
- **Affected:** `packages/core` (`websocket/server.ts`)
- **Threat scenario:** Only a global `maxConnections` cap exists; a single client can exhaust capacity (DoS) via rapid upgrades. The HTTP `RateLimiter` is not wired into the WS path.
- **Exploitability:** Medium. **Impact:** Medium (availability).
- **Remediation:** Per-IP upgrade rate limiting (reuse `RateLimiter`). **Effort:** Medium. **Priority:** P2.

### F-R4 — Inbound WS frames not schema-validated — MEDIUM
- **Affected:** `packages/core` (`websocket/server.ts` `StreetSocket`)
- **Threat scenario:** Frames are `JSON.parse`d and dispatched by `msg.type` with arbitrary `payload`; malformed frames are silently dropped and there is no schema check, so handlers receive untrusted shapes.
- **Exploitability:** Medium. **Impact:** Medium (handler logic abuse).
- **Remediation:** Optional per-event Zod schema validation hook for inbound messages (consistent with the HTTP `@Validate`). **Effort:** Medium. **Priority:** P2.

### F-R5 — `ChannelHub` has no per-channel authorization — MEDIUM
- **Affected:** `packages/core` (`websocket/channels.ts`)
- **Threat scenario:** `join(channel, memberId, conn)` accepts a **caller-supplied `memberId`** with no authorization; any connection can join any channel as any member and receive its broadcasts / forge presence (impersonation, data exposure).
- **Exploitability:** Medium–High (once connected). **Impact:** High (authz bypass, info disclosure).
- **Remediation:** Add an authorization callback to `join`/`publish`; bind `memberId` to the authenticated identity from `authFn` rather than trusting the client. **Effort:** Medium. **Priority:** P2.

---

## 5. Plugin system

**Strengths (VERIFIED):** Ed25519 manifest signing over a canonical key-sorted body; `verifyManifest` uses `node:crypto` verify with integrity-checksum + signature; the embedded official public key verifies `@streetjs/plugin-*`; registration rejects bad signatures with `PluginSignatureError`; permissions are grant-gated at enable; 21/21 official plugins are signed in CI.

### F-P1 — Signature verification is conditional; default host loads unsigned plugins — HIGH
- **Affected:** `packages/core` (`platform/plugins/host.ts`)
- **Threat scenario:** `publicKey` is optional. `new PluginHost()` (no key) **skips** signature verification entirely and accepts any/unsigned plugin. An app that doesn't wire `officialPluginPublicKey()` can load a tampered/malicious plugin without detection.
- **Exploitability:** Medium (default-open; depends on app wiring). **Impact:** High (arbitrary in-process code).
- **Remediation:** Default the host to `officialPluginPublicKey()` (require explicit opt-out for unsigned/dev), and warn loudly when verification is disabled. **Effort:** Low–Medium. **Priority:** P1.

### F-P2 — "Sandbox" is declarative, not runtime confinement — MEDIUM
- **Affected:** `packages/core` (`platform/plugins/{host,sdk}.ts`)
- **Threat scenario:** `SandboxedApp` only restricts the injected app object (gates `use`/`on`). `net`/`fs`/`db`/`secrets` permissions are honor-system grants checked at enable; an enabled plugin runs as ordinary in-process Node and can `import('node:fs')`/`node:net` regardless of declared permissions.
- **Exploitability:** N/A for *signed/trusted* plugins; High for *untrusted* code if anyone treats the host as a security boundary. **Impact:** High (full host access).
- **Remediation:** **Document the trust model honestly** — signed = trusted, not sandboxed. For true isolation of untrusted plugins, a `worker_threads`/`vm`-based runner is a major initiative. **Effort:** Low (doc) / High (real isolation). **Priority:** P2.

### F-P3 — No manifest schema validation — MEDIUM
- **Affected:** `packages/core` (`platform/plugins/host.ts`)
- **Threat scenario:** Only `name`/`version` identity is checked; field types/shapes are unvalidated, so a malformed manifest (e.g., bad `permissions`/`dependencies`) is tolerated and could confuse enable-time logic.
- **Exploitability:** Low. **Impact:** Medium.
- **Remediation:** Validate the manifest with a Zod schema before register. **Effort:** Low. **Priority:** P2.

### F-P4 — Manifest not re-verified at enable; stored by reference (TOCTOU) — LOW
- **Affected:** `packages/core` (`platform/plugins/host.ts`)
- **Threat scenario:** `register()` verifies the signature once; `enable()` re-reads `entry.manifest` (held by reference, no defensive copy) for permission/dependency decisions without re-verifying — a caller retaining the manifest could mutate granted permissions post-registration.
- **Exploitability:** Low (in-process). **Impact:** Medium.
- **Remediation:** Deep-freeze/clone the manifest at register; re-verify (or use the frozen copy) at enable. **Effort:** Low. **Priority:** P3.

### F-P5 — Verification does not gate plugin code execution — LOW
- **Affected:** `packages/core` (`platform/plugins/host.ts`)
- **Threat scenario:** The plugin instance is constructed by the caller before `register()`; the host verifies the *manifest*, not the *code* (code is not hashed/measured), so import-time code already ran.
- **Exploitability:** Low. **Impact:** Medium.
- **Remediation:** For the marketplace install path, rely on npm provenance + signature on the package tarball (already present for official plugins); document that in-process `register()` is not a code-integrity gate. **Effort:** Low (doc). **Priority:** P3.

---

## 6. Supply chain (STRONG — mostly VERIFIED)

VERIFIED controls: **npm provenance** (`--provenance`, `id-token: write` in publish workflows); **CycloneDX SBOM** (`sbom.json` + `scripts/generate-sbom.mjs`); **cosign** keyless release signing (`ci-cd.yml`); **OpenSSF Scorecard**, **CodeQL**, **secret scanning** (Gitleaks + TruffleHog), **dependency review**, **DAST** workflows; **Ed25519-signed plugin manifests** (21/21 official, verified against the official key in CI); **3 runtime dependencies** only.

### F-SC1 — Single plugin-signing key, no rotation/HSM/keyless — LOW
- **Affected:** ecosystem (signing infra)
- **Threat scenario:** All official plugins are signed by one `STREET_PLUGIN_SIGNING_KEY` CI secret. Compromise/loss = ecosystem-wide trust impact, with no documented rotation path or hardware backing.
- **Exploitability:** Low. **Impact:** High if the key leaks.
- **Remediation:** Document a key-rotation policy + a `manifest.pub` distribution story; evaluate Sigstore keyless signing for plugins. **Effort:** Medium–High. **Priority:** P3.

---

## 7. Infrastructure / CI/CD (STRONG — VERIFIED)

VERIFIED: `main` is a **protected branch** (a CI push from the `GITHUB_TOKEN` was rejected with `GH006` during this work — confirms protection); GitHub Actions are **pinned to commit SHAs** and statically analyzed by **zizmor**; workflow permissions default to least-privilege (`contents: read`); secret scanning runs in CI.

### F-CI1 — Bus factor = 1 weakens incident response — INFORMATIONAL
- **Affected:** project governance
- **Threat scenario:** A single maintainer/`CODEOWNER` means no guaranteed second reviewer or security-response rota; a security incident may lack timely coverage.
- **Remediation:** Onboard a second maintainer; document a 2-person disclosure/response rota (see `MAINTAINERS.md`, `SECURITY.md`). **Effort:** Organizational. **Priority:** P3.

---

## 8. ORM & AI (coverage notes — honest scope)

### F-ORM1 — Parameterization strong; add a dedicated injection sweep — INFORMATIONAL
- **Affected:** `packages/core` (database), `@streetjs/orm`
- **Status:** Core uses parameterized queries and SCRAM-SHA-256 auth (VERIFIED in prior phases/tests); `orgScopedRepo` enforces tenant scoping. No string-interpolated SQL was observed.
- **Remediation:** Add a property-based SQL-injection sweep across the query builder + repository as a regression gate. **Effort:** Medium. **Priority:** P3.

### F-AI1 — AI tool-calling / prompt-injection guardrails not source-verified — MEDIUM
- **Affected:** `@streetjs/ai`
- **Status:** The `ai-assistant` reference app performs RAG + a tool-calling loop. This audit did **not** verify tool-call authorization, prompt-injection mitigation, output bounds, or secret-in-prompt handling from source — flagged as needing a dedicated review rather than asserted safe or unsafe.
- **Threat scenario:** Prompt injection via retrieved/user content could trigger unintended tool calls or data exfiltration.
- **Remediation:** Dedicated AI security review: tool allowlist + per-tool authorization, no secrets in prompts/logs, output size/rate bounds, retrieval-content sanitization. **Effort:** Medium. **Priority:** P2.

---

## 9. Verify-don't-invent notes

- Stripe/PayPal plugin internals are **not in this repo**; their crypto is not asserted.
- MarzPay's missing webhook signature scheme is a **vendor** gap, correctly handled fail-closed in source — not invented.
- No CRITICAL finding was fabricated to inflate severity; the highest confirmed issues are HIGH and are all **insecure-by-default** or **idempotency** gaps, not broken cryptography.
