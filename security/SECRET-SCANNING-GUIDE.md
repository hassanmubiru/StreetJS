# StreetJS Secret Scanning & Push Protection — Operator Guide

> How to enable and validate GitHub Secret Scanning + Push Protection (Phase A).
> Repo-side scanning (gitleaks + trufflehog) already runs in `secret-scan.yml`;
> this covers the **platform** layer that can't be enabled from the tree.

## Enable (GitHub UI)
Settings → **Code security and analysis**:
- [ ] **Secret scanning** → Enable
- [ ] **Push protection** → Enable
- [ ] **Dependabot alerts** + **Dependabot security updates** → Enable
(Also captured in `.github/repository-settings.json` for settings-as-code tooling.)

## Enable (gh CLI)
```bash
gh api -X PATCH repos/<org>/StreetJS \
  -f security_and_analysis[secret_scanning][status]=enabled \
  -f security_and_analysis[secret_scanning_push_protection][status]=enabled
```

## Operator checklist
- [ ] Secret scanning shows "Enabled" in repo settings.
- [ ] Push protection blocks a test push containing a fake token (see validation).
- [ ] Alerts route to the security team.
- [ ] Branch protection requires the `secret-scan` check (see `BRANCH-PROTECTION-REVIEW.md`).

## Validation
**Repo-side (local, safe):**
```bash
gitleaks detect --no-git --source . --config .gitleaks.toml --redact   # working tree
npm run verify:signatures        # manifest/anchor integrity
```
**Push protection (use a throwaway branch + obviously-fake secret):**
```bash
git checkout -b test/push-protection
printf 'AKIAIOSFODNN7EXAMPLE\n' > /tmp/fake && git add -f /tmp/fake 2>/dev/null || true
# Attempt a push; GitHub should BLOCK it with a push-protection error.
# Then delete the branch — never merge.
```
> Use only clearly-fake example values; never a real secret.

## Layered model
1. `.gitignore` (RESTRICTED patterns) — prevents staging.
2. `.githooks/pre-push` — client-side key block.
3. `secret-scan.yml` (gitleaks + trufflehog) — CI on push/PR.
4. **GitHub Secret Scanning + Push Protection** — server-side (this guide).
5. `secrets-guard` / `block-private-keys.yml` — release-chain gate.

## Note on the known historical finding
The leaked key in commit `d7bbfc40` is allowlisted by commit SHA in `.gitleaks.toml`
(documented, distrusted, pending history purge). GitHub Secret Scanning may still
surface it from history until the purge — that's expected; track via `OUTSTANDING-ACTIONS.md` P0.
