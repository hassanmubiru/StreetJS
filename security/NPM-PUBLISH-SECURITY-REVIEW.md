# StreetJS npm Publishing Security Review

> Review of `.npmrc`, publish/plugin/release workflows, and signing/provenance.
> Read-only, evidence-based.

## Findings

| Check | Result | Evidence |
|---|---|---|
| No tokens in `.npmrc` | ✅ PASS | `.npmrc` contains only `legacy-peer-deps=true` (no `_authToken`) |
| Provenance enabled | ✅ PASS | `publish-plugins.yml`, `publish-frontend.yml`, `publish-orm.yml`, `ci-cd.yml` use `npm publish --provenance` with `id-token: write` |
| Signed manifests required | ✅ PASS | `publish-plugins.yml` signs all 21 plugins and **fails unless each verifies against `officialPluginPublicKey()`** ("Verify packed manifest is officially signed" step) |
| Publish requires CI | ✅ PASS (policy) | `sign.mjs` is fail-closed (refuses ephemeral keys); `STREET_PLUGIN_SIGNING_KEY` is a CI secret; CHARTER §5 forbids local publish |
| `NODE_AUTH_TOKEN` from secret | ✅ PASS | `secrets.NPM_TOKEN` injected at runtime; never persisted |
| Idempotent publish | ✅ PASS | version-already-published is skipped (no E409 churn) |

## Trust model (VERIFIED)
- One official Ed25519 key; public anchor embedded in
  `packages/core/src/platform/plugins/official-key.ts` (`3ae9add0`); private half
  CI-only. All 21 plugin `manifest.pub` match the anchor.
- Publish path: tag/`workflow_dispatch` → build → sign (CI) → verify-against-anchor
  → `npm publish --provenance`. The `verify-signing-anchor` job
  (`block-private-keys.yml`) + `security-baseline.yml` enforce anchor agreement on
  every push.

## Gaps / recommendations
| Severity | Item | Recommendation |
|---|---|---|
| MEDIUM | Local publish still technically possible (npm not blocked at registry) | Enforce via branch protection + an npm **publish automation token scoped to CI** + 2FA/automation policy on the npm org; document "CI-only publish" as org policy |
| LOW | Install-side verification | Document/ship a consumer-side `verifyManifest` step + cosign verification for release tarballs so installers can independently verify provenance |
| LOW | Single signing key, no `keyId`/rotation metadata | Add `keyId`/`alg` to signed manifests + a revocation path (see `KEY-ROTATION-RUNBOOK.md`); consider Sigstore keyless |
| LOW | Third-party publish actions pinning | Ensure all publish-workflow actions are SHA-pinned (core ones are; audit periodically) |

## Verdict
npm publishing posture is **strong**: provenance on, signing enforced in CI,
no tokens committed, anchor verified. Residual items are hardening (registry-side
publish restriction, install-side verification, key rotation metadata).
