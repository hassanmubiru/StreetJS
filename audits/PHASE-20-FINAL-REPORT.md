# StreetJS Phase 20 — Final Security & Release-Completion Report

> The 8 required deliverable reports, consolidated. Every line is tagged:
> **[DONE]** completed + verified this phase · **[OPERATOR]** needs GitHub/operator
> action · **[DEFERRED]** safe but intentionally not done (with reason) ·
> **[ROADMAP]** future. Constraints honored: **no `packages/core` change, no API/CLI
> break, no test files touched, plugin architecture + signing/provenance intact.**

---

## 1. Security Hardening Report
- [DONE] `.github/repository-settings.json` — branch-protection settings-as-code (PR + CODEOWNER review, signed commits, linear history, no force-push/delete, required checks incl. `build-and-test`/`codeql`/`secret-scan`/`verify-signing-anchor`/`secrets-guard`).
- [DONE] `security/KEY-ROTATION-CHECKLIST.md`, `security/KEY-EMERGENCY-RUNBOOK.md`, `security/SECRET-SCANNING-GUIDE.md` (rotation/revocation/recovery/verification + secret-scanning enablement & validation).
- [DONE] `.gitleaks.toml` (6 rules + commit-scoped historical allowlist), `.gitignore` RESTRICTED patterns, `secrets-guard`/`block-private-keys`/`repository-policy`/`security-baseline` gates.
- [OPERATOR] Enable Secret Scanning + Push Protection; apply branch protection; purge leaked-key history; relocate on-disk keys; add real PGP key.

## 2. Plugin Runtime Audit
- [DONE] Evidence scan: **0** `eval`/`Function`/`child_process`/`exec`/`any` across all 21 plugin `src/` (`audits/PLUGIN-SECURITY-REPORT.md`, `PLUGIN-MATURITY-MATRIX.md`).
- [DONE] marzpay reference posture: fail-closed webhook + server re-verify, atomic idempotency, server-derived tenant binding, timeout (verified, ~97% cov).
- [DEFERRED] HTTP timeouts + webhook verifiers for **stripe, sendgrid, twilio, auth0, s3, r2** — their canonical impls live in `packages/core/src/platform/plugins/official/`, which Phase 20 **freezes**. Implementing there would violate the no-core rule. Tracked `[RUNTIME]` in `OUTSTANDING-ACTIONS.md`.
- [DEFERRED] Same for **paypal, openai, clerk, supabase, firebase** (own packages) — a tested runtime PR, out of this governance pass’s scope. Webhook verifiers must implement timestamp + replay + constant-time + pre-persist rejection per the prompt; doing so untested would risk the "all tests pass / coverage" rule.

## 3. Infrastructure Audit
- [DONE] All 11 compose host ports bound to `127.0.0.1` across 6 files; **`docker compose config` validates all 6**.
- [DONE] `infra/docker/Dockerfile` verified: multi-stage, distroless non-root runtime, digest-pinned base; `.dockerignore` at context root. Scaffold/demo Dockerfiles digest-pinned. (`audits/DOCKER-REVIEW.md`.)
- [DONE] No plugin ships a Dockerfile (CI-enforced by `no-plugin-dockerfiles`).
- [ROADMAP] read-only rootfs + explicit resource limits/cap-drop in compose (dev compose; document for prod).

## 4. Repository Organization Report
- [DONE] Moved `app-htmx/next/none/react` → `examples/scaffold-*`; updated `.github/zizmor.yml` (ignore paths) + `.github/dependabot.yml` (npm/docker directories). No functional `app-*` refs remain; dependabot dirs all resolve.
- [DONE] Removed website-only SEO files (`BingSiteAuth.xml`, `googledf*.html`) + dropped them from the repository-policy root allowlist.
- [DONE] Root now holds only the professional front-door set (7 `.md` + manifests + dotfiles + `.env.example`); compose/Dockerfile under `infra/docker/`. Root allowlist gate passes.
- [DONE] CODEOWNERS customization documented (`.github/CODEOWNERS.proposed` header + `governance/CONTRIBUTOR-GOVERNANCE.md`).
- [OPERATOR] Fill CODEOWNERS team handles + activate; move SEO files into the website repo.

## 5. Supply Chain Verification Report
- [DONE] `scripts/security/verify-release.mjs` + `npm run verify:signatures` — verifies all 21 plugin manifests against the embedded anchor (`3ae9add0`) using the framework's `verifyManifest`; `-- --provenance` runs `npm audit signatures`. **Verified: 21/21 pass.**
- [DONE] Trust Center documents release verification with the real command.
- [OPERATOR/ROADMAP] cosign/Sigstore *verification* gate at consume-time; keyless signing (SLSA L3) — `security/SLSA-ASSESSMENT.md`.

## 6. Documentation Consistency Report
- [DONE] Canonical `security/TRUST-CENTER.md` links all compliance docs + working verify command; `SECURITY.md` has reporting/CVE/plugin/encrypted sections; `CHANGELOG.md` `[Unreleased]` records the non-breaking changes.
- [DONE] No stale `deploy/`/`observability/`/root-compose functional references; relocated-doc links fixed in prior phases.
- [ROADMAP] versioned + searchable docs (Pagefind/Algolia) — `ENTERPRISE-READINESS-2026.md`.
- Note: point-in-time audit docs intentionally retain historical `app-*`/`deploy/` mentions (immutable records).

## 7. Release Readiness Report
- [DONE] verify:signatures 21/21 · compose config 6/6 · `node --check` clean on edited scripts · `package.json` valid · all new/edited files diagnostics-clean · repository-policy + security-baseline dry-runs green.
- [DONE] No `packages/core` change, no API/CLI change, no test file modified.
- [OPERATOR-VERIFY] Full `tests pass / lint / docs build / examples build / marketplace build` require the CI runners + network (npm install) — cannot be executed from here; statically validated. Confirm on a branch.
- [OPERATOR] `web/` lockfiles (`npm install` + commit) to finalize Dependabot tracking of the moved scaffold web apps.

## 8. Remaining Manual Operator Tasks
From `plans/OUTSTANDING-ACTIONS.md` (authoritative register):
- [OPERATOR] Apply `.github/repository-settings.json`; enable Secret Scanning + Push Protection; require signed commits.
- [OPERATOR] Purge leaked-key history (`KEY-ROTATION-RUNBOOK.md` §7 / `KEY-EMERGENCY-RUNBOOK.md`); relocate on-disk keys.
- [OPERATOR] Commit `web/` lockfiles; fill CODEOWNERS teams; move SEO files to website repo; add PGP key.
- [RUNTIME] Plugin timeouts + webhook verifiers (separate, tested PR; touches core for 6 plugins).
- [ROADMAP] keyless signing, versioned/searchable docs, security dashboard, SOC 2 / ISO 27001 / OpenSSF badge / Security Champions / dual-control releases (`security/SECURITY-ROADMAP.md`).

---

## Validation evidence (this phase)
| Check | Result |
|---|---|
| `npm run verify:signatures` | 21/21 ✓ |
| `docker compose config` (6 files) | all OK ✓ |
| dependabot directories resolve | all exist ✓ |
| zizmor / dependabot / repository-policy YAML | valid ✓ |
| root allowlist (post SEO removal) | PASS ✓ |
| `node --check` edited scripts | clean ✓ |
| diagnostics (all new/edited files) | clean ✓ |
| `packages/core` modified | **no** ✓ |
| test files modified | **no** ✓ |

## What I did NOT claim
Per the "do not claim completion you can't verify" rule: the full test-suite/lint/
docs-build/examples-build are **not** marked done — they need CI runners + network
I don't have. They are statically validated only; a branch CI run is the gate.
