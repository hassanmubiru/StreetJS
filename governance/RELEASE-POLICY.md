# StreetJS Release Policy

> Canonical release governance. Backed by `ci-cd.yml`, `publish-plugins.yml`,
> `.githooks/pre-push`, and `scripts/check-tag-version.mjs`.

## Semantic Versioning
StreetJS follows [SemVer 2.0](https://semver.org). MAJOR = breaking, MINOR =
backward-compatible features, PATCH = fixes. The published `@streetjs/core` line is
`1.0.x`; plugins version independently under `@streetjs/plugin-*`.

## Release cadence
- **Patch:** as needed for fixes/security.
- **Minor:** on a rolling basis as features land (composition-only where possible).
- **Major:** infrequent, with a migration guide and deprecation window.

## Breaking-change policy
- No breaking change without a MAJOR bump + migration guide + changelog entry.
- Breaking changes require an RFC (`rfcs/`) and Code-Owner approval.
- Repository reorganizations that don't change published package paths/APIs are
  **not** breaking (e.g. the infra/docs moves in `[Unreleased]`).

## Deprecation policy
- Deprecations are announced in the changelog and via runtime warnings where
  feasible, kept for **at least one MINOR** before removal in the next MAJOR.

## Security releases
- Critical/High fixes ship as PATCH on the supported `1.0.x` line within the
  `SECURITY.md` SLA (Critical ≤ 7d, High ≤ 14d), with a GHSA + CVE.

## Emergency releases
- Out-of-band PATCH permitted for actively-exploited issues; still tag-gated,
  signed, and provenance-published. Post-hoc advisory + changelog required.

## Plugin releases
- Publish **only** via `publish-plugins.yml` (CI): build → Ed25519-sign from the
  CI secret → verify against `officialPluginPublicKey()` → `npm publish --provenance`.
- No local `npm publish` of official plugins (enforced by policy; `sign.mjs` is
  fail-closed). Each plugin must meet `security/PLUGIN-SECURITY-STANDARD.md`.

## Marketplace releases
- Marketplace data is generated from on-disk trust signals
  (`scripts/gen-plugins-data.mjs`: `manifest.signed.json` presence, dependency-free
  status). A plugin appears only when non-`private` and not `streetjs.unlisted`.

## Release integrity (every release)
- Version == git tag (`pre-push` + CI gate).
- npm provenance attestation; CycloneDX SBOM attached.
- cosign/Sigstore signature on release artifacts.
- `secrets-guard` (rule #1) gates the entire build→publish chain.

## LTS policy
- The current supported line is `1.0.x` (`docs/lts-policy.md`). LTS designation,
  support windows, and EOL dates are published per major line.
