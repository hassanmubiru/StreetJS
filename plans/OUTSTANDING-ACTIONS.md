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

## P0 — Critical
| # | Action | Owner | Source | Done when |
|---|---|---|---|---|
| 1 | Enable **branch protection** on `main` (require Code-Owner review + status checks `secrets-guard`/`build-and-test`/`verify-signing-anchor`/`secret-scan`/`codeql`, linear history, no force-push) | [OPERATOR] | `security/BRANCH-PROTECTION-REVIEW.md`, `OPENSSF-REVIEW.md`, `SLSA-ASSESSMENT.md` | Settings applied + a blocked direct push confirms |
| 2 | Enable **Secret Scanning + Push Protection** (GitHub setting) | [OPERATOR] | `OPENSSF-REVIEW.md`, `TRUST-CENTER.md` | Toggles on in repo security settings |
| 3 | **Purge leaked key blob** from history (`git filter-repo` on a mirror + coordinated force-push + re-clone) | [OPERATOR] | `security/KEY-ROTATION-RUNBOOK.md` §7 | `git log --all -- street-signing.key.pem` empty; gitleaks commit-allowlist entry removed |
| 4 | **Relocate on-disk private keys** (`street-signing.key.pem`, `keys/`) to a secrets manager | [OPERATOR] | `KEY-ROTATION-RUNBOOK.md` §8, `SECURITY-CLASSIFICATION.md` | No key files in the working tree |
| 5 | Enable **signed commits** requirement | [OPERATOR] | `CONTRIBUTOR-GOVERNANCE.md`, threat model | Branch rule requires signatures |

## P1 — High
| # | Action | Owner | Source | Done when |
|---|---|---|---|---|
| 6 | Fill `@org/*-team` handles in `.github/CODEOWNERS.proposed`, then `git mv` over `.github/CODEOWNERS` | [MAINTAINER]+[OPERATOR] | `CONTRIBUTOR-GOVERNANCE.md` | Live CODEOWNERS uses teams. *(Maintainer prep done: stale post-reorg paths `/deploy/`,`/observability/`,`/verification-artifacts/` corrected to `/infra/`+`/infra/monitoring/` in both live + proposed files. **Blocked on operator** to supply real GitHub team slugs — placeholders can't be guessed without breaking the Code-Review gate.)* |
| 7 | `npm install` in the 4 `web/` apps; commit `package-lock.json` (activates Dependabot, finalizes vite fix) | [MAINTAINER] | cleanup plan, Dependabot | Lockfiles committed; Dependabot tracks them |
| 8 | Add **outbound HTTP timeouts** to the 9 `node:https` plugins (stripe, paypal, twilio, sendgrid, openai, auth0, clerk, firebase, supabase) | [RUNTIME] | `PLUGIN-SECURITY-REPORT.md`, `PLUGIN-MATURITY-MATRIX.md` | Each client enforces a timeout; tests added |
| 9 | Ship **webhook verifiers** for stripe (`Stripe-Signature`) + twilio (`X-Twilio-Signature`), then paypal + sendgrid | [RUNTIME] | `PLUGIN-SECURITY-AUDIT.md`, `OWASP-ASVS-MAPPING.md` V13 | Constant-time verifier + tests per plugin |
| 10 | Relocate `app-*` scaffolds → `examples/scaffold-*` (update `zizmor.yml`, Dependabot dirs, any CI refs) | [MAINTAINER] | `REPOSITORY-CLEANUP-PLAN.md`, `DOCKER-REVIEW.md` | `app-*` gone from root; CI green |
| 11 | Move SEO files (`BingSiteAuth.xml`, `googledf*.html`) to the website repo, then `git rm` here | [OPERATOR] | cleanup plan, `SECURITY-CLASSIFICATION.md` | Files removed; root allowlist updated |

## P2 — Medium
| # | Action | Owner | Source |
|---|---|---|---|
| 12 | Migrate plugin signing to **keyless (Sigstore/OIDC)** or KMS/HSM (reaches SLSA L3, removes long-lived key) | [OPERATOR]+[MAINTAINER] | `SLSA-ASSESSMENT.md`, `SECURITY-ROADMAP.md` |
| 13 | Add **provenance/manifest verification gate** at publish/consume (`npm audit signatures` / cosign verify) | [MAINTAINER] | `SLSA-ASSESSMENT.md`, `NPM-PUBLISH-SECURITY-REVIEW.md` |
| 14 | ✅ **Done** — Generated `verification-artifacts/` no longer tracked (4 stale files `git rm --cached`; dir already gitignored + CI-regenerated by `deploy-verify`/`upgrade-codemods`); SBOM stays a CI-uploaded release asset | [MAINTAINER] | `SECURITY-CLASSIFICATION.md`, `REPOSITORY-ORGANIZATION.md` |
| 15 | Surface **TLS options** for redis/mongodb/nats/kafka/rabbitmq | [RUNTIME] | `OWASP-ASVS-MAPPING.md` V9, `PLUGIN-SECURITY-AUDIT.md` |
| 16 | Bind local compose DB ports to `127.0.0.1` | [MAINTAINER] | `INFRASTRUCTURE-SECURITY-REVIEW.md` |
| 17 | **Versioned + searchable docs** (Algolia/Pagefind) | [MAINTAINER] | `ENTERPRISE-READINESS-2026.md` |
| 18 | Fuzzing depth / OSS-Fuzz onboarding; expand chaos testing | [MAINTAINER] | `OPENSSF-REVIEW.md`, `SECURITY-ROADMAP.md` |
| 19 | Security **dashboard** (surface Scorecard/alerts) | [MAINTAINER] | `SECURITY-ROADMAP.md` |
| 20 | Add a real **PGP key** to `SECURITY.md` (replace placeholder; never commit the private key) | [OPERATOR] | `SECURITY.md` |
| 21 | Per-plugin **example apps** + raise coverage gates (promote ◑→✅ in maturity matrix) | [RUNTIME]+[MAINTAINER] | `PLUGIN-MATURITY-MATRIX.md` |
| 22 | ✅ **Done** — Standardize CI `retention-days` + `concurrency` across workflows (see Completed section) | [MAINTAINER] | `STREETJS-FULL-AUDIT-REPORT.md` Phase 12 |
| 23 | Fix latent bug: `scripts/cloud/prereqs.mjs` cloudflare path (`deploy/cloudflare-workers` → `infra/examples/cloudflare`) | [MAINTAINER] | `PHASE-19-MASTER-AUDIT.md` B-1 |

## P3 — Long-term
| # | Action | Source |
|---|---|---|
| 24 | SOC 2 readiness | `SECURITY-ROADMAP.md` |
| 25 | ISO 27001 alignment | `SECURITY-ROADMAP.md` |
| 26 | OpenSSF Best Practices badge | `OPENSSF-REVIEW.md`, roadmap |
| 27 | Security Champions program + dual-control releases | `CONTRIBUTOR-GOVERNANCE.md`, threat model |
| 28 | Grow MAINTAINERS / security team (reduces bus-factor + social-engineering risk) | threat model, SSDF PO.2 |

## Sequencing
1. **P0 first** (branch/push protection, history purge, key relocation) — these unlock the biggest score gains (Security 70→86, SLSA L2→L3 path) and close the only HIGH residuals.
2. **P1 governance/org** in one branch (CODEOWNERS teams, lockfiles, app-* move, SEO removal); **P1 runtime** (timeouts, webhook verifiers) as a separate plugin PR.
3. **P2/P3** iteratively.

## Notes
- **[RUNTIME]** items (8, 9, 15, 21) require touching plugin code — explicitly out of
  scope for the governance passes (which must not modify `packages/core`); they are
  documented here for a dedicated, tested plugin PR.
- Verification of P0 platform items can't be done from the repo; export them as
  settings-as-code (e.g. an `allstar`/repo-settings file) for auditability.
