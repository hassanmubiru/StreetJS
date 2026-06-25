# StreetJS Official Plugin Security Standard

> The mandatory security baseline every `@streetjs/plugin-*` package must meet
> before publication. Enforced by CI (`block-private-keys.yml` `verify-signing-anchor`,
> `publish-plugins.yml` signature verification, and `security-baseline.yml`).
> Detailed per-plugin findings live in `security/PLUGIN-SECURITY-AUDIT.md`.

## 1. Required files (per plugin)

| File | Required | Status (VERIFIED) |
|---|---|---|
| `README.md` | ✅ | present in all 21 |
| `package.json` (with `"license": "MIT"`) | ✅ | present in all 21 |
| `manifest.json` | ✅ | present in all 21 |
| `manifest.signed.json` (Ed25519 signed; note: actual name, not `signed-manifest.json`) | ✅ | present in all 21 |
| `manifest.pub` (SPKI public key matching the official anchor) | ✅ | all 21 match anchor `3ae9add0` |
| `LICENSE` | ✅ | **added in Phase 2** to all 21 (was missing) |
| `SECURITY.md` (reporting pointer) | ✅ | present in all 21 |

## 2. Secret-handling rules
- Credentials come **only** from validated plugin config/env; never runtime-mutable
  (no `setCredentials`), stored `private readonly`.
- **No secret ever logged or thrown** — no `console`/logger of apiKey/secret/token/
  authorization; error messages carry operation + HTTP status only.
- No secret in URLs, results, or serialized state.
- No `*.pem`/`*.key` or `.env` in the package; signing key only in CI secret.

## 3. Webhook validation rules
- Verifiers must use constant-time comparison (`timingSafeEqual`) with an
  equal-length guard; **fail-closed** (absent/empty/malformed → reject).
- If the provider documents no signature scheme (e.g. MarzPay, Africa's Talking),
  the plugin must **not invent one** — leave the scheme unbound and require
  server-side re-verification / shared-secret in the consumer overlay, documented
  as the trust anchor.
- Providers that DO sign webhooks (Stripe, Twilio, PayPal, SendGrid) **should** ship
  a verifier (current gap — see PLUGIN-SECURITY-AUDIT.md).

## 4. Network / SSRF / resilience rules
- Outbound calls **must** enforce a bounded timeout (`AbortController` or
  `setTimeout`+`destroy`). (Current gap: 9 `node:https` plugins lack timeouts.)
- Configurable host/baseURL plugins **should** validate scheme (https-only) and
  **should** allow-list or block link-local/metadata ranges (`169.254.0.0/16`,
  `metadata.google.internal`).
- Hardcoded-host plugins must percent-encode interpolated path/query segments.
- Retries, if any, must be bounded and must not risk double-charge for payments.

## 5. Signing requirements
- Every plugin manifest is Ed25519-signed in CI with `STREET_PLUGIN_SIGNING_KEY`
  and must verify against `officialPluginPublicKey()`
  (`packages/core/src/platform/plugins/official-key.ts`).
- `manifest.pub` must equal the embedded official anchor (CI-enforced by
  `verify-signing-anchor`). No per-plugin ad-hoc keys.
- The signing private key never touches a workstation — CI-only.

## 6. Release requirements
- Publish **only** via `publish-plugins.yml` (CI); no local `npm publish`.
- npm provenance (`--provenance`) required; publish is idempotent.
- `prepublishOnly` signing is fail-closed (refuses ephemeral keys).
- Version bumped, changelog updated, tests + coverage green before publish.

## 7. Compliance checklist (gate before first publish)
- [ ] All §1 files present.
- [ ] No secrets logged (grep `console`/`logger` clean).
- [ ] Outbound timeout enforced.
- [ ] Webhook verifier fail-closed (or documented provider gap + re-verify path).
- [ ] `manifest.pub` matches official anchor.
- [ ] Published through CI with provenance.
