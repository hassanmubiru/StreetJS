# StreetJS Security Hardening Sprint — Executable Implementation Plan

> Derived from `PHASE-19-MASTER-AUDIT.md`. Prioritised **P0** (critical security),
> **P1** (governance & organization), **P2** (docs & contributor experience).
> Constraint: **no `packages/core` changes unless required for security.** Prefer
> moving, organizing, protecting, automating over adding framework features.
>
> Status legend: ✅ already done this session · ⏳ operator action · 🤖 agent-applicable.

## Already landed (VERIFIED)

**Rotation / signing (earlier this session):**
- ✅ Rotated trust anchor → `official-key.ts` = `3ae9add0`; all 21 manifests re-signed & matching.
- ✅ `secrets-guard` job added as rule #1 in `ci-cd.yml`; `build-and-test` `needs` it.
- ✅ `.github/workflows/block-private-keys.yml` (standalone gate).
- ✅ `.gitleaks.toml` corrected (allowlist removed + PEM private-key rule).

**This sprint (applied):**
- ✅ P1-1 — `.github/CODEOWNERS` activated with expanded path coverage (single verified owner `@hassanmubiru`); team-based `CODEOWNERS.proposed` staged for when teams exist.
- ✅ P1-2 — `governance/CHARTER.md` created.
- ✅ P1-3 — root reorganized: `plans/` (18), `audits/` (8), `security/` (12), feature docs → `docs/`, smoke script → `scripts/`; cross-folder links fixed.
- ✅ P1-5 (partial) — `sbom.json` + `release-inputs.json` untracked + gitignored. (SEO file removal left to operator — `git rm` deletes; move to website repo first.)
- ✅ P1-6 — `scan-infra-identifiers` job added to `block-private-keys.yml`.
- ✅ P2-1 — per-plugin `SECURITY.md` added to all 21 plugins.
- ✅ P2-2 — `README.md` for `security/`, `audits/`, `plans/`, `governance/`.
- ✅ P2-3 — root `SECURITY.md` now links `security/`, `governance/`, `audits/`.
- ✅ P2-4 — `.github/workflows/trufflehog.yml` (full-history scan) added.
- ✅ Pre-push hook — key-block guard appended to `.githooks/pre-push`.

**Deferred to operator (risk/verifiability):** P0-1 (history purge), P0-2 (relocate
on-disk keys), P0-3 (push protection), P0-4 (branch protection), **P1-4 (infra moves
— CI path coupling, see checklist below)**.

---

## P0 — Critical security

### P0-1 Purge leaked key blob from history  ⏳  · effort: M (half-day, coordinated) · risk: HIGH (history rewrite)
```bash
git clone --mirror git@github.com:<org>/streetJS.git streetJS-rewrite.git
cd streetJS-rewrite.git
git filter-repo --invert-paths --path street-signing.key.pem --path street-signing.pub.pem
git push --force --mirror   # coordinate: everyone re-clones afterward
```
- **Risk analysis:** divergent clones/forks, open PRs need rebase, CI caches retain blob. Mitigated by the completed rotation (blob is already distrusted). **Rollback:** keep the pre-rewrite mirror; restore by force-pushing it back. Do on a low-traffic window with team sign-off.

### P0-2 Relocate on-disk private keys out of the tree  ⏳  · effort: S · risk: LOW
```bash
mv keys/street-signing-2026.key.pem ~/secrets/streetjs/         # new active key
mv street-signing.key.pem ~/secrets/streetjs/LEAKED-distrusted.key.pem
mv street-signing.pub.pem ~/secrets/streetjs/ 2>/dev/null || true
rmdir keys 2>/dev/null || true
```
- Confirm the CI secret `STREET_PLUGIN_SIGNING_KEY` is the new key (✅ user reports set). **Rollback:** keys remain in the secrets manager; re-export if a local sign is needed (discouraged).

### P0-3 Enable platform Secret Scanning + Push Protection  ⏳  · effort: S · risk: none
- GitHub → Settings → Code security: enable **Secret scanning** + **Push protection**. **Rollback:** toggle off.

### P0-4 Branch protection on `main`  ⏳  · effort: S · risk: LOW (may block direct pushes — intended)
Required: PR review incl. **Require review from Code Owners**; required status checks =
`secrets-guard`, `build-and-test`, `verify-signing-anchor`, `secret-scan`, `codeql`;
dismiss stale approvals; linear history; block force-push.
- **Rollback:** relax the rule set in Settings → Branches.

### P0-5 Provenance/manifest verification gate  🤖/⏳  · effort: M · risk: LOW
- The `verify-signing-anchor` job (in `block-private-keys.yml`) already fails on anchor drift. Add an install-side doc + optional cosign verify for release tarballs.

---

## P1 — Governance & repository organization

### P1-1 Expand CODEOWNERS  ⏳  · effort: S · risk: LOW
- `.github/CODEOWNERS.proposed` is delivered. Replace `@org/*-team` placeholders, then:
```bash
git mv .github/CODEOWNERS.proposed .github/CODEOWNERS
```
- **Rollback:** `git revert` the commit (restores single-owner file).

### P1-2 Adopt Governance Charter  🤖  · effort: S · risk: none
```bash
mkdir -p governance && git mv-or-create governance/CHARTER.md   # from PHASE-19 §7
```
- **Rollback:** delete file.

### P1-3 Root reorganization  🤖  · effort: M · risk: LOW (link updates)
All moves preserve history (`git mv`). Update any references (`SECURITY.md` links, CI paths).
```bash
mkdir -p plans audits security governance
# security/
git mv SECURITY-AUDIT.md PLUGIN-SECURITY-AUDIT.md MARZPAY-SECURITY-REVIEW.md \
       PAYMENTS-SECURITY-REVIEW.md PLUGIN-SIGNING-REVIEW.md THREAT-MODEL-2026.md \
       THREAT-MODEL-UPDATE.md SECURITY-SCORECARD.md KEY-ROTATION-RUNBOOK.md \
       PRIVACY-POLICY-FOR-REPO.md PHASE-19-MASTER-AUDIT.md SECURITY-HARDENING-SPRINT.md security/
# audits/
git mv SECURITY-AUDIT-2026.md ENTERPRISE-READINESS.md ECOSYSTEM-PLUGINS-AUDIT.md \
       LANGUAGE-STATS-AUDIT.md MARZPAY-INTEGRATION-REPORT.md SHOWCASE-AUDIT.md \
       PHASE-18-AUDIT.md REPO-ORGANIZATION-PLAN.md audits/
# plans/
git mv STREETJS-EXPANSION-MASTERPLAN.md COMMUNITY-GROWTH-PLAN.md COMMUNITY-ROADMAP.md \
       CONTENT-DRAFTS.md CONTENT-ROADMAP.md DEMO-INFRA-PLAN.md CLI-EVOLUTION.md \
       WEBSITE-EVOLUTION.md PLUGIN-MARKETPLACE-PLAN.md SHOWCASE-GALLERY-PLAN.md \
       SHOWCASE-ROADMAP.md STARTER-CATALOG-PLAN.md STARTERS-ROADMAP.md SECURITY-ROADMAP.md \
       TRUST-CENTER-PLAN.md ADOPTION-ASSETS.md STREETJS-HTMX-PLAN.md PHASE-18-EXECUTION-PLAN.md plans/
# docs/
git mv PLUGIN-MARKETPLACE.md GOOD-FIRST-ISSUES.md docs/
git mv .sqlite-smoke.mjs scripts/sqlite-smoke.mjs
```
- Add `.gitignore` entries; then link standing docs from `SECURITY.md`. **Rollback:** `git mv` back, or `git revert`.

### P1-4 Consolidate infra  🟡 PARTIALLY DONE · effort: M · risk: MED (CI path coupling)

**Done (applied + statically validated):** `deploy/` → `infra/{kubernetes,helm,examples}`
and `observability/` → `infra/monitoring/`, with all functional references updated:
`scripts/cloud/prereqs.mjs`, `scripts/cloud/kind-verify.mjs`, `scripts/ci/validate-yaml.mjs`,
`scripts/observability/emit-assets.mjs`, `scripts/observability/validate.mjs`,
`.github/workflows/deploy-verify.yml` + `observability.yml` path filters, and
`docs/_data/demos.json`. `infra/README.md` documents the layout. (`node --check` /
`bash -n` / YAML diagnostics all clean; final CI run is the operator's confirmation.)

**Deferred (compose + Dockerfile stay at repo root):** `docker-compose*.yml` has
`build: context: .` and `./packages/core/docker-init` / `./scripts/mysql-test-init`
volume paths that Compose resolves relative to the file's directory, and `build`
depends on the root `Dockerfile`. Moving them needs `--project-directory .` +
`dockerfile: infra/docker/Dockerfile` overrides and **Docker-tested** verification —
not safe to apply blind. To complete later:
```bash
mkdir -p infra/docker/compose && git mv docker-compose*.yml infra/docker/compose/ \
  && git mv Dockerfile infra/docker/Dockerfile
# then: add `--project-directory .` to compose callers (test-setup.sh, kafka-cold-start.sh),
# add `dockerfile: infra/docker/Dockerfile` under the compose `build:` service,
# and `-f infra/docker/Dockerfile` to docker build in ci-cd.yml / deploy-verify.yml / kind-verify.mjs.
# Verify with a real `docker compose up` + `docker build` before merge.
```

**B-1 note:** `scripts/cloud/prereqs.mjs` still references the non-existent
`deploy/cloudflare-workers/wrangler.toml` (now also under the old `deploy/` path).
The `existsSync` guard means the wrangler dry-run stays skipped either way; fixing it
to `infra/examples/cloudflare/wrangler.toml` makes the check run for the first time
(CI-behavior change) — do it deliberately on a branch.

**Rollback:** revert the PR. **Validation:** run `deploy-verify` + `observability`.

### P1-5 Untrack generated artifacts  ⏳  · effort: S · risk: LOW
```bash
git rm --cached sbom.json release-inputs.json
printf "\nsbom.json\nrelease-inputs.json\n" >> .gitignore
# move SEO files to website repo, then:
git rm BingSiteAuth.xml googledf528d4f2b039b20.html
```
- Ensure CI emits `sbom.json` as a release asset. **Rollback:** `git revert`.

### P1-6 CI grep gate for real identifiers in infra  🤖  · effort: S · risk: LOW
- Add a job that greps `infra/`, `deploy/`, `observability/` for AWS account IDs (`\b\d{12}\b`), ARNs, internal DNS, cluster names, monitoring URLs; fail on match.

---

## P2 — Documentation & contributor experience

### P2-1 Per-plugin SECURITY pointer  🤖  · effort: M · risk: none
- Add a short `SECURITY.md` (or README section) to each of the 21 plugins linking to the central policy + reporting path.

### P2-2 infra/README + plans/README + audits/README  🤖  · effort: S · risk: none.
### P2-3 Link standing security docs from root `SECURITY.md`  🤖  · effort: S · risk: none.
### P2-4 Trufflehog full-history scan job  🤖  · effort: S · risk: LOW (may flag historical blob until P0-1).

---

## Generated artifacts in this sprint

- `.github/CODEOWNERS.proposed` — ✅ delivered (Phase 8).
- Gitleaks rule + allowlist fix — ✅ already applied in `.gitleaks.toml`.
- `secrets-guard` / `block-private-keys.yml` CI updates — ✅ already applied.
- Folder migration commands — above (P1-3, P1-4).

## Pre-push hook update (proposed addition to `.githooks/pre-push`)
```bash
# Block pushing any *.pem/*.key or a PEM private-key header on its own line.
if git diff --cached --name-only origin/main..HEAD 2>/dev/null | grep -E '\.(pem|key|p12|pfx)$'; then
  echo "[pre-push] BLOCKED: key/keystore file in push range." >&2; exit 1
fi
```

## Branch protection (summary)
| Setting | Value |
|---|---|
| Require PR before merge | yes |
| Require Code Owner review | yes (≥1) |
| Required status checks | `secrets-guard`, `build-and-test`, `verify-signing-anchor`, `secret-scan`, `codeql` |
| Dismiss stale approvals | yes |
| Require linear history | yes |
| Allow force pushes | no |
| Restrict who can push | maintainers only |

## Rollout & rollback strategy

1. **Branch `harden/p0` →** P0-2..P0-5 (config/CI only; P0-1 separately on a mirror).
2. **Branch `harden/p1-org` →** P1-1..P1-3 (moves) in one PR so links update atomically.
3. **Branch `harden/p1-infra` →** P1-4 with CI-path updates; verify integration workflows green before merge.
4. **Branch `harden/p2` →** docs.
5. **P0-1 history purge LAST**, scheduled, after rotation is confirmed everywhere and the team is ready to re-clone.
- **Global rollback:** every step is a PR → `git revert`. The only irreversible step (P0-1) is mitigated by retaining the pre-rewrite mirror clone for restore.

## Effort / risk rollup
| ID | Priority | Effort | Risk |
|---|---|---|---|
| P0-1 | P0 | M | HIGH (history) |
| P0-2 | P0 | S | LOW |
| P0-3 | P0 | S | none |
| P0-4 | P0 | S | LOW |
| P0-5 | P0 | M | LOW |
| P1-1 | P1 | S | LOW |
| P1-2 | P1 | S | none |
| P1-3 | P1 | M | LOW |
| P1-4 | P1 | M | MED |
| P1-5 | P1 | S | LOW |
| P1-6 | P1 | S | LOW |
| P2-1 | P2 | M | none |
| P2-2..4 | P2 | S | LOW |
