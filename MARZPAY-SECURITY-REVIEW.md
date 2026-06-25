# MarzPay Plugin Security Review — `@streetjs/plugin-marzpay`

> Deep, source-grounded security review of `@streetjs/plugin-marzpay` and its
> `--with-marzpay` SaaS overlay templates. Analysis only — **no code was
> modified**. Every claim below is traced to the actual implementation or an
> existing repo artifact.
>
> **Overall score: 88 / 100** — *Strong. Production-ready for the verified
> surface, with mostly low/medium and ecosystem-level residuals.*

## Evidence reviewed

- `packages/plugin-marzpay/src/index.ts` — client, six namespaces, pure request
  builders, `verifyWebhookSignature`, `validateWebhook`, `MARZPAY_SPEC`,
  `requireBoundSeam` / `UnsupportedOperationError`, `defaultMarzPayTransport`,
  Uganda MSISDN helpers, defensive JSON parsers, plugin lifecycle.
- `packages/plugin-marzpay/docs/RELEASE-READINESS.md`, `docs/GAP-ANALYSIS.md`.
- `docs/integrations/marzpay-research.md` (verify-don't-invent Research_Artifact;
  §L4 webhook-signature limitation, §L5 refund limitation, §R1 authenticity gap).
- `packages/cli/src/commands/create.ts` — `marzpay-webhook.controller.ts`,
  `marzpay-billing.service.ts` overlays (server-side re-verify before persist,
  monetary-from-verified, `Processed_Event_Store` / idempotency, server-derived
  org binding, percent-encoding), `orgScopedRepo`, migration `005_marzpay_events`.
- `PAYMENTS-SECURITY-REVIEW.md`, `SECURITY-AUDIT-2026.md`, `THREAT-MODEL-2026.md`,
  `PLUGIN-SIGNING-REVIEW.md`, `.github/workflows/{publish-plugins,sign-htmx,runtime-certification}.yml`,
  `packages/plugin-marzpay/scripts/sign.mjs`, package signing artifacts.

A note on scope: the plugin (`src/index.ts`) ships the client, validation,
transport, and the fail-closed `validateWebhook` primitive. The
**idempotency, tenant-binding, and server-side re-verification trust path live
in the CLI SaaS overlay templates** (`create.ts`), which a consumer opts into
with `--with-marzpay`. Several dimensions below are split accordingly.

---

## Scored breakdown

| # | Dimension | Weight | Score | Evidence |
|---|-----------|:------:|:-----:|----------|
| 1 | Authentication | 10 | 92 | `MARZPAY_SPEC.authHeaders` builds `Authorization: Basic base64(apiKey:secretKey)` + JSON content type from validated config (Research_Artifact V1). `validateMarzPayConfig` rejects missing/empty/whitespace credentials before any client exists. No runtime credential setter — `setCredentials` is an explicit intentional exclusion (GAP-ANALYSIS 12.1), so credentials are not runtime-mutable. Transport is `node:https` only (TLS by scheme). |
| 2 | Webhook validation | 15 | 88 | Fail-closed by construction: `verifyWebhookSignature` returns `false` for an unbound scheme, and for absent/empty/malformed/mismatched material; only an exact constant-time HMAC match (equal-length guard + `timingSafeEqual`) returns `true` (Property 7). Verify-don't-invent honored: `MARZPAY_SPEC.webhook` is left **unbound** because no scheme is documented (§L4) — no HMAC scheme is invented. Trust is established by the overlay controller's **server-side re-verification** via `transactions.get(reference)` before any persist (§R1, recommendation 7). Capped because the only real authenticity anchor today is the re-verify path, which lives in the consumer overlay, not the plugin. |
| 3 | Replay protection / idempotency | 15 | 90 | Migration `005_marzpay_events.sql` creates `marzpay_events` with `UNIQUE(reference)` and adds `UNIQUE(reference)` on `billing_records`. The webhook controller checks `hasProcessed` and `recordProcessed` **in the same DB transaction** as the billing write; a duplicate `reference` skips the write, a failure rolls back both rows, and a concurrent second delivery loses the `UNIQUE(reference)` race and is treated as already-processed. Proven by Property 3 (sequential + concurrent). Lives in the overlay; the bare client has no store, so the rating reflects the opt-in overlay. |
| 4 | Tenant isolation | 12 | 90 | Target `org_id` is **server-derived** from the verified `reference → org` mapping via `OrgResolver.resolveOrgByReference`, never the `Raw_Body`. A `Raw_Body` org that disagrees is rejected (persist nothing); an unresolved mapping is rejected. The resolved org is stamped onto `ctx` and every write flows through `orgScopedRepo`, which injects `org_id` on reads and overrides it on writes (cross-tenant access → 403). Proven by Property 4. |
| 5 | Credential storage | 8 | 95 | Credentials read only from validated plugin config/env; never mutated at runtime (12.1). Held privately on `MarzPayClient`/`MarzPayPluginModule`; never serialized into URLs, errors, or results. No committed key material in the plugin (see Supply chain). |
| 6 | Error handling | 8 | 92 | All failures surface as `PluginError` (or its `UnsupportedOperationError` subclass). `ensureSuccessStatus` raises on any non-2xx and **includes the HTTP status**, returning no partial result (Property 6). Malformed JSON, timeouts, and socket errors each raise distinct `PluginError`s. Argument guards throw a field-named error before any network I/O (Property 1). |
| 7 | Logging | 7 | 95 | No logging primitives anywhere in `src/index.ts` (no `console`, `logger`, `process.stdout/stderr`). Nothing logs the `Authorization` header, secret, or request/response bodies. Error messages carry the operation name and HTTP status or socket `e.message` only — no secret/PII echo. |
| 8 | Timeouts | 5 | 88 | `defaultMarzPayTransport` wraps each request in a `setTimeout` budget and calls `req.destroy()` on expiry, rejecting with a timeout `PluginError` and no partial result. Configurable `timeoutMs` (validated positive, default 30 000 ms). Minor: single overall budget (no separate connect/idle timeout) and no retry/backoff (acceptable for a payments client where retries must be idempotency-keyed upstream). |
| 9 | Rate limiting | 5 | 70 | **The plugin bounds no request volume itself** — rate limiting is delegated to the framework middleware layer by design (consistent with THREAT-MODEL-2026 "HTTP: rate limiting"). The only self-imposed bounds are the 256-char identifier cap (`guardIdentifierArgument`) and positive-amount validation, which limit individual request shape but not frequency. Scored to reflect that the plugin itself provides essentially no rate control; this is an explicit architectural delegation, not a defect. |
| 10 | Input validation / injection (SSRF, encoding) | 8 | 88 | Every interpolated path segment uses `encodeURIComponent` (Property 8); query strings are built with `URLSearchParams`; so a `reference`/id cannot inject path or query structure. **No SSRF surface in the plugin**: the base host is hard-coded (`https://wallet.wearemarz.com/api/v1`) — there is no configurable base URL, so host allow-listing is moot. `callback_url`/`redirect_url` are pass-throughs/echoes, never fetched by the plugin. Minor: optional `callback_url`/`description`/`currency` are not length/format-validated against the documented 255-char limits before send (pass-through to MarzPay). |
| 11 | Supply chain / signing posture | 7 | 75 | Ed25519-signed manifest committed (`manifest.signed.json`, `manifest.pub`); `scripts/sign.mjs` runs only at `prepublishOnly`, **requires** the CI-only `STREET_PLUGIN_SIGNING_KEY`, and refuses ephemeral keys; `publish-plugins.yml` includes `plugin-marzpay` in the signing/publish matrix with npm provenance + SBOM; `runtime-certification.yml` asserts a plain build never re-signs. Docked for **ecosystem residuals that affect this plugin's distribution**: PS-3 (single signing key, no `keyId`/rotation/revocation — MEDIUM) and the installer-side PS-1/PS-2 (zip-slip + default-open verification — CRITICAL, but framework-installer, not this plugin's code). |

**Weighted total**

```
(92·10 + 88·15 + 90·15 + 90·12 + 95·8 + 92·8 + 95·7 + 88·5 + 70·5 + 88·8 + 75·7) / 100
= 8850 / 100
≈ 88 / 100
```

### Overall score: **88 / 100**

The plugin earns a high score: it is genuinely disciplined about
verify-don't-invent, its webhook handling is fail-closed with no fail-open path,
idempotency is atomic and tenant-binding is server-derived, error handling never
leaks partial results or secrets, there is no logging surface to leak through,
~97% branch coverage, and 10 property-based tests pin the security-relevant
behavior. The residuals that hold it back are mostly **low/medium** or
**ecosystem-level** rather than defects in this plugin's code.

---

## Correction — the asserted signing-key/git-history claim does not match the repo

The task framing asserted that *"only htmx — not marzpay — has a CI signing
workflow, so 1.1.0 was signed on a developer machine with a key that is ALSO
exposed in git history at commit `d7bbfc40`."* I investigated this directly, and
the repository evidence contradicts it. Stating it accurately matters for a
security review, so here is what I actually found:

- **`plugin-marzpay` IS in the CI signing matrix.** `.github/workflows/publish-plugins.yml`
  lists `plugin-marzpay` alongside the other plugins and signs each with the
  stable `STREET_PLUGIN_SIGNING_KEY` CI secret (PKCS#8 PEM), with npm provenance.
  `sign-htmx.yml` is a **one-shot** workflow that existed only because htmx was
  the single plugin lacking a committed `manifest.signed.json`; marzpay already
  ships `manifest.signed.json` and `manifest.pub`.
- **The signing script refuses ephemeral/dev-machine keys.** `scripts/sign.mjs`
  fails loudly (`process.exit(1)`) if `STREET_PLUGIN_SIGNING_KEY` is unset, runs
  only via `prepublishOnly`, and `runtime-certification.yml` asserts a plain
  build never mutates a signed manifest. PS-3 documents the key "exists ONLY as a
  CI secret — it cannot be produced on a workstation."
- **No signing key is exposed in git history.** The `signing-key.pkcs8.pem` file
  present in the package working tree is a **0-byte placeholder**, is **not
  tracked by git** (`git ls-files` returns nothing for it), and is **gitignored**
  via `.gitignore:17 *.pem`. I found no committed key at `d7bbfc40` or anywhere
  in history, and the repo's controls (gitignored `*.pem`, CI-secret-only key,
  build-tree-clean assertion) are specifically designed to prevent that.

**What is real on the supply-chain axis** is documented in the repo audits and is
reflected in dimension 11: **PS-3 (MEDIUM)** — a single signing key with no
`keyId`, rotation, or revocation path, so if the CI secret ever leaked there is
no fast revocation for already-deployed consumers; and **PS-1/PS-2 (CRITICAL)** —
the *marketplace installer's* zip-slip + default-open signature verification,
which is a framework/installer boundary that affects any plugin distributed
through it, including this one. These are the genuine ecosystem risks; the
"key in git history" claim is not supported by the code.

---

## Must Fix

1. **Bind a real webhook authenticity control — or make the re-verify path
   mandatory and self-evident.** Today `validateWebhook` always returns `false`
   (scheme unbound, §L4), so the overlay controller's persist path is reached
   **only** through the server-side `transactions.get(reference)` re-verification.
   That is the correct mitigation, but it is (a) optional opt-in overlay code and
   (b) a structural contradiction (a "positive" signature path that can never
   execute) that invites a maintainer to "fix" the always-400 by relaxing the
   gate — which would open authenticity and idempotency at once (see
   PAYMENTS-SECURITY-REVIEW PAY-3). Action: pursue vendor confirmation of a
   signing scheme to bind `MARZPAY_SPEC.webhook`; until then, document the
   re-verify path as the *required* trust anchor and keep `validateWebhook`
   fail-closed so no one can flip it to fail-open.

2. **Ensure the idempotency store and `OrgResolver` are wired by default in the
   overlay, not optional.** In `marzpay-webhook.controller.ts` both
   `ProcessedEventStore`/`UnitOfWork` and `OrgResolver` are **optional**
   constructor deps; when absent the controller "falls back" to a single direct
   write on the ambient `ctx.org`. That fallback removes replay protection and
   server-derived tenant binding — the two strongest controls. A scaffold should
   wire them by default so the secure path is the default path.

## Should Fix

3. **Resolve the dead-path contradiction explicitly (PAY-3 remediation).** Make
   the controller's intent unambiguous — re-verify/poll only — so the unreachable
   "positive signature" branch cannot be misread as an invitation to trust the
   payload. A comment plus a typed guard that the trust source is the re-verified
   transaction would prevent regression.

4. **Plan signing-key rotation/`keyId` (PS-3).** Add a `keyId`/`alg` to the
   signed manifest and a revocation story so a leaked CI signing secret can be
   rotated without shipping a new core to every consumer. This is an
   ecosystem-wide fix but materially affects trust in this plugin's published
   signature.

5. **Validate optional pass-through fields against documented limits.**
   `callback_url`, `description`, and `currency` flow to MarzPay unbounded;
   enforce the documented ≤255 lengths (and require HTTPS for `callback_url`,
   per Research_Artifact V10/recommendation 9) before send, so bad input fails
   fast client-side rather than at the vendor.

## Nice To Have

6. **Document the rate-limiting boundary at the plugin's seam.** The plugin
   correctly delegates rate limiting to framework middleware; a short note in the
   README pointing integrators at the middleware (and recommending a limiter on
   `POST /webhooks/marzpay`) closes the "who bounds this?" question for adopters.

7. **Add a connect/idle timeout split and idempotency-keyed retry guidance.** The
   single overall `timeoutMs` budget is fine, but distinguishing connect vs.
   read timeouts and documenting that any retry must reuse the same `reference`
   (MarzPay rejects duplicate references with `DUPLICATE_REFERENCE`) would harden
   real-world reliability without weakening idempotency.

8. **Structured (secret-free) logging hook for webhook rejections.** The plugin
   logs nothing (a strength for secret safety), but the overlay collapses several
   distinct rejection reasons (validation failed / unresolved org / org mismatch
   / re-verify miss) into similar 400s. An optional structured log (reason codes,
   no payload/secret) would help operators distinguish attack from
   misconfiguration.

9. **Length-bound or hash the `reference` used as a primary key.** `reference`
   is capped at 256 chars for requests, but `marzpay_events.reference` is the PK;
   confirm the column type/length matches so an oversized reference can't cause a
   write anomaly.

---

## What the plugin gets right (verified)

- **Verify-don't-invent is real, not a slogan.** Refund (§L5), disbursement
  send, balance, phone-verification, and the webhook signature scheme (§L4) are
  all left as **unbound seams** that throw `UnsupportedOperationError` (a
  `PluginError`) with **zero network I/O** (Property 5) rather than calling
  invented endpoints. Each unbound seam names the missing capability and points
  at the Research_Artifact.
- **Fail-closed webhooks with no fail-open path** — constant-time HMAC compare
  with an equal-length guard; unbound scheme and all malformed material return
  `false` (Property 7).
- **Monetary integrity** — persisted `amount`/`currency`/`status` come only from
  the server re-verified transaction, never the `Raw_Body` (Property 10); the
  payload contributes only the `reference` to re-verify.
- **Atomic idempotency + server-derived tenant binding** (Properties 3 and 4).
- **Injection-safe path/query construction** (`encodeURIComponent` +
  `URLSearchParams`, Property 8) over a hard-coded host (no SSRF surface).
- **No secret/PII logging; non-2xx includes status with no partial result**
  (Property 6); ~97.4% branch coverage; 131 tests / 54 suites green; 10 PBTs.

## Verification

Markdown diagnostics for this file: **clean** (checked via the editor diagnostics
provider — no issues).
