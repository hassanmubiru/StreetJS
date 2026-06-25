# StreetJS Security Audit — 2026 (Adversarial Pass)

> **Type:** Full adversarial ecosystem security audit (source-verified). **No framework code was modified by this audit.**
> **Method:** Every finding below was confirmed by reading the actual source in this repository (file paths and excerpts cited). Where a control is strong it is documented as a strength with evidence. Nothing is assumed or invented; subsystems that could not be verified from source are stated as such.
> **Reviewer model:** An attacker actively attempting to compromise (1) the npm publish pipeline, (2) plugin signing infrastructure, (3) MarzPay payments, (4) HTMX rendering, (5) authentication/session handling, (6) starter generation, (7) the plugin marketplace.
> **Severity scale:** CRITICAL · HIGH · MEDIUM · LOW · INFORMATIONAL. Each finding carries: exploit path · impact · likelihood · remediation · estimated effort.
> **Goal:** Raise the posture from ~90/100 to 95+/100 while preserving the dependency-light architecture (3 runtime deps: `reflect-metadata`, `ws`, `zod`) and avoiding unnecessary complexity.

Companion documents: `THREAT-MODEL-2026.md`, `SECURITY-SCORECARD.md`, `PAYMENTS-SECURITY-REVIEW.md`, `PLUGIN-SIGNING-REVIEW.md`.

This pass **supersedes** the prior `SECURITY-AUDIT-2026.md` (Q1). The Q1 quick-win findings (secure-by-default cookies, WS origin/auth warning, plugin manifest schema + deep-freeze, Stripe idempotency migration, trust-model docs) have since been **remediated and verified** — see §10. This adversarial pass goes deeper into the seven targeted surfaces and surfaces new issues, most notably an archive **path-traversal (zip-slip) → RCE** chain in the marketplace installer, a **fail-open OAuth ID-token verifier**, and a **phantom Stripe webhook signature control**.

---

## 0. Scope & evidence

Audited from source this pass:
- `packages/plugin-htmx/src/{view-engine,htmx,index}.ts` (HTMX rendering)
- `packages/plugin-marzpay/src/index.ts` + MarzPay CLI overlays in `packages/cli/src/commands/create.ts`
- `packages/plugin-stripe/src/index.ts`, `packages/plugin-paypal/src/index.ts`, `packages/core/src/platform/plugins/official/stripe.ts`, and the Stripe billing overlays in `create.ts`
- `packages/core/src/platform/plugins/{host,sdk,registry,local-registry}.ts`, `official-key.ts`, `packages/registry-server/*` (plugin signing + marketplace)
- `.github/workflows/*.yml`, `.github/actions/setup/action.yml`, `.github/zizmor.yml`, `.npmrc` (npm pipeline + CI)
- `packages/core/src/security/{jwt,session,ratelimit,vault}.ts`, `packages/core/src/auth/{mfa,oauth2,refresh-tokens}.ts`, `http/auth.middleware.ts`, `services/user.service.ts` (auth/session)
- `packages/cli/src/commands/create.ts` (starter generation)

**Headline:** The cryptographic primitives (JWT HS256 hardening, AES-256-GCM sessions, CSRF synchronizer tokens, scrypt vault, refresh-token replay-family revocation) and the **CI/npm publish pipeline** (SHA-pinned actions, least-privilege permissions, `--provenance` with attestation verification, no `pull_request_target`, no expression injection) are genuinely strong. The material risk has shifted to **(a)** the consumer-side marketplace installer (archive traversal + default-open verification), **(b)** federated-identity verification (OAuth ID token), **(c)** payment webhook authenticity wiring (a documented-but-absent Stripe verify; no PayPal verification; MarzPay idempotency/tenant gaps), and **(d)** insecure-by-default generated config.

---

## 1. Findings summary

| ID | Severity | Area | Title |
|----|----------|------|-------|
| **PS-1** | **CRITICAL** | Marketplace | Zip-slip path traversal in `PluginInstaller._extractTarball` → arbitrary file write → RCE |
| **PS-2** | **HIGH** | Marketplace | Consumer `PluginInstaller` is default-open; integrity check is registry-self-referential |
| **AUTH-1** | **HIGH** | Auth | OAuth2 `verifyIdToken` is fail-open; audience bypass on array `aud`; issuer check is a no-op |
| **AUTH-2** | **HIGH** | Auth | MFA verify has no brute-force throttling/lockout and no TOTP step-reuse prevention |
| **AUTH-3** | **HIGH** | Auth | Stateless sessions carry no `exp` and no revocation → indefinite replay |
| **PAY-1** | **HIGH** | Payments | Stripe webhook signature verification is a phantom control (`StripeClient.verify` does not exist) |
| **PAY-2** | **HIGH** | Payments | PayPal plugin performs no webhook authenticity verification at all |
| **PAY-3** | **HIGH** | Payments | MarzPay overlay still has no idempotency/replay store and no tenant binding |
| **HTMX-1** | **MEDIUM** | HTMX | Context-insensitive escaping → XSS in unquoted-attribute / `javascript:` URL sinks |
| **HTMX-2** | **MEDIUM** | HTMX | `{{{ raw }}}` + `fragment()` raw passthrough with no guardrail/docs |
| **HTMX-3** | **MEDIUM** | HTMX | View/partial name resolution permits `../` → template traversal/disclosure |
| **HTMX-4** | **MEDIUM** | HTMX | `HX-Redirect`/`HX-Location` set verbatim → open redirect |
| **HTMX-5** | **MEDIUM** | HTMX | No automatic CSRF integration for HTMX mutations |
| **AUTH-4** | **MEDIUM** | Auth | Refresh JWT usable as an access token (no `type` claim check in middleware) |
| **AUTH-5** | **MEDIUM** | Auth | `exp` not required; `iss`/`aud` not enforced by the auth middleware |
| **AUTH-6** | **MEDIUM** | Auth | No rate limit / lockout on `/login` (brute-force, credential stuffing) |
| **AUTH-7** | **MEDIUM** | Auth | User enumeration via registration `409` |
| **PAY-4** | **MEDIUM** | Payments | Cross-tenant write via attacker-influenceable `client_reference_id`/`metadata.org_id` |
| **PS-3** | **MEDIUM** | Signing | Single signing key, no `keyId`/rotation/revocation path |
| **PS-4** | **MEDIUM** | Signing | Non-strict manifest schema can drift from the fixed-key signed body |
| **CI-1** | **MEDIUM** | Pipeline | `transfer-npm-owner` auto-adds npm co-owners with no approval gate/allow-list |
| **CI-2** | **MEDIUM** | Pipeline | Publish runs on every push to `main`, relying solely on idempotency |
| **GEN-1** | **MEDIUM** | Starters | Generated `street.config.ts` ships hardcoded fallback secrets |
| **HTMX-6** | **LOW** | HTMX | Escaper character-set inconsistency with core sanitizer |
| **AUTH-8** | **LOW** | Auth | PBKDF2 work factor (100k) below current OWASP guidance |
| **AUTH-9** | **LOW** | Auth | Scoped `rateLimit()` count-then-hit is non-atomic (limit overrun) |
| **AUTH-10** | **LOW** | Auth | Cookies omit `Secure` outside production (`NODE_ENV`-tied) |
| **AUTH-11** | **LOW** | Auth | Recovery codes ~40-bit entropy, unsalted fast hash |
| **PAY-5** | **LOW** | Payments | MarzPay unencoded path-segment interpolation (same-host path/query injection) |
| **GEN-2** | **LOW** | Starters | Generated `package.json` uses caret ranges; lockfile generation is fail-soft |
| **GEN-3** | **LOW** | Starters | `spawn(..., { shell: true })` in scaffolder (not injectable today) |
| **CI-3** | **LOW** | Pipeline | Publish step swallows `E403` as success, masking auth failures |
| **CI-4** | **LOW** | Pipeline | `provider-integration` sets `NODE_TLS_REJECT_UNAUTHORIZED=0` (scoped) |
| **CI-5** | **LOW** | Pipeline | Secrets referenced on `pull_request` (safe only while forks get no secrets) |
| **PS-5** | **INFO** | Marketplace | `registry-server` trusts publisher-supplied public key (consumers must pin) |
| **AI-1** | **INFO** | AI | AI tool-calling / prompt-injection guardrails not re-verified this pass |

**Tally:** CRITICAL 1 · HIGH 7 · MEDIUM 14 · LOW 11 · INFO 3.

---

## 2. Plugin marketplace / installer (CRITICAL chain here)

### PS-1 — Zip-slip path traversal in `PluginInstaller._extractTarball` → arbitrary file write → RCE — CRITICAL
- **Affected:** `packages/core/src/platform/plugins/registry.ts` — `_extractTarball()`.
- **Evidence:** The hand-rolled tar parser computes the destination as
  `path.join(destDir, name.replace(/^\.\//,'').replace(/^\//,''))` and then `fs.writeFile(filePath, fileData)` / `fs.mkdir(dirPath)`. It strips a single leading `./` and `/` but performs **no `..` containment check**, and does not reject absolute paths or symlink/hardlink entries (`typeFlag` 1/2).
- **Exploit path:** A registry (malicious, compromised, or MITM'd in a misconfigured deployment) serves a tarball containing an entry named `../../../../home/<user>/.bashrc` (or a `~/.npmrc`, `crontab`, or systemd unit path). On `install()`, `_extractTarball` joins it onto `destDir` and writes attacker-controlled bytes outside the plugins directory.
- **Impact:** Arbitrary file overwrite outside `pluginsDir` → code execution / persistence (RCE). With PS-2 (no mandatory signature), this is reachable without any signature at all.
- **Likelihood:** Medium — requires the app to use the marketplace installer; once it does, exploitation is deterministic.
- **Remediation:** After computing the target, resolve and assert containment: `path.resolve(destDir, entry)` must start with `path.resolve(destDir) + path.sep`; reject entries containing `..` segments, absolute paths, and symlink/hardlink type-flags. Pure `node:path`, no new dependency.
- **Effort:** Low (<1 day).

### PS-2 — Consumer `PluginInstaller` is default-open; integrity check is registry-self-referential — HIGH
- **Affected:** `packages/core/src/platform/plugins/registry.ts` — `install()`, `_fetchManifest()`.
- **Evidence:** Signature verification runs only `if (this.publicKey)`; `publicKey` is optional and unset by default. The checksum gate compares the downloaded tarball's SHA-256 against `manifest.checksum`, but **both the manifest and the tarball come from the same (untrusted) registry response**, so the check is self-referential. `_fetchManifest` does `JSON.parse(body) as PluginManifest` with no schema validation.
- **Exploit path:** App constructs `new PluginInstaller({ pluginsDir })` without a `publicKey`. A malicious/compromised registry returns a manifest + matching tarball; the checksum trivially matches; extraction proceeds (and chains into PS-1).
- **Impact:** Installation of arbitrary plugin code (RCE when combined with PS-1; loaded plugin code at minimum).
- **Likelihood:** Medium–High — `publicKey` is optional with no default and nothing forces it.
- **Remediation:** Default `publicKey` to `officialPluginPublicKey()`; remove the `if (this.publicKey)` opt-out (require an explicit `allowUnsigned: true`); validate the fetched manifest against `pluginManifestSchema`; reject responses lacking a signature.
- **Effort:** Low.

> **Strengths (verified):** The `registry-server` **publish** pipeline (`packages/registry-server/src/registry.ts`) verifies the Ed25519 signature + checksum **before** storing, enforces bearer authn + namespace authz, rejects duplicates, and records the tarball SHA-256 — fail-closed. The **registry-mediated** install path `installThroughRegistry()` refuses unless `host.verifiesSignatures()` is true. The raw `PluginInstaller` above is the weak, default-open path.

---

## 3. Authentication & session

> **Strengths (verified):** JWT pins `alg:HS256`/`typ:JWT` and rejects `none`/alg-confusion (`security/jwt.ts:62-66`), uses `timingSafeEqual` with a length guard, enforces `nbf`/`iat`-skew, and requires a ≥32-byte secret. Sessions are AES-256-GCM with a fresh random 96-bit IV per encrypt and auth-tag validation (`security/session.ts`). CSRF is a session-bound synchronizer token (`randomBytes(32)`, constant-time compare, safe-method exempt). Refresh tokens (`auth/refresh-tokens.ts`) are opaque, SHA-256-stored, atomically rotated, with **replay-family revocation** — a strong design. The vault uses scrypt N=2¹⁷. Login is timing-safe with a dummy-hash on miss.

### AUTH-1 — OAuth2 `verifyIdToken` is fail-open; audience bypass; no-op issuer check — HIGH
- **Affected:** `packages/core/src/auth/oauth2.ts` — `verifyIdToken()` (~line 186).
- **Evidence:**
  - Signature is verified only inside `if (key.kty === 'RSA' …)` / `else if (key.kty === 'EC' …)`. Any other/malformed key (no `n`/`e`, `kty:'oct'`, missing branch) falls through and the function `return payload` **without verifying the signature**.
  - Audience: `if (payload['aud'] !== expectedAud && !Array.isArray(payload['aud']))` — when `aud` is an **array**, the whole condition is false and the check is skipped; it never asserts `expectedAud ∈ aud`.
  - Issuer: the `iss` branch body is the literal comment `// Lenient issuer check` — a **no-op**; `iss` is never enforced.
  - Key select `keys.find(k => !header.kid || k.kid === header.kid)` picks the first key when the token omits `kid`.
- **Exploit path:** An attacker able to influence the ID token or the JWKS response (hostile IdP, compromised/typo'd `jwksUri`, or a downgraded key entry) presents a token with array `aud` or a non-RSA/EC JWK → accepted with no signature/issuer validation → forged `sub`/`email` → `onSuccess` authenticates as the victim.
- **Impact:** Federated authentication bypass / account impersonation.
- **Likelihood:** Medium — lower against well-known IdPs over TLS, but there is **no fail-closed defense-in-depth**.
- **Remediation:** Allow-list algorithms (`RS256`/`ES256`); fail closed if no signature branch executed; require `aud` to equal or contain `expectedAud`; enforce exact `iss`; validate `nbf`/`iat`/`nonce`. `node:crypto` only.
- **Effort:** Medium.

### AUTH-2 — MFA verify has no brute-force throttling/lockout and no TOTP step-reuse prevention — HIGH
- **Affected:** `packages/core/src/auth/mfa.ts` — `verifyTotp` (window default 1), `MfaService.verify`, `verifyMfaStepUp`, `mfaGuard`.
- **Evidence:** `verifyMfaStepUp` tries TOTP then recovery code with no attempt counter or lockout; `verifyTotp` records no "last consumed step," so an observed 6-digit code is replayable for ~90s (±1 window); recovery-code attempts are likewise unthrottled.
- **Exploit path:** An attacker who has the password loops codes against the step-up endpoint (≈3 valid codes in 10⁶ with ±1 window) or replays a captured TOTP within its window.
- **Impact:** MFA bypass (the second factor is defeated).
- **Likelihood:** High without an external limiter on the verify route.
- **Remediation:** Per-user attempt limiting + temporary lockout (reuse the existing `RateLimiter`/abuse store); persist last-consumed TOTP counter per user and reject reuse; cap recovery-code attempts.
- **Effort:** Medium.

### AUTH-3 — Stateless sessions carry no `exp` and no revocation → indefinite replay — HIGH
- **Affected:** `packages/core/src/security/session.ts` — `SessionData` (no `exp`), `decrypt()` (no time/revocation check).
- **Evidence:** `encrypt`/`decrypt` round-trip arbitrary JSON; nothing stamps issuance time and nothing validates expiry; there is no server-side store or revocation (extends prior F-A3).
- **Exploit path:** Any captured/leaked session blob (XSS exfil, log/backup leak) decrypts and authenticates **forever** until the global key is rotated; logout cannot invalidate it.
- **Impact:** Persistent session hijack; no logout/global revoke.
- **Likelihood:** Medium.
- **Remediation:** Embed `iat`/`exp` in `SessionData` and reject expired blobs in `decrypt`; add an optional key-epoch / `jti` + server-side store for revocation and rotation.
- **Effort:** Medium.

### AUTH-4 — Refresh JWT usable as access token — MEDIUM
- **Affected:** `services/user.service.ts` (`refreshToken = jwt.sign({ sub, type:'refresh' }, { expiresInSeconds: 86400*7 })`); `http/auth.middleware.ts` (`jwt.verify(token)` checks only `payload.sub`).
- **Evidence:** Both tokens share the secret and `sub`; the middleware ignores `type`, so the 7-day refresh JWT is accepted as a bearer access token.
- **Exploit path:** A leaked refresh token (longer-lived, broader exposure) is sent as `Authorization: Bearer` and grants API access for its full 7-day lifetime.
- **Impact:** Extended unauthorized access window.
- **Likelihood:** Medium.
- **Remediation:** Reject `type==='refresh'` in the auth middleware, or migrate to the opaque `RefreshTokenService` (already hashes + rotates).
- **Effort:** Low.

### AUTH-5 — `exp` not required; `iss`/`aud` not enforced by middleware — MEDIUM
- **Affected:** `security/jwt.ts` (`if (payload.exp !== undefined && payload.exp < now)`); `http/auth.middleware.ts` (`verify(token)` with no issuer/audience).
- **Exploit path:** A token minted without `expiresInSeconds` never expires; cross-audience reuse is undetected.
- **Impact:** Eternal tokens; weak token scoping. **Likelihood:** Medium.
- **Remediation:** Make `exp` mandatory in `verify`; thread `issuer`/`audience` through `authMiddleware`. **Effort:** Low.

### AUTH-6 — No rate limit / lockout on `/login` — MEDIUM
- **Affected:** `controllers/user.controller.ts` (`@Post('/login')` has `@Validate` but no rate limit); `UserService.login` (no failed-attempt tracking).
- **Evidence:** A capable sliding-window `RateLimiter` exists (`security/ratelimit.ts`) but is not wired to login/refresh/MFA.
- **Exploit path:** Unthrottled online password brute-force / credential stuffing.
- **Impact:** Account takeover. **Likelihood:** High if exposed. **Remediation:** Apply `rateLimit({ scope:'ip' })` + per-account counter and progressive lockout. **Effort:** Low.

### AUTH-7 — User enumeration via registration `409` — MEDIUM
- **Affected:** `services/user.service.ts` (`throw new ConflictException('Email already registered')`).
- **Evidence:** Registration returns a distinct 409 for existing emails (login itself is well-mitigated with uniform errors + dummy hash).
- **Exploit path:** Probe `/register` to enumerate registered emails. **Impact:** Account enumeration aiding targeted attacks. **Likelihood:** Medium.
- **Remediation:** Generic "check your email" response + out-of-band confirmation; rate-limit registration. **Effort:** Low.

### AUTH-8…11 — LOW
- **AUTH-8 (PBKDF2 work factor):** `HASH_ITERATIONS = 100_000` SHA-512 (`user.service.ts`) is ~half OWASP-2023 (≥210k). Raise, or migrate passwords to scrypt/argon2 with rehash-on-login. *Effort: Low.*
- **AUTH-9 (non-atomic rate limit):** `rateLimit()` does `count()` then `hit()` (`security/ratelimit.ts`); concurrent bursts can overrun the limit; Redis store is multi-command. Make check-and-increment atomic. *Effort: Low.*
- **AUTH-10 (cookie `Secure` outside prod):** `secure = options.secure ?? (NODE_ENV==='production')` (`core/context.ts`) sends cookies over plaintext if `NODE_ENV` is unset/misconfigured. Default `Secure` on, or tie to request scheme. *Effort: Low.*
- **AUTH-11 (recovery codes):** `randomBytes(5)` (~40-bit) stored as single unsalted SHA-256 (`auth/mfa.ts`). Increase to ≥80 bits and/or a slow KDF; relies on AUTH-2 throttling for online defense. *Effort: Low.*

---

## 4. Payments (MarzPay · Stripe · PayPal)

See `PAYMENTS-SECURITY-REVIEW.md` for the full provider-by-provider analysis. Summary findings:

### PAY-1 — Stripe webhook signature verification is a phantom control — HIGH
- **Affected:** `packages/cli/src/commands/create.ts` (`billing.controller.ts` overlay, `defaultVerifier()`), `packages/core/src/platform/plugins/official/stripe.ts` (`StripeClient`).
- **Evidence:** The controller calls `verifier.verify(rawBody, signature, secret, { tolerance: 300 })` and builds the verifier with `new StripeClient(config) as unknown as StripeWebhookVerifier`. But `StripeClient` exposes only `buildRequest` / `buildCreatePaymentIntent` / `post` — **there is no `verify` method**, and no HMAC/timestamp/constant-time code exists anywhere. The `as unknown as` cast hides this from the type-checker. Additionally, `rawBodyOf` reads `ctx.state.rawBody` which **nothing populates** (no raw-body middleware/route is emitted), and `BillingController` is never instantiated in `main.ts`.
- **Exploit path:** As shipped the call throws `TypeError`, is swallowed by `catch {}`, and returns 400 — so it is *fail-closed but non-functional*. The real risk: the documented "signature + 300s tolerance" control **does not exist in code**, so a developer enabling billing will either ship a non-working webhook or "fix" it by trusting the payload — defeating authenticity and enabling forged subscription events.
- **Impact:** Forged/replayed webhook events → unauthorized subscription state changes (entitlement fraud).
- **Likelihood:** Medium (latent; materializes when billing is wired).
- **Remediation:** Implement a real `StripeClient.verify` (HMAC-SHA256 over `t.payload`, constant-time compare, ≤300s tolerance, scheme `v1`), emit the raw-body middleware + `/webhooks/stripe` route, and instantiate the controller. Remove the `as unknown as` cast so the type system enforces the contract.
- **Effort:** Medium.

### PAY-2 — PayPal plugin performs no webhook authenticity verification — HIGH
- **Affected:** `packages/plugin-paypal/src/index.ts`.
- **Evidence:** The plugin is outbound-only: OAuth2 token + create-order request builders and a `node:https` sender. There is **no webhook handler, no `verify-webhook-signature` API call, no transmission-signature/cert-chain verification, and no order-capture confirmation**.
- **Exploit path:** Any integrator who confirms PayPal payments via webhooks using this plugin has no authenticity check — a forged webhook (or any POST to the handler they must hand-roll) is trusted.
- **Impact:** Payment spoofing / unverified order fulfillment.
- **Likelihood:** Medium (depends on integrator building confirmation on this plugin).
- **Remediation:** Add PayPal webhook verification (`/v1/notifications/verify-webhook-signature`) and an order-capture/verify path; document that inbound events MUST be verified server-side.
- **Effort:** Medium.

### PAY-3 — MarzPay overlay: no idempotency/replay store, no tenant binding — HIGH
- **Affected:** `packages/cli/src/commands/create.ts` (MarzPay `recordPayment`, `004_marzpay_billing.sql`), `packages/plugin-marzpay/src/index.ts`.
- **Evidence:** `recordPayment` is a bare `orgScopedRepo(...).insert(...)`; `billing_records` has **no UNIQUE on `reference`** and there is **no processed-event store/migration** (Stripe got `005_stripe_events.sql`; MarzPay's `004` has no equivalent). The webhook route is unauthenticated; `org_id` is **not** derived from the verified transaction (no `reference → org` lookup) — `orgScopedRepo` depends on `ctx.org`, which the webhook path cannot set safely. Note the current `validateWebhook` returns `false` unconditionally (no published MarzPay signature scheme), so the persist path is presently unreachable dead code — but the gaps are latent and will open the moment settlement is enabled.
- **Exploit path:** Once settlement is wired (the documented re-verify path), a duplicated/replayed webhook inserts the same settlement N times (no dedup), and tenant attribution is either broken or attacker-influenceable.
- **Impact:** Double-credited payments / inflated billing; potential cross-tenant write.
- **Likelihood:** Medium (latent until settlement enabled).
- **Remediation:** Add a `marzpay_events(reference PRIMARY KEY, processed_at)` store + UNIQUE on `reference`, dedup inside the insert transaction (mirror Stripe's `ProcessedEventStore`); derive `org_id` from the verified transaction and validate against the mapped org.
- **Effort:** Medium.

### PAY-4 — Cross-tenant write via attacker-influenceable mapping — MEDIUM
- **Affected:** `create.ts` `mapEventToSubscription` (`org_id = metadata.org_id ?? client_reference_id`).
- **Evidence:** `org_id` is taken from event `metadata.org_id` or `client_reference_id` with no check that the paying customer owns that org; `stripe_customer_id` is stored but never matched. `client_reference_id` is commonly attacker-settable at checkout creation.
- **Exploit path:** Attacker sets `client_reference_id` to a victim org id at checkout; the verified event then upserts the subscription onto the victim tenant.
- **Impact:** Cross-tenant subscription/billing manipulation. **Likelihood:** Low–Medium.
- **Remediation:** Bind org to the verified customer server-side (`stripe_customer_id → org` mapping established at subscribe time) and reject mismatches. **Effort:** Medium.

### PAY-5 — MarzPay unencoded path-segment interpolation — LOW
- **Affected:** `packages/plugin-marzpay/src/index.ts` (resource path built with interpolated identifiers, not `encodeURIComponent`).
- **Impact:** Limited same-host path/query injection (outbound host is fixed to `wallet.wearemarz.com`, so no cross-host SSRF). **Remediation:** `encodeURIComponent` path segments. **Effort:** Low.

> **Payment strengths (verified):** Stripe idempotency is atomic — `hasProcessed`/`recordProcessed` run inside the **same** `uow.transaction` as the subscription upsert, backed by `stripe_events(event_id PRIMARY KEY)` (migration 005). No monetary amount is taken from any webhook payload (MarzPay credits from a server-side `getTransaction` re-verify; Stripe applies only plan/status/customer/period). Outbound builders validate amount/currency. No secret leakage in errors/logs. PayPal defaults to sandbox and validates `environment ∈ {sandbox, live}`.

---

## 5. HTMX rendering

> **Strengths (verified):** Default `{{ }}` interpolation HTML-escapes; `csrfField` escapes name+value; no `eval`/`Function`; partial recursion is bounded (`MAX_PARTIAL_DEPTH = 16`); CRLF header injection is blocked at the Node HTTP layer. No CRITICAL/HIGH issue by default.

### HTMX-1 — Context-insensitive escaping → XSS in attribute/URL sinks — MEDIUM
- **Affected:** `packages/plugin-htmx/src/view-engine.ts` (`escapeHtml`, `renderTemplate`).
- **Evidence:** `escapeHtml` only replaces `& < > " '`. It is safe for element text and quoted attributes, but the engine is context-agnostic — a value interpolated into an **unquoted** attribute (`<div class={{x}}>`) or a URL attribute (`href="{{x}}"`) is not protected against `javascript:` URLs or attribute breakout via whitespace.
- **Exploit path:** A template author places `{{userValue}}` in an unquoted attribute or `href`/`src`; attacker supplies `x=foo onmouseover=alert(1)` or `javascript:…` → XSS.
- **Impact:** Stored/reflected XSS in server-rendered fragments. **Likelihood:** Medium (depends on template authoring).
- **Remediation:** Document that interpolation must be in quoted attributes/text; add optional context helpers (`attr`, `url`) that enforce quoting and scheme allow-listing. **Effort:** Low–Medium.

### HTMX-2 — `{{{ raw }}}` + `fragment()` raw passthrough — MEDIUM
- **Affected:** `view-engine.ts` (`{{{ path }}}` unescaped interpolation; `fragment(html)` returns input verbatim; `index.ts` `fragment()` helper).
- **Exploit path:** Untrusted data flowed through `{{{ }}}` or `helpers.fragment(userHtml)` is reflected unescaped into an HTMX swap → XSS. There is no guardrail or doc warning at the call site.
- **Impact:** Reflected XSS. **Likelihood:** Medium.
- **Remediation:** Document `{{{ }}}`/`fragment()` as trusted-content-only; consider a lint/runtime warning when raw output contains `<script`/event-handler patterns. **Effort:** Low.

### HTMX-3 — View/partial name resolution permits `../` → template traversal — MEDIUM
- **Affected:** `view-engine.ts` (`read()` joins `viewsDir + relNoExt + ext`; partial regex `[\w./-]+` permits `..`).
- **Exploit path:** If a controller passes a user-controlled page/partial name into `view()`/`partial()` (or `{{> ../../x }}`), the engine reads files outside `viewsDir` (with the configured ext), enabling template disclosure or unintended inclusion.
- **Impact:** Local file/template disclosure within `ext`; logic abuse. **Likelihood:** Low–Medium (requires user-controlled view name).
- **Remediation:** Reject names containing `..`/absolute segments; resolve and assert containment within `viewsDir`. **Effort:** Low.

### HTMX-4 — `HX-Redirect`/`HX-Location` set verbatim → open redirect — MEDIUM
- **Affected:** `packages/plugin-htmx/src/htmx.ts` (`hxHeaders`).
- **Exploit path:** A handler that reflects user input into `hx({ redirect })`/`{ location }` yields a client-side redirect to an attacker URL (CRLF is blocked by Node, so no header injection — open redirect only).
- **Impact:** Open redirect (phishing). **Likelihood:** Low–Medium. **Remediation:** Validate redirect targets against an allow-list / same-origin. **Effort:** Low.

### HTMX-5 — No automatic CSRF integration for HTMX mutations — MEDIUM
- **Affected:** `packages/plugin-htmx/src/index.ts` (middleware), `htmx.ts` (`csrfField` is manual).
- **Exploit path:** HTMX `hx-post/hx-put/hx-delete` flows are not automatically wired to the core CSRF middleware; a developer relying on cookie auth without manually adding `csrfField`/a header token is CSRF-exposed.
- **Impact:** CSRF on state-changing HTMX requests. **Likelihood:** Medium. **Remediation:** Provide a documented helper that injects the CSRF token into HTMX requests (e.g., `hx-headers` meta), and document the integration. **Effort:** Low.

### HTMX-6 — Escaper inconsistency with core — LOW
- The plugin escaper covers 5 chars; the core sanitizer differs slightly. Align to a single escaping policy to avoid surprises. **Effort:** Low.

---

## 6. Plugin signing infrastructure

See `PLUGIN-SIGNING-REVIEW.md` for the full analysis. Summary findings beyond PS-1/PS-2:

### PS-3 — Single signing key, no `keyId`/rotation/revocation — MEDIUM
- **Affected:** `packages/core/src/platform/plugins/official-key.ts` (single embedded `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM`), `host.ts` (manifest has no `keyId`/`alg`), `signManifest`/`verifyManifest`.
- **Exploit path / impact:** If `STREET_PLUGIN_SIGNING_KEY` (CI secret) leaks, an attacker can sign manifests that pass `officialPluginPublicKey()` until a new core version embedding a new key is published **and adopted by every consumer**; deployed hosts cannot revoke the old key.
- **Likelihood:** Low (key is CI-secret only). **Impact:** Ecosystem-wide if it leaks.
- **Remediation:** Add an optional `keyId` to the canonical body; let the host hold a **set** of trusted keys (enables overlap/rotation/revocation without an API break); document a rotation runbook; evaluate Sigstore keyless.
- **Effort:** Medium.

### PS-4 — Non-strict manifest schema can drift from the signed body — MEDIUM
- **Affected:** `host.ts` (`pluginManifestSchema` is non-strict; `canonicalManifest` serializes a fixed 5 keys).
- **Evidence:** All currently-defined security fields (`capabilities`, `permissions`, `dependencies`) **are** in the signed body (strength). But the schema tolerates unknown keys while `canonicalManifest` is fixed — any future security-relevant field added to the manifest but not to `canonicalManifest` would be **unsigned and tamperable**.
- **Impact:** Latent signature-coverage gap. **Likelihood:** Low.
- **Remediation:** Make the schema `.strict()` or derive the canonical body from the schema's keys; add a test asserting every signed field (except `checksum`/`signature`) is in the canonical body. **Effort:** Low.

### PS-5 — `registry-server` trusts publisher-supplied public key — INFORMATIONAL
- The server verifies each manifest against the **publisher's own** submitted `publicKeyPem` (trust bound to authn+namespace authz). Consumers must pin `officialPluginPublicKey()` (or a known publisher key) out-of-band — a consumer that trusts the registry-echoed key gains no authenticity guarantee. Document this explicitly. **Effort:** Low.

> **Signing strengths (verified):** `canonicalManifest` covers all privilege-relevant fields (deterministically sorted); `verifyManifest` signs/verifies over the **recomputed** checksum (not the supplied `m.checksum`), so body-swap forgeries fail; `cryptoVerify(null, …)` precludes algorithm confusion on Ed25519; the private key is CI-only (sign scripts abort on an ephemeral key); CI re-verifies the **packed** manifest against the official key and publishes with `--provenance`; manifests are deep-frozen at `register()` (prior F-P4 fixed).

---

## 7. npm publish pipeline & GitHub Actions

> **Strengths (verified, repo-wide):** No `pull_request_target`/`workflow_run` anywhere (classic escalation pattern absent). No `${{ github.event.* }}` interpolated into `run:` — untrusted inputs are bound via `env:` and referenced as quoted shell vars (`transfer-npm-owner.yml`, `ci-cd-enforcement.yml`, `publish-plugins.yml`). All third-party actions pinned to full commit SHAs (`checkout@df4cb1c…`, `setup-node@a0853c2…`, `scorecard-action@4eaacf0…`, `codeql-action@8aad20d…`, `cosign-installer@dc72c7d…`). Least-privilege: top-level `contents: read`, write scopes only on the jobs that need them; `persist-credentials: false` on every checkout. npm `--provenance --access public` with job-level `id-token: write`, `registry-url` set, and a **post-publish attestation-verification gate**. Publish is not fork/PR-reachable. Defense-in-depth: zizmor, CodeQL (incl. actions), Scorecard, Gitleaks + TruffleHog, dependency-review (fail-high + copyleft denylist), cosign keyless release signing.

### CI-1 — `transfer-npm-owner` auto-adds npm co-owners with no approval gate — MEDIUM
- **Affected:** `.github/workflows/transfer-npm-owner.yml`.
- **Evidence:** `workflow_dispatch` with a `username` input runs `npm owner add "$NEW_OWNER" "@streetjs/$p"` across 8 packages using `NPM_TOKEN`. Input is correctly env-bound (no injection), but anyone able to dispatch the workflow can grant **persistent npm co-ownership** of release packages.
- **Exploit path:** A compromised/over-permissioned maintainer account dispatches the workflow adding an attacker npm account as co-owner → durable publish rights surviving token rotation.
- **Impact:** Supply-chain takeover persistence. **Likelihood:** Low.
- **Remediation:** Require a protected `environment` with required reviewers; restrict the input to an allow-list of vetted usernames; use an owner-management-scoped token. **Effort:** Low.

### CI-2 — Publish runs on every push to `main` — MEDIUM
- **Affected:** `.github/workflows/ci-cd.yml` (`test-and-publish` `if:` includes `github.ref == 'refs/heads/main'`).
- **Evidence:** Publishing is gated by an idempotency check (skip versions already on npm) rather than by tag/release. A malicious or accidental version bump merged to `main` publishes immediately.
- **Impact:** Unintended/forced release. **Likelihood:** Low (protected `main` + review). **Remediation:** Restrict publish to semver tag pushes / GitHub Releases behind a protected environment. **Effort:** Low.

### CI-3…CI-5 — LOW
- **CI-3:** Publish steps treat `E403`/`E409` as "already published" success, masking real auth/permission failures — match only `E409`/"cannot publish over". *Effort: Low.*
- **CI-4:** `provider-integration.yml` sets process-wide `NODE_TLS_REJECT_UNAUTHORIZED='0'` (scoped to a local emulator, PR-triggered, no secrets). Scope it to the emulator client only. *Effort: Low.*
- **CI-5:** Some `pull_request` workflows reference secrets (KEK/JWT_SECRET/SESSION_KEY/PG_PASSWORD); safe **only** while fork PRs receive no secrets — keep the "require approval for fork workflows" repo policy enforced. *Effort: Low (policy).*

---

## 8. Starter generation

> **Strengths (verified):** Project name is regex-validated (`/^[a-z0-9][a-z0-9_-]*$/i`) — blocks `../`/absolute paths and template-injection breakout. Generated source uses `JSON.stringify` + validated interpolation. Only `.env.example` placeholders are written (no real secrets). Generated production startup fails fast on wildcard CORS / missing secrets. Generated repos use parameterized SQL and `permissions: contents: read` CI.

### GEN-1 — Generated `street.config.ts` ships hardcoded fallback secrets — MEDIUM
- **Affected:** `packages/cli/src/commands/create.ts` (`renderStreetConfig`): `jwtSecret: process.env['JWT_SECRET'] ?? 'change-me-in-production'`, `sessionKey: process.env['SESSION_KEY'] ?? 'change-me-session-key'`.
- **Evidence:** The real entrypoint (`renderMainTs`) uses a fail-fast `resolveSecret`, so these literal fallbacks are an inconsistent trap that propagates to every scaffolded app's config and can silently boot with a known signing/session key.
- **Exploit path:** A developer runs the app without setting `JWT_SECRET`/`SESSION_KEY`; tokens/sessions are signed/encrypted with a **publicly known** literal → forgeable sessions/JWTs.
- **Impact:** Authentication/session forgery in any deployment that relies on the fallback. **Likelihood:** Medium.
- **Remediation:** Remove the literal fallbacks; fail fast (or generate a per-project random secret written to `.env`) consistently with `renderMainTs`. **Effort:** Low.

### GEN-2 — Caret-ranged dependencies; fail-soft lockfile — LOW
- Generated `package.json` uses `^` ranges and lockfile generation is skippable/fail-soft. Pin exact versions or always emit a committed lockfile to harden downstream supply chain. **Effort:** Low.

### GEN-3 — `spawn(..., { shell: true })` — LOW
- `generateLockfile`/`installDependencies` use `shell: true`. Args are static and the project name is regex-validated, so **not injectable today**; drop `shell: true` for defense-in-depth. **Effort:** Low.

---

## 9. ORM & AI (coverage notes)

- **AI-1 (INFORMATIONAL):** AI tool-calling / prompt-injection guardrails (`@streetjs/ai`, the `ai-assistant` reference app) were **not** re-verified this pass. Flagged for a dedicated review (tool allow-list + per-tool authz, no secrets in prompts/logs, output/rate bounds, retrieval sanitization).
- **ORM:** Parameterized queries and `orgScopedRepo` tenant scoping remain the verified baseline; the recommended property-based SQL-injection sweep (prior F-ORM1) is still a worthwhile CI regression gate.

---

## 10. Remediation status of the prior (Q1) audit

| Prior ID | Title | Status (verified) |
|---|---|---|
| F-A1 | Secure-by-default cookie flags | **Fixed** (`serializeCookie` defaults HttpOnly/Secure-in-prod/SameSite=Lax) |
| F-A2 | `setCookie` multi-cookie append | **Fixed** (array append) |
| F-R1 | WS unauthenticated default | **Fixed** (production startup warning) |
| F-R2 | WS Origin validation (CSWSH) | **Fixed** (`allowedOrigins` + same-origin default gate) |
| F-P3 | Manifest schema validation | **Fixed** (`pluginManifestSchema` gate) |
| F-P4 | Manifest TOCTOU / freeze | **Fixed** (deep-frozen clone at register) |
| F-P5/F-P2 | Trust-model documentation | **Fixed** (docs/plugins.md trust model) |
| F-PAY4 | Stripe idempotency migration | **Fixed** (`005_stripe_events.sql`) |
| F-P1 | Default-open plugin host | **Open** → now PS-2 (installer) + host default still opt-in |
| F-PAY1/F-PAY2 | MarzPay idempotency/replay | **Open** → PAY-3 |
| F-PAY5 | Webhook→tenant binding | **Open** → PAY-4 / PAY-3 |
| F-R3/F-R4/F-R5 | WS rate limit / frame schema / channel authz | **Open** (medium roadmap) |
| F-A3 | Session revocation | **Open** → AUTH-3 (now with no-expiry detail) |
| F-SC1 | Signing key rotation | **Open** → PS-3 |
| F-AI1 | AI review | **Open** → AI-1 |
| F-CI1 | Bus factor | **Open** (organizational) |

---

## 11. Verify-don't-invent notes

- The Stripe `verify` method is **absent** in source (`StripeClient` has no such method); this is stated as a phantom/cast-hidden control, not asserted as a working-but-broken crypto routine.
- PayPal has **no** inbound verification code to audit — reported as absent, not as weak.
- MarzPay's missing webhook signature scheme is a **vendor** gap; the framework's `validateWebhook` correctly returns false. The framework gaps (idempotency, tenant derivation, dead trust-path wiring) are distinct and reported as such.
- The zip-slip (PS-1) and default-open installer (PS-2) were confirmed by reading `registry.ts._extractTarball`/`install` directly.
- No CRITICAL was fabricated to inflate severity: the single CRITICAL (PS-1) is a conventional archive-extraction arbitrary-file-write, reachable without signature in the default-open installer path.
