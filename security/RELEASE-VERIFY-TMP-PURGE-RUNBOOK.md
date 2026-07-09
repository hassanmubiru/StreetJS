# Runbook — Purge `.release-verify-tmp*` blobs from git history

**Owner:** [OPERATOR] (requires force-push to `main`; destructive)
**Trigger:** GitHub secret-scanning alert #16 (`google_api_key`), plus stray large
binaries committed by ad-hoc release-verify runs.
**Status:** NOT YET RUN — documented for operator execution. Nothing in this file
executes automatically.

---

## Background

An ad-hoc release-verification run downloaded the **gitleaks tool binary** into
`.release-verify-tmp3/` and it was auto-committed:

- `0a7147b4` — added `.release-verify-tmp3/gitleaks` (21 MB ELF) +
  `.release-verify-tmp3/gitleaks.tar.gz` (8 MB).

GitHub secret-scanning opened **16 alerts (#1–#16)**, every one detected in that
same file `.release-verify-tmp3/gitleaks` at consecutive lines **19541–19556** —
a block of Google API keys that are gitleaks' own **detection-rule test
fixtures** embedded in the compiled tool. They are **not StreetJS-owned
credentials**, so there is nothing for StreetJS to rotate/revoke. Two are
self-evidently fixtures: **#4** `AIzaSyabcdefghijklmnopqrstuvwxyz1234567` (a
literal alphabet) and **#11** `AIzay…` (a malformed, non-`AIzaSy` prefix). All 16
alerts should be closed as false positives (third-party test fixtures) once
history is cleaned — a single purge of the binary resolves all of them at once.

Related earlier stray commits from the same class (scaffold files, not secrets),
worth purging in the same pass:

- `fe09903b` — `.release-verify-tmp/` (README, package.json, lockfile, src/main.ts, tsconfig)
- `3f9408cb`, `5ec72378`, `0f1cf4a3` — `.release-verify-tmp2/` (package.json, lockfile, src/main.ts, tsconfig)

## Already done (non-destructive, on `main`)

- `.gitignore` now ignores `.release-verify-tmp*/` and `release-verify-tmp*/`
  (prevents recurrence — verified).
- `.gitleaks.toml` allowlists the fixture key so the repo's own gitleaks gate
  does not re-flag it against history until this purge lands.
- The blobs are already absent from the `main` tip (they were removed in later
  commits); this runbook removes them from **history**.

## Preconditions

- Coordinate a maintenance window; this rewrites history and force-pushes `main`.
- Ensure no in-flight PRs you care about (rebase them after; their SHAs change).
- Have `git-filter-repo` installed (`pipx install git-filter-repo` or
  `brew install git-filter-repo`).
- Branch protection on `main` currently blocks force-push, linear history, and
  requires signed commits — you must temporarily relax force-push protection (or
  use the admin path) for the push, then re-enable it. Re-sign the rewritten
  tip if required.

## Procedure

```bash
# 0. Fresh mirror clone (never rewrite your working checkout).
#    Use HTTPS via the gh CLI credential helper (SSH keys are not configured on
#    this machine — `git@github.com` returns "Permission denied (publickey)").
#    Run once so git uses your gh token for github.com over HTTPS:
gh auth setup-git
git clone --mirror https://github.com/hassanmubiru/StreetJS.git streetjs-purge.git
cd streetjs-purge.git

# 1. Remove every .release-verify-tmp* path from ALL history (branches + tags).
git filter-repo --force \
  --path-glob '.release-verify-tmp/*' \
  --path-glob '.release-verify-tmp2/*' \
  --path-glob '.release-verify-tmp3/*' \
  --invert-paths

# 2. Verify the blobs and the flagged string are gone from history.
git log --all --oneline --name-only --diff-filter=A | grep -i 'release-verify-tmp' && echo "STILL PRESENT — STOP" || echo "clean ✔"

# 3. Force-push the rewritten history (requires branch protection temporarily
#    relaxed for force-push on main; re-enable immediately after).
git push --force --mirror

# 4. Re-enable branch protection (force-push disabled, linear history, signed
#    commits) exactly as before.
```

## After the rewrite

1. **Ask GitHub Support to purge cached copies + PR refs** referencing the old
   blobs (secret scanning also indexes `refs/pull/*` and internal caches that a
   force-push does not clear). Reference commit `0a7147b4` and alert #16. This is
   the same step used for the 2026 signing-key purge (OUTSTANDING-ACTIONS #3).
2. **Close secret-scanning alerts #1–#16** as false positives / used-in-tests
   once Support confirms the blob is gone (all 16 are gitleaks fixtures in the
   same binary, not StreetJS secrets; no Google-side revocation is required —
   but if you have any doubt any could be a real key your org owns, revoke it in
   Google Cloud Console first). Removing the single binary blob resolves all 16
   alerts at once.
3. All collaborators must **re-clone or hard-reset** to the rewritten `main`
   (old clones still contain the blobs).
4. Rebase any open PRs onto the new `main` (their base SHAs changed).
5. Once Support confirms full purge, the `.gitleaks.toml` allowlist entry for the
   fixture key MAY be removed (optional — it is harmless to keep as documentation).

## Rollback

The mirror clone is a separate copy; if anything goes wrong before step 3, delete
`streetjs-purge.git` and start over from step 0. After step 3 (force-push), the
pre-rewrite tips are recoverable from local reflogs / any un-updated clone for a
short window, and from GitHub's reflog via Support if needed.
