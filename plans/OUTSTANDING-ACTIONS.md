# StreetJS — Outstanding Actions (Master Register)

> Single consolidated to-do aggregating every open item across all audit, security,
> and governance docs. Owner tags:
> **[OPERATOR]** platform/destructive (GitHub settings, history, secrets) ·
> **[MAINTAINER]** repo edit (docs/config, non-runtime) ·
> **[RUNTIME]** plugin/core code change (out of governance scope — separate PR).
>
> Everything below is what remains; all governance/organization/CI/docs hardening
> already applied is recorded in `audits/ENTERPRISE-AUDIT.md` (canonical) and the
> `CHANGELOG.md` `[Unreleased]` section.

## ✅ Completed since this register was created (verified)
- **#10 app-\* → `examples/scaffold-*`** — moved; `zizmor.yml` + `dependabot.yml` updated; no functional refs left.
- **#11 SEO files** — `BingSiteAuth.xml` / `googledf*.html` **removed** from the repo + dropped from the root allowlist. *(Operator: re-add them in the website repo.)*
- **#16 Compose ports** — all 11 host ports bound to `127.0.0.1`; `docker compose config` validates all 6.
- **#23 `prereqs.mjs` cloudflare path** — fixed to `infra/examples/cloudflare/wrangler.toml`.
- **Operator tooling generated:** `.github/repository-settings.json`, `security/KEY-ROTATION-CHECKLIST.md`, `security/KEY-EMERGENCY-RUNBOOK.md`, `security/SECRET-SCANNING-GUIDE.md`.
- **Supply chain:** `scripts/security/verify-release.mjs` + `npm run verify:signatures` (21/21 verified).
- **Report consolidation:** `audits/REPORT-INDEX.md` (canonical map); `PHASE-20-COMPLETION-REPORT.md` archived.
- **#6 (partial) Support matrix** — `docs/enterprise/support-matrix.md` created (version support + backport + platform/runtime matrix). *Remaining: commercial-support SLA tiers (operator, only if a commercial offering exists).*
- **Foundation readiness** — `governance/DECISION-PROCESS.md` created (roles, lazy consensus, RFC workflow, voting/escalation, neutrality). *Remaining gating items: multi-org neutral maintainership + trademark policy (operator/community).*
- **#22 CI `retention-days` + `concurrency` standardized** — all 38 workflows now declare a top-level `concurrency` group (`<workflow>-${{ github.ref }}`; `cancel-in-progress: true` for PR/push verification + security gates, `false` for release/deploy/admin/soak); all 21 `upload-artifact` steps now set `retention-days` (coverage 14, evidence/verification 30, release/SBOM/signed/cert 90, SARIF 5). Validated: 38/38 YAML parse clean.
- **Operator P0 runbook** — `security/OPERATOR-EXECUTION-CHECKLIST.md` created: sequenced, copy-paste `gh` commands for branch/push protection, secret-scanning, history purge, key relocation, signed commits, PGP key (references the per-topic reviews, no duplication).

## P0 — Critical
| # | Action | Owner | Source | Done when |
|---|---|---|---|---|
| 1 | ✅ **Done (operator-verified 2026-06-27)** — branch protection on `main`: 11 required checks, `require_code_owner_reviews: true`, `required_approving_review_count: 1`, `required_linear_history: true`, `allow_force_pushes: false`, `enforce_admins: false` (set false so the **solo** admin can merge own PRs — GitHub forbids self-approval; re-enable once a 2nd maintainer exists, item #28). *(Live set = 11 verified-present checks; security-workflow contexts in `repository-settings.json` to be added after they report on a PR.)* | [OPERATOR] | `security/BRANCH-PROTECTION-REVIEW.md`, `OPENSSF-REVIEW.md`, `SLSA-ASSESSMENT.md` | Settings applied + a blocked direct push confirms |
| 2 | ✅ **Done (operator-verified 2026-06-27)** — Secret Scanning + Push Protection + Dependabot security updates enabled. Evidence: `gh api repos/hassanmubiru/StreetJS --jq '.security_and_analysis'` → `secret_scanning`, `secret_scanning_push_protection`, `dependabot_security_updates` all `enabled`. *(Optional, still off: `secret_scanning_non_provider_patterns`, `secret_scanning_validity_checks`.)* | [OPERATOR] | `OPENSSF-REVIEW.md`, `TRUST-CENTER.md` | Toggles on in repo security settings |
| 3 | ◑ **Substantially done (operator-verified 2026-06-27)** — history rewritten (`git filter-repo`); `main`+tags+branches force-pushed to cleaned history. **Verified:** normal clone `git log --all -- street-signing.key.pem` is **empty**; `for-each-ref --contains d7bbfc40` returns only `refs/pull/*`. **Only residual:** PR refs + GitHub cache → **GitHub Support request** required to fully purge (reference `d7bbfc40…`). Keep `.gitleaks.toml` allowlist until Support confirms. | [OPERATOR] | `security/KEY-ROTATION-RUNBOOK.md` §7 | Support purges PR-refs/cache; allowlist removed |
| 4 | ✅ **Done (operator-verified 2026-06-28)** — no private key material in the working tree: `find` for `*.key.pem`/`*.pkcs8.pem`/`*.key`/`*.p12`/`*.pfx` is empty. The live signing key was temporarily restored to `keys/street-signing-2026.key.pem` during the 2026-06-28 plugin re-publish (item #29), then `shred -u`'d once set into the `STREET_PLUGIN_SIGNING_KEY` CI secret; `keys/` verified empty afterward. Sole accessible copies now: the write-only CI secret + the operator's secrets manager. | [OPERATOR] | `KEY-ROTATION-RUNBOOK.md` §8, `SECURITY-CLASSIFICATION.md` | No key files in the working tree |
| 5 | ✅ **Done (operator-verified 2026-06-27)** — `required_signatures.enabled: true` on `main` (per branch-protection API). Future commits to `main` must be signed. | [OPERATOR] | `CONTRIBUTOR-GOVERNANCE.md`, threat model | Branch rule requires signatures |
| 29 | ✅ **Done (operator-verified 2026-06-28)** — re-signed + re-published all official `@streetjs/plugin-*` to npm under the rotated anchor `3ae9add0…`. **Root cause:** registry packages (`1.0.2`) were signed by the pre-rotation key, and the `STREET_PLUGIN_SIGNING_KEY` CI secret had been stored in a non-PKCS#8 form (Node `createPrivateKey` → `ERR_OSSL_UNSUPPORTED`), later clobbered to empty by failed-path attempts. **Fix:** bumped all plugins to `1.0.3`, re-set the secret from the validated key (`ed25519`, pub-sha256 `3ae9add0…`) via `gh secret set < keys/street-signing-2026.key.pem` from the repo root, re-ran `publish-plugins.yml` (green). **Verified:** `scripts/verify-official-signatures.mjs` → 18/18 ✓; `Runtime Certification` (`certify`/`verify:runtime`) green on `main`. Also bumped `upload-artifact`→v7.0.1 (Node 24) in `runtime-certification.yml`+`soak-scale-chaos.yml` (PR #96) to clear the Node 20 deprecation. | [OPERATOR] | `verify-official-signatures.mjs`, `publish-plugins.yml` | `verify-official-signatures` exits 0; `certify` green |

## P1 — High
| # | Action | Owner | Source | Done when |
|---|---|---|---|---|
| 6 | ◑ **Functional goal met; team upgrade blocked on org move** — live `.github/CODEOWNERS` resolves to `@hassanmubiru` (valid owner), so "require Code-Owner review" **already works**. Team-based ownership is **impossible today**: verified `orgs/streetjs` → 404 (no such org) and repo owner `hassanmubiru` is a **User** account (personal accounts can't have teams). **Prerequisite (operator/org):** create a `streetjs` org → transfer the repo → create teams; *then* map `CODEOWNERS.proposed` placeholders to real `@streetjs/<slug>` names. Do NOT fill `@org/*` while personally owned (would void the Code-Review gate). | [OPERATOR] | `CONTRIBUTOR-GOVERNANCE.md` | Repo under an org with real teams as code owners |
| 7 | ✅ **Done** — generated `package-lock.json` in all 4 `web/` apps (`npm install --package-lock-only`; vite resolves to 6.4.3, `npm audit` → 0 vulns in each); lockfiles trackable + already referenced by `dependabot.yml`. Stale "run npm install" NOTE removed | [MAINTAINER] | cleanup plan, Dependabot | Lockfiles committed; Dependabot tracks them |
| 8 | ✅ **Done** — outbound HTTP **timeout** (optional `timeoutMs`, default 30s, enforced via `req.setTimeout`+`destroy`) added to all 9 `node:https` plugins: stripe/twilio/sendgrid/auth0 (core) + paypal/openai/clerk/firebase/supabase (packages). Additive/backward-compatible; per-plugin timeout-validation tests added; all builds + suites green; 21/21 manifest signatures still verify | [RUNTIME] | `PLUGIN-SECURITY-REPORT.md`, `PLUGIN-MATURITY-MATRIX.md` | Each client enforces a timeout; tests added |
| 9 | ✅ **Done** — constant-time **webhook verifiers** shipped + tested for all four signing providers: `verifyStripeWebhook` (HMAC-SHA256, replay tolerance), `verifyTwilioSignature` (HMAC-SHA1 URL+params), `verifySendGridWebhook` (ECDSA-P256 event webhook), `verifyPayPalWebhook` (RSA-SHA256 local cert verification). Stripe/Twilio/SendGrid exported from `streetjs`; PayPal from `@streetjs/plugin-paypal` | [RUNTIME] | `PLUGIN-SECURITY-AUDIT.md`, `OWASP-ASVS-MAPPING.md` V13 | Constant-time verifier + tests per plugin |
| 10 | ✅ **Done** — `app-*` scaffolds relocated to `examples/scaffold-*`; `zizmor.yml` + Dependabot dirs updated; no functional refs left (see Completed section) | [MAINTAINER] | `REPOSITORY-CLEANUP-PLAN.md`, `DOCKER-REVIEW.md` | `app-*` gone from root; CI green |
| 11 | Move SEO files (`BingSiteAuth.xml`, `googledf*.html`) to the website repo, then `git rm` here | [OPERATOR] | cleanup plan, `SECURITY-CLASSIFICATION.md` | Files removed; root allowlist updated |

## P2 — Medium
| # | Action | Owner | Source |
|---|---|---|---|
| 12 | Migrate plugin signing to **keyless (Sigstore/OIDC)** or KMS/HSM (reaches SLSA L3, removes long-lived key) | [OPERATOR]+[MAINTAINER] | `SLSA-ASSESSMENT.md`, `SECURITY-ROADMAP.md` |
| 13 | ✅ **Done** — `.github/workflows/verify-signatures.yml` runs `npm run verify:signatures` as a **fatal** gate (every plugin `manifest.signed.json` signature must verify against the embedded anchor, not just the `manifest.pub` fingerprint that `verify-signing-anchor` already checks) + `npm audit signatures` (informational dependency-tree provenance). Path-filtered to signing-relevant changes; intentionally **not** a required status check (a path-filtered required check would deadlock unrelated PRs in "Expected" — the always-on `verify-signing-anchor` stays the required gate). Verified locally: 21/21 ✓, exit 0 | [MAINTAINER] | `SLSA-ASSESSMENT.md`, `NPM-PUBLISH-SECURITY-REVIEW.md` |
| 14 | ✅ **Done** — Generated `verification-artifacts/` no longer tracked (4 stale files `git rm --cached`; dir already gitignored + CI-regenerated by `deploy-verify`/`upgrade-codemods`); SBOM stays a CI-uploaded release asset | [MAINTAINER] | `SECURITY-CLASSIFICATION.md`, `REPOSITORY-ORGANIZATION.md` |
| 15 | ✅ **Done** — additive **TLS surface** (`tls`/`tlsRejectUnauthorized`/`tlsServerName`/`tlsCa`, default plain TCP) shipped for **all 5**: redis + mongodb + kafka (SSL/SASL_SSL) + rabbitmq (AMQPS) use connect-from-start `tls.connect()`; **nats** performs the protocol **STARTTLS** upgrade after the plaintext `INFO`. Config-validation unit tests added for each (redis/mongodb/kafka/rabbitmq/nats); plaintext paths unchanged. TLS handshakes exercised in integration when a TLS endpoint is present | [RUNTIME] | `OWASP-ASVS-MAPPING.md` V9, `PLUGIN-SECURITY-AUDIT.md` |
| 16 | Bind local compose DB ports to `127.0.0.1` | [MAINTAINER] | `INFRASTRUCTURE-SECURITY-REVIEW.md` |
| 17 | ◑ **Partial** — docs are **already searchable** (just-the-docs Lunr, `search_enabled`); enhanced the `search:` config (h3 indexing, content previews, `s` focus shortcut). Added a documented **versioning** policy + surface: `docs/versions.md` (+ "Versions" aux link) tying current `site.version` → support-matrix/changelog/tagged source; gave `docs/enterprise/support-matrix.md` the front matter it was missing so it now renders + is searchable. *Remaining: browsable multi-version doc trees (roadmap) — Algolia/Pagefind unnecessary at this size* | [MAINTAINER] | `ENTERPRISE-READINESS-2026.md` |
| 18 | ◑ **Partial** — fuzz suite + property-based tests present (`ci-cd.yml` `system-tests` `fuzz-testing`) and documented in `OPENSSF-REVIEW.md`. *Remaining: OSS-Fuzz onboarding = submit a project config to the external OSS-Fuzz repo (operator/maintainer, not repo-completable)* | [MAINTAINER]+[OPERATOR] | `OPENSSF-REVIEW.md`, `SECURITY-ROADMAP.md` |
| 19 | ✅ **Done** — `docs/security/dashboard.md` surfaces live badges (CI, CodeQL, OpenSSF Scorecard, provenance) + a control-posture table linking each gate to its workflow, the live GitHub Security tabs, and canonical docs; live/operator-setting values are marked **UNVERIFIED** rather than fabricated | [MAINTAINER] | `SECURITY-ROADMAP.md` |
| 20 | Add a real **PGP key** to `SECURITY.md` (replace placeholder; never commit the private key) | [OPERATOR] | `SECURITY.md` |
| 21 | ◑ **In progress** — `PLUGIN-MATURITY-MATRIX.md` refreshed (timeouts ✅ on 9 HTTP plugins; **all 4** webhook verifiers ✅; TLS ✅ on all 5); `docs/plugins/webhook-verification.md` guide added. **Verified:** runnable `example/index.mjs` already ships for 20/21 plugin packages (marzpay uses full react/next apps); all 20 pass `node --check`. **CI baseline added:** `npm run test:plugins-offline` (`scripts/test-plugins-offline.mjs`) builds core + each plugin, runs node:test (15/15 passed locally), and syntax-checks all 20 examples; wired via `.github/workflows/plugin-tests.yml`. *Remaining: standalone example **apps** per plugin + raised coverage gates to flip ◑→✅* | [RUNTIME]+[MAINTAINER] | `PLUGIN-MATURITY-MATRIX.md` |
| 22 | ✅ **Done** — Standardize CI `retention-days` + `concurrency` across workflows (see Completed section) | [MAINTAINER] | `STREETJS-FULL-AUDIT-REPORT.md` Phase 12 |
| 23 | Fix latent bug: `scripts/cloud/prereqs.mjs` cloudflare path (`deploy/cloudflare-workers` → `infra/examples/cloudflare`) | [MAINTAINER] | `PHASE-19-MASTER-AUDIT.md` B-1 |

## P3 — Long-term
| # | Action | Owner | Status |
|---|---|---|---|
| 24 | SOC 2 readiness | [OPERATOR] (external audit) | Org program — requires an audit firm + control evidence period; cannot be repo-completed. Tracked in `SECURITY-ROADMAP.md`. |
| 25 | ISO 27001 alignment | [OPERATOR] (external audit) | Org program — ISMS + certification body; cannot be repo-completed. Tracked in `SECURITY-ROADMAP.md`. |
| 26 | OpenSSF Best Practices badge | [MAINTAINER]+[OPERATOR] | ◑ **Evidence pack done** — "passing"-tier self-assessment added to `OPENSSF-REVIEW.md`. Remaining: register + submit on bestpractices.dev (operator) + the listed gating gaps (branch protection, push protection, PGP key). |
| 27 | Security Champions program + dual-control releases | [OPERATOR]/community | Org/process — needs people + role assignment; framework in `CONTRIBUTOR-GOVERNANCE.md`. Cannot be repo-completed. |
| 28 | Grow MAINTAINERS / security team (bus-factor) | [OPERATOR]/community | Org/hiring — cannot be repo-completed; governance + neutral-maintainership path documented in `governance/DECISION-PROCESS.md`. |

> **P3 status:** #26 has its maintainer evidence pack done (badge submission is
> operator). #18 (OSS-Fuzz) and #12 (keyless signing) are partially specced; their
> remaining work is external/operator. #24/#25/#27/#28 are organizational programs
> that **cannot be completed by editing the repository** — they require external
> audits, badge registration, or staffing. They are documented with owners here and
> in the roadmap so nothing is lost, but they are explicitly out of repo scope.

## Sequencing
1. **P0 first** (branch/push protection, history purge, key relocation) — these unlock the biggest score gains (Security 70→86, SLSA L2→L3 path) and close the only HIGH residuals.
2. **P1 governance/org** in one branch (CODEOWNERS teams, lockfiles, app-* move, SEO removal); **P1 runtime** (timeouts, webhook verifiers) as a separate plugin PR.
3. **P2/P3** iteratively.

## Notes
- **[RUNTIME]** items #8 (timeouts, 9 plugins), #9 (all 4 webhook verifiers), and
  #15 (TLS for all 5 redis/mongodb/kafka/rabbitmq/nats) are **done** —
  implemented additively in `packages/core` + the separate plugin packages, with
  tests, after the no-touch-core constraint was explicitly lifted for these
  scoped, tested changes. The only remaining [RUNTIME] item is #21 (per-plugin
  example apps + raised coverage gates), which is incremental and in progress.
- Verification of P0 platform items can't be done from the repo; export them as
  settings-as-code (e.g. an `allstar`/repo-settings file) for auditability. See
  `security/OPERATOR-EXECUTION-CHECKLIST.md` for the sequenced `gh` commands.
