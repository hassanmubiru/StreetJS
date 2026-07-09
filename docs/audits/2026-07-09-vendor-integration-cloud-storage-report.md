# Vendor Integration: Cloud Storage Providers (Supabase / GCS / Azure / Backblaze B2)

**Date:** 2026-07-09
**Scope:** Wire real cloud-provider credentials into `.github/workflows/vendor-integration.yml` so `packages/storage`'s live provider round-trip tests exercise genuine cloud APIs instead of honest-skips, and verify the result with real CI runs (no fabricated or simulated results).

## Summary

| Provider | Credentials | SDK install | Live round-trip | Status |
|---|---|---|---|---|
| Supabase | Present (`SUPABASE_URL`, `SUPABASE_KEY`, `SUPABASE_BUCKET`) | Verified working | Ran, failed: `Bucket not found` | **NOT VERIFIED — misconfigured bucket name** |
| GCS | Present (`GCS_BUCKET`, `GCS_PROJECT_ID`, `GCS_SERVICE_ACCOUNT_JSON`) | Verified working | Ran, failed: JWT signing error | **NOT VERIFIED — `GCS_SERVICE_ACCOUNT_JSON` is not a valid service-account key file** |
| Azure | Absent | N/A | Honest skip | **NOT VERIFIED — no credentials provided** |
| Backblaze B2 | Absent | N/A | Honest skip | **NOT VERIFIED — no credentials provided** |

No provider's live round-trip passed in this engagement. What *was* verified is that the workflow infrastructure itself is now correct end-to-end: given valid credentials and an installed SDK, the driver code genuinely attempts a live network call rather than silently reporting a false pass. The two failures above are real, live API responses (a real Supabase "bucket not found" and a real Google JWT-signing rejection) — not skips, not mocks, not fabricated results.

## What was fixed (verified via real CI runs)

1. **`vendor-integration.yml` wiring.** Added env passthrough for all four providers' secrets, a build step for `packages/storage`, a step that installs the optional cloud SDKs, GCS service-account file materialization, and the actual `npm run test -w packages/storage` run. Reordered before the pre-existing Auth0 step so an unrelated Auth0 issue can never block these independent checks.

2. **A real npm workspace-install bug.** `npm install <pkgs> --package-lock=false` run with cwd inside `packages/storage/` (via `working-directory:` in the workflow, or `cd` locally) silently no-ops: `npm warn workspaces @streetjs/storage in filter set, but no workspace folder present`. It never touches `packages/storage/node_modules/`. Root cause: npm 10.8.2 auto-detects a workspace filter from cwd but can't resolve it in that context. Fix: run the install from the repo root with `--prefix packages/storage`, which bypasses workspace auto-detection while still skipping the lockfile save. Verified locally (packages genuinely landed in `packages/storage/node_modules/`, confirmed via `require.resolve`) and in CI (the install step now succeeds and the driver code's own dynamic `import()` of the SDK genuinely resolves).

3. **A real test-isolation bug this change exposed.** Three pre-existing unit tests (`supabase-driver.test.ts`, `gcs-driver.test.ts`, `azure-driver.test.ts`) assert `connectXDriver` throws `StorageConfigError` specifically because the SDK is unresolvable in the process. That precondition was always silently true because no prior CI job ever installed these SDKs. Once genuinely installed, `sdk.createClient()` succeeds synchronously and the assertion fails. Fixed by adding an `isSdkResolvable()` probe (in `contract.ts`) so each of the three tests honestly skips — via `t.skip()`, never a false pass — when the SDK it's testing the absence of happens to be present, consistent with this package's existing honest-skip convention. Verified: local suite is 374 tests / 364 pass / 0 fail / 10 skip with SDKs installed (the 3 new honest-skips plus the pre-existing 7), and 367 pass / 0 fail / 7 skip in the normal no-SDK baseline.

4. **A real `npm ci` regression from this session's diagnostics.** While isolating the workspace-install bug (item 2), a throwaway `left-pad@1.3.0` dependency and three `peerDependencies` version pins (`^12.25.0` etc., narrowed from the original `>=12.0.0` etc.) were accidentally committed into `packages/storage/package.json` by this environment's auto-commit behavior. This broke `npm ci` in CI (`Missing: left-pad@1.3.0 from lock file`), which was caught by the very first re-dispatch after the fix above. Reverted both to their pre-session state; verified with a clean `rm -rf node_modules && npm ci` (exit 0) and a fresh git diff against the prior committed baseline.

## What was not fixed (credentials/configuration, outside this engagement's authority)

- **Supabase `Bucket not found`.** `SUPABASE_BUCKET`'s value does not match an actual bucket name in the Supabase project's Storage. Needs to be corrected by the user in the Supabase dashboard or via `gh secret set SUPABASE_BUCKET`.
- **GCS JWT signing failure.** A diagnostic step (added temporarily, printed only structural shape — never secret values — then removed) showed `GCS_SERVICE_ACCOUNT_JSON` is 66 bytes and starts with `service-10...`, i.e. not JSON at all — most likely a service-account email/ID fragment rather than the full downloaded key file content. The correct value is the entire contents of the JSON key file from GCP Console → IAM & Admin → Service Accounts → Keys → Add Key → Create new key → JSON (several KB, starting with `{"type": "service_account", ...}`, including `private_key` and `client_email`). The user attempted to update this secret; `gh secret list` timestamps showed no change, and by mutual decision this was deferred rather than re-investigated further in this engagement.
- **Azure / Backblaze B2.** No credentials were ever provided for these two providers. Their live round-trips correctly and honestly report as skipped, not passed.

## Verification performed

- Local: `npm run build` (exit 0) and `npm test` (374/364/0/10 with SDKs installed, 374/367/0/7 without) in `packages/storage`.
- Local: `rm -rf node_modules && npm ci` from repo root (exit 0), confirming the lockfile is in sync after reverting the stray dependency/version-pin regression.
- CI: four real `vendor-integration.yml` dispatches via `gh workflow run` + `gh run view --log-failed`, reading actual TAP output line-by-line rather than trusting step conclusions. Progression across dispatches: initial run failed at `./.github/actions/setup` (unrelated `npm ci` regression, found and fixed) → next run reached the actual provider tests and showed the SDKs installing and genuinely being exercised (Supabase/GCS attempted live calls; Azure honestly skipped) → final runs after the credential-fix attempt reproduced identical errors, confirming the secret updates did not take effect.
- Git: confirmed local `HEAD` matches `origin/main` via `git ls-remote` after every consequential change, and `git status --porcelain` clean before/after cleanup of scratch diagnostic files.

## Outstanding

Logged for follow-up whenever the user has time to correct the two secrets:
- `SUPABASE_BUCKET` — set to an actual bucket name in the target Supabase project's Storage.
- `GCS_SERVICE_ACCOUNT_JSON` — set to the full JSON key file content (not an email/ID fragment).

Once corrected, re-dispatch `gh workflow run vendor-integration.yml --repo hassanmubiru/StreetJS` and inspect `gh run view <id> --log-failed` for the `[integration] supabase driver live round-trip` / `[integration] gcs driver live round-trip` subtests to confirm a genuine pass (not skip, not fail).
