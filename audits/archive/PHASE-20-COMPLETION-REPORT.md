# StreetJS Phase 20 — Production Hardening Completion Report

> What was completed in Phase 20, what remains, and the verification evidence.
> **Constraints honored:** no `packages/core` runtime change, no breaking API/CLI
> change, no test regressions (no test files modified), plugin architecture and
> signing/provenance workflows untouched.

## Completed (applied + verified this phase)

### Priority 0 — Platform hardening tooling (can't be enforced from the tree → generated)
- **`.github/repository-settings.json`** — settings-as-code for branch protection:
  required Code-Owner reviews, required status checks (named to match the workflow
  jobs), signed commits, linear history, no force-push, `enforce_admins`, plus
  secret-scanning + push-protection toggles. Apply via UI / `gh` / repository-settings app.
- Operator runbooks already exist and remain authoritative:
  `security/KEY-ROTATION-RUNBOOK.md` (rotation + emergency revocation + history
  purge with `git filter-repo` + rollback), `security/BRANCH-PROTECTION-REVIEW.md`,
  `plans/OUTSTANDING-ACTIONS.md` (P0 register).

### Priority 4 — Supply-chain release verification
- **`scripts/security/verify-release.mjs`** + **`npm run verify:signatures`** —
  dependency-free verifier that checks every plugin's `manifest.signed.json` against
  the embedded official anchor (DER-SHA256 `3ae9add0…`) using the framework's own
  `verifyManifest`, and optionally runs `npm audit signatures` (`-- --provenance`).
  **Verified: all 21 plugins pass.**

### Priority 5 — Infrastructure
- **All compose host ports bound to `127.0.0.1`** (postgres/mysql/kafka/rabbitmq/
  meili/elastic/azurite/gcs/app — 11 mappings across 6 files), so local dev/test
  services are not exposed on the LAN. **Validated with `docker compose config` (all 6).**
- Base images already digest-pinned; `infra/docker/Dockerfile` is multi-stage,
  distroless, non-root (verified in `audits/DOCKER-REVIEW.md`).

### Bug fix
- **`scripts/cloud/prereqs.mjs`** cloudflare path corrected
  (`deploy/cloudflare-workers/wrangler.toml` → `infra/examples/cloudflare/wrangler.toml`);
  the wrangler dry-run in `deploy-verify` now resolves the real config. `node --check` clean.

## Verification evidence
- `npm run verify:signatures` → "All 21 plugin manifest(s) verified against the official anchor ✓".
- `docker compose -f infra/docker/compose/*.yml config -q` → all 6 OK after port binding.
- `node --check` clean on edited scripts; `package.json` parses; diagnostics clean on all new/edited files.
- `repository-policy` dry-runs still green (root allowlist, no RESTRICTED tracked, no plugin Dockerfiles).

## Remaining — operator-only (cannot be automated from the tree)
Tracked in `plans/OUTSTANDING-ACTIONS.md`:
- **[OPERATOR]** Apply `.github/repository-settings.json` (branch protection); enable
  Secret Scanning + Push Protection; purge leaked-key history; relocate on-disk keys;
  require signed commits; add a real PGP key; move SEO files to the website repo.

## Remaining — repository completion (safe but deferred for batching/verification)
- **`app-*` → `examples/scaffold-*`** — references are contained (`.github/zizmor.yml`
  comment + `.github/dependabot.yml` directories; no workflow/script path depends on
  them). Deferred so the dependabot/zizmor updates land atomically with the move on a
  branch with CI verification. Steps in `plans/REPOSITORY-CLEANUP-PLAN.md`.
- **`web/` lockfiles** — needs `npm install` (network) in 4 dirs; commit `package-lock.json`.
- **CODEOWNERS teams** — fill `.github/CODEOWNERS.proposed` placeholders, then activate.

## Remaining — plugin runtime (out of governance scope — separate PR)
The thin wrapper plugins for **stripe, sendgrid, twilio, auth0, s3, r2** have their
canonical implementations under **`packages/core/src/platform/plugins/official/`** —
adding HTTP timeouts/webhook verifiers there would modify the **frozen `packages/core`**,
which Phase 20 forbids. The remaining HTTP plugins (paypal, openai, clerk, supabase,
firebase) live in their own packages and can be hardened in a dedicated, tested PR.
These items (timeouts, webhook verifiers, TLS options) are tracked in
`audits/PLUGIN-SECURITY-REPORT.md` and `plans/OUTSTANDING-ACTIONS.md` (P1/P2 [RUNTIME]).

> **Important scope note:** the Phase 20 "Priority 2/3 plugin hardening" cannot be
> fully done without touching `packages/core` (which is frozen) for 6 of the plugins.
> Those are explicitly deferred to preserve the no-core-change guarantee, rather than
> violate it. This is a deliberate, documented decision — not an omission.
