# StreetJS Trust Center

> Single reference for how StreetJS establishes and maintains trust: plugin
> signing, provenance, disclosure, releases, dependencies, secret scanning, and
> CI/CD protections. For consumers, contributors, and security reviewers.

## Plugin signing
- Every official `@streetjs/plugin-*` ships an Ed25519-signed `manifest.signed.json`
  + `manifest.pub`. Consumers verify against the official public key embedded in
  `packages/core/src/platform/plugins/official-key.ts` (`officialPluginPublicKey()`),
  the default trust anchor in `registry.ts`.
- Current anchor DER-SHA256: `3ae9add05d71dc5a17992caf192b1e465bcb9b2f2633231df44dbe2db8444b84`.
- Signing happens **only in CI** from the `STREET_PLUGIN_SIGNING_KEY` secret;
  `sign.mjs` is fail-closed. CI verifies every published manifest against the anchor
  (`publish-plugins.yml`) and on every push (`verify-signing-anchor`,
  `security-baseline.yml`).
- Key rotation/revocation procedure: `security/KEY-ROTATION-RUNBOOK.md`.

## Provenance
- All packages publish with npm provenance (`--provenance`, OIDC `id-token: write`).
- Release tarballs are signed (cosign/Sigstore in `ci-cd.yml`).

## Security disclosure process
- Private reporting via GitHub Security Advisories (root `SECURITY.md`).
- Acknowledgement ≤ 3 business days; triage ≤ 7; CVSS v3.1 severity windows
  (Critical ≤ 7d, High ≤ 14d, Medium ≤ 30d).
- Per-plugin `SECURITY.md` points to the central policy.

## Release process
- Tag-triggered (`v*.*.*`); version must match tag (`pre-push` + CI checks).
- Gated by `secrets-guard` (rule #1) → `build-and-test` → sign → verify → publish.
- SBOM generated in CI and attached to releases (artifacts, not committed).

## Dependency policy
- Dependabot enabled (`.github/dependabot.yml`).
- `dependency-review.yml` blocks PRs introducing vulnerable/incompatible deps.
- High-severity `npm audit` gate (`policy-checks` job).
- Third-party GitHub Actions pinned by commit SHA (core workflows); newer security
  workflows pin `actions/checkout` by SHA (gitleaks/trufflehog SHA-pinning is a
  tracked follow-up).

## Secret scanning
- `.gitleaks.toml` (6 explicit rules incl. PEM private-key + cloud creds) via
  `secret-scan.yml` on every push/PR.
- `trufflesecurity/trufflehog` (SHA-pinned, `--only-verified`) full-history scan in `secret-scan.yml`.
- GitHub Secret Scanning + Push Protection: **enable at platform level** (operator).
- `.gitignore` + `secrets-guard` + `block-private-keys.yml` +
  `security-baseline.yml` forbidden-files prevent committing RESTRICTED material.

## CI/CD protections
- Least-privilege `permissions:` (default `contents: read`; job-scoped elevation).
- No `pull_request_target`.
- `secrets-guard` is the first job in `ci-cd.yml` and gates the release chain.
- `repository-policy.yml` enforces structure (root allowlist, no RESTRICTED files,
  governance-doc presence).
- CodeQL, OpenSSF Scorecard, DAST, zizmor (workflow static analysis).

## Classification & governance
- `security/SECURITY-CLASSIFICATION.md` — Public / Internal / Restricted tiers.
- `governance/CHARTER.md` — root/security/audit/infra/plugin/release/signing/
  workflow/secret/documentation policies.
- `security/PLUGIN-SECURITY-STANDARD.md` — mandatory plugin baseline.

## Known residuals (transparency)
- Leaked historical signing key (now **distrusted**) not yet purged from history
  (`KEY-ROTATION-RUNBOOK.md` §7).
- Several `node:https` plugins lack outbound timeouts; some providers lack webhook
  verifiers (`PLUGIN-SECURITY-AUDIT.md`).
- Branch protection + Push Protection are platform settings pending enablement
  (`BRANCH-PROTECTION-REVIEW.md`).
