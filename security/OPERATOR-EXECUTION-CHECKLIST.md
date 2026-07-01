# StreetJS — Operator Execution Checklist (P0 platform actions)

> **Audience:** a repo **admin/operator** with `gh` authenticated (`gh auth login`)
> and org-owner rights. These steps **cannot be performed from inside the repo**
> (they are GitHub platform settings or history-rewriting/secret operations), so
> they are sequenced here as copy-paste commands.
>
> **Source of truth this references (do not duplicate):**
> `security/BRANCH-PROTECTION-REVIEW.md`, `.github/repository-settings.json`,
> `security/KEY-ROTATION-RUNBOOK.md` (§7 purge, §8 relocation),
> `security/SECRET-SCANNING-GUIDE.md`, `plans/OUTSTANDING-ACTIONS.md` (P0).
>
> Set once: `OWNER=hassanmubiru REPO=StreetJS` (adjust if the org changes).

```bash
OWNER=hassanmubiru
REPO=StreetJS
```

---

## Order of operations

Do **#3 (history purge)** and **#4 (key relocation)** on a coordinated maintenance
window (they rewrite history / move secrets), then the rest. Branch protection
(#1) is applied last so it doesn't block the coordinated force-push in #3.

---

## #2 — Secret scanning + push protection  *(do first; non-disruptive)*

```bash
# Nested `security_and_analysis` must be sent as a JSON body — `gh api -f`
# cannot build nested objects (bracket strings are sent literally → 404/422).
gh api --method PATCH "repos/$OWNER/$REPO" --input - <<'JSON'
{
  "security_and_analysis": {
    "secret_scanning": { "status": "enabled" },
    "secret_scanning_push_protection": { "status": "enabled" },
    "dependabot_security_updates": { "status": "enabled" }
  }
}
JSON
```

> Public repos: secret scanning + push protection are free. Private repos require
> GitHub Advanced Security (otherwise this returns 403/422). A `404` usually means
> the `repos/` prefix is missing or the path has a stray space.

**Done when:** the three toggles read `enabled` in *Settings → Code security*.
Verify: `gh api "repos/$OWNER/$REPO" --jq '.security_and_analysis'`.

---

## #3 — Purge the leaked signing-key blob from history

Full procedure: **`security/KEY-ROTATION-RUNBOOK.md` §7.** Summary:

```bash
# On a FRESH mirror clone (never your working clone):
git clone --mirror "https://github.com/$OWNER/$REPO.git" streetjs-mirror
cd streetjs-mirror

# Requires git-filter-repo (https://github.com/newren/git-filter-repo)
git filter-repo --invert-paths --path street-signing.key.pem --force

# Coordinated force-push (announce first — everyone must re-clone afterwards):
git push --force --all
git push --force --tags
```

**Done when:**
`git log --all --full-history -- street-signing.key.pem` is empty, and the
`.gitleaks.toml` commit-scoped allowlist entry for the historical blob can be
removed. **All contributors must re-clone** after the force-push.

> Because the key was public in history, rotation already happened (the embedded
> anchor + all 21 `manifest.pub` were re-signed). The purge removes the blob; it
> does **not** restore trust in the old key — that key stays distrusted.

---

## #4 — Relocate on-disk private keys to a secrets manager

Full procedure: **`security/KEY-ROTATION-RUNBOOK.md` §8.** The signing key already
lives only as the `STREET_PLUGIN_SIGNING_KEY` **CI secret**; ensure no key files
remain in any working tree or backup:

```bash
# Confirm nothing key-like is tracked (must print nothing):
git ls-files | grep -E '\.(pem|key|p12|pfx)$' || echo "clean"

# Move any local-only key files OUT of the repo tree to your secrets manager
# (e.g. 1Password / Vault / cloud KMS), then shred the local copies.
```

**Done when:** no key files in the working tree; the CI secret is the only copy.

---

## #1 + #5 — Branch protection (incl. required signed commits)

Applies the posture in `.github/repository-settings.json` /
`security/BRANCH-PROTECTION-REVIEW.md`. Status-check **contexts must match job
names exactly**.

```bash
gh api -X PUT "repos/$OWNER/$REPO/branches/main/protection" \
  --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Secrets Guard (block private keys)",
      "Core (Node 22)",
      "Core (Node 24)",
      "verify-signing-anchor",
      "gitleaks",
      "CodeQL",
      "Root folder allowlist",
      "Plugin security standard"
    ]
  },
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "require_code_owner_reviews": true,
    "dismiss_stale_reviews": true
  },
  "required_signatures": true,
  "required_linear_history": true,
  "enforce_admins": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "restrictions": null
}
JSON
```

> `gh api` sets `required_signatures` via this payload on most versions; if your
> `gh` rejects it inline, enable it separately:
> `gh api -X POST "repos/$OWNER/$REPO/branches/main/protection/required_signatures" -H "Accept: application/vnd.github+json"`

**Done when:** a direct push to `main` is rejected, and a PR without a Code-Owner
review / passing checks cannot merge. Verify:
`gh api "repos/$OWNER/$REPO/branches/main/protection" --jq '.required_signatures.enabled, .required_status_checks.contexts'`.

After this, contributors must sign commits — document the GPG/SSH setup in
`CONTRIBUTING.md` (see BRANCH-PROTECTION-REVIEW "MEDIUM" gap).

---

## #20 — Add a real PGP key to `SECURITY.md`

Replace the placeholder fingerprint in `SECURITY.md` with your real public key.
**Never commit the private key.** Publish the public key to a keyserver and paste
the fingerprint + a link.

```bash
gpg --armor --export <KEY_ID>   # public block → paste/link in SECURITY.md
```

---

## #11 — SEO verification files (website repo)

`BingSiteAuth.xml` and `googledf*.html` were removed from this repo (they are not
framework artifacts). Re-add them to the **website/Pages repo** that serves the
domain, not here.

---

## Post-completion

- Remove the historical-blob allowlist entry from `.gitleaks.toml` (after #3).
- Re-run OpenSSF Scorecard (`scorecard.yml`) — Branch-Protection / Signed-Releases
  / Token-Permissions should rise once #1/#2 land.
- Tick these off in `plans/OUTSTANDING-ACTIONS.md` P0 and note the date.
