# StreetJS Repository Governance Charter

> Normative governance rules for the StreetJS ecosystem repository.
> Adopted from `../security/PHASE-19-MASTER-AUDIT.md` §7. Referenced by
> `CONTRIBUTING.md` and `SECURITY.md`. Enforced by CI where noted.

## 1. Root folder policy
Root holds only: project metadata (`README.md`, `LICENSE`, `CHANGELOG.md`,
`CITATION.cff`), governance entry files (`SECURITY.md`, `GOVERNANCE.md`,
`MAINTAINERS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`), the workspace manifest +
lockfile (`package.json`, `package-lock.json`, `.npmrc`), tooling dotfiles, and the
standard directories. No strategy docs, completed audits, generated artifacts, or
scaffold apps at root. Enforced by a CI `check-root` gate.

## 2. Security document policy
All security analyses live under `security/`. The public reporting policy stays in
root `SECURITY.md` and links to them. Security documents must never contain secret
values — only fingerprints, paths, and process.

## 3. Audit document policy
Point-in-time reports live under `audits/<YYYY>/`, are immutable once published, and
link forward to any superseding correction.

## 4. Infrastructure policy
All deploy/monitoring/container assets live under `infra/`, templated with
placeholders only — no real cloud account IDs, ARNs, internal DNS, cluster names, or
monitoring endpoints. CI greps for these on every PR.

## 5. Plugin publication policy
A plugin may publish only via `publish-plugins.yml` (CI), which signs from
`STREET_PLUGIN_SIGNING_KEY` and verifies against `officialPluginPublicKey()`. No
local `npm publish` of official plugins. Every plugin ships `README.md`,
`manifest.json`, `manifest.signed.json`, `manifest.pub`, and a SECURITY pointer;
tests + coverage gate required before first publish.

## 6. Release policy
Releases are tag-triggered; the package version must match the tag; npm provenance
(`--provenance`) is required; an SBOM is generated and attached; the changelog is
updated.

## 7. Signing policy
Exactly one active official key. Its private half lives only in CI secrets / KMS —
never on a workstation or in the tree. Scheduled rotation and a documented revocation
procedure apply. The embedded anchor (`official-key.ts`) and all plugin manifests must
agree; CI enforces this (`verify-signing-anchor`).

## 8. Workflow policy
Least-privilege `permissions:` (default `contents: read`); third-party actions pinned
by commit SHA; `persist-credentials: false`; zizmor clean. The `secrets-guard` job is
rule #1 and gates the release chain.

## 9. Secret management policy
Secrets live only in GitHub Actions secrets, a secrets manager, or a local `.env`
(gitignored). No `*.pem`/`*.key`/`*.p12`/`*.pfx` in the tree. gitleaks + push
protection + secret scanning enforce this server-side.

## 10. Documentation policy
Public docs under `docs/`; internal strategy under `plans/` (or a private repo);
generated docs/artifacts produced in CI, not committed.
