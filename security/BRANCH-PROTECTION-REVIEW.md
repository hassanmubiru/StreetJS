# StreetJS Branch Protection Review

> Branch-protection and release-protection posture. Branch protection itself is a
> **GitHub platform setting** not stored in the repo, so the repo-side enablers are
> verified here and the platform settings are given as required configuration.

## Repo-side enablers (VERIFIED present)
- `.github/CODEOWNERS` — path ownership (enables "require Code Owner review").
- Status-check providers exist: `secrets-guard`, `build-and-test`,
  `verify-signing-anchor`, `secret-scan`, `codeql`, `scorecard`, `repository-policy`,
  `security-baseline`, `dependency-review`, `dast`.
- `.githooks/pre-push` — blocks mismatched release tags **and** private-key pushes
  (client-side; advisory).
- No `pull_request_target` in any workflow (no privileged-fork-PR risk).
- Workflow `permissions:` default to `contents: read`; elevation is job-scoped.

## Required GitHub settings for `main` (configure in Settings → Branches)
| Setting | Required value |
|---|---|
| Require a pull request before merging | ✅ |
| Require approvals | ≥ 1 |
| Require review from Code Owners | ✅ |
| Dismiss stale approvals on new commits | ✅ |
| Require status checks to pass | ✅ — `secrets-guard`, `build-and-test`, `verify-signing-anchor`, `secret-scan`, `codeql`, `repository-policy`, `security-baseline` |
| Require branches up to date before merge | ✅ |
| Require linear history | ✅ |
| Require signed commits | ✅ (recommended; pairs with `pre-push` tag check) |
| Block force pushes | ✅ |
| Restrict who can push | maintainers only |
| Include administrators | ✅ (no bypass) |

## Release protection
- Tags `v*.*.*` trigger publish only after `build-and-test` (which `needs: secrets-guard`).
- `pre-push` blocks tags whose version ≠ package version (`check-tag-version.mjs`).
- Signing happens in CI; `main` is not pushed to by signing workflows (artifact upload).

## Gaps / actions
| Severity | Item | Action |
|---|---|---|
| HIGH (process) | Branch protection cannot be verified from the repo | Apply the table above; export settings to an `allstar`/`repo-settings`-as-code file for auditability |
| MEDIUM | Signed-commits not enforced | Enable "Require signed commits"; document GPG/SSH signing in CONTRIBUTING |
| LOW | Required checks list drifts as workflows change | Keep the required-checks set in sync with `security-baseline.yml`/`repository-policy.yml` |

## Verdict
All repo-side enablers are in place; the remaining work is **applying the platform
branch-protection settings** (operator) and enabling signed commits.
