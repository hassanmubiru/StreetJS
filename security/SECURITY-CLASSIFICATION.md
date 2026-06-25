# StreetJS Repository Security Classification

> Classification policy for every asset in the StreetJS repository. Three tiers:
> **PUBLIC**, **INTERNAL**, **RESTRICTED**. Enforced by `.gitignore`,
> `.gitleaks.toml`, the `secrets-guard`/`block-private-keys` CI gates, and the new
> `repository-policy.yml` workflow. Evidence-based: every line below was verified
> against repository contents (`git ls-files`, `git check-ignore`, content grep).

## Tiers

| Tier | Definition | Where it may live |
|---|---|---|
| **PUBLIC** | World-readable OSS source, docs, examples, governance metadata | committed, any branch |
| **INTERNAL** | Strategy, roadmaps, completed audits — not secret, but exposure reveals roadmap/posture | private repo, or local `plans/` (kept out of public history) |
| **RESTRICTED** | Cryptographic material + credentials. A single commit = full compromise | secrets manager / CI secrets only — **never** committed |

## Classification matrix (VERIFIED)

### PUBLIC
- `packages/**` source (49 packages incl. 21 `plugin-*`) — no secrets tracked (VERIFIED).
- `docs/**`, `examples/**`, `demos/**`, `benchmarks/**`, `rfcs/**`.
- Root metadata: `README.md`, `LICENSE`, `CHANGELOG.md`, `CITATION.cff`, `package.json`, `package-lock.json`, `.npmrc` (no `_authToken` — VERIFIED), tooling dotfiles, `.env.example`.
- Governance: `SECURITY.md`, `GOVERNANCE.md`, `MAINTAINERS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `governance/**`.
- Security evidence (sanitised, no secret values): `security/**`, `audits/**`.
- Infra **templates**: `infra/**` (Helm chart, k8s example, provider examples, monitoring rules, `infra/docker/Dockerfile` + `infra/docker/compose/docker-compose*.yml`), `packages/registry-server/Dockerfile` — all must contain placeholders only.

### INTERNAL (relocate out of public history)
- `plans/**` — strategy/roadmap/marketing/content/expansion docs.
- Local-only: `CLAUDE.md` (gitignored), `STREET_WEBSITE_ENTERPRISE_AUDIT.md` (gitignored), `.kiro/specs/**` (gitignored).
- Website SEO ownership tokens **currently tracked** — `BingSiteAuth.xml`, `googledf528d4f2b039b20.html` → belong in the website repo (GAP, see remediation).

### RESTRICTED (never commit — VERIFIED currently untracked)
- `.env` (real) — gitignored ✓.
- Private keys / keystores — `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.crt`, `*.jks`, `*.keystore`.
  - On-disk but **gitignored & untracked** (VERIFIED): `street-signing.key.pem` (the **leaked, now-distrusted** key), `street-signing.pub.pem`, `keys/street-signing-2026.key.pem` (the **active** key).
- Cloud/CI credentials — `*service-account*.json`, `*credentials*.json`, `aws-credentials.json`, `.npmrc` with `_authToken`, `kubeconfig`, `*.tfstate`, `*.tfvars`.
- The official signing **public** key embedded in `packages/core/src/platform/plugins/official-key.ts` is PUBLIC by design (public half only; Ed25519 — private key is not derivable).

## Verification results (item 9)

| Check | Result |
|---|---|
| No signing **private** keys committed | ✅ VERIFIED — none tracked (`git ls-files` clean); on-disk keys gitignored |
| No tokens committed | ✅ VERIFIED — no `sk-`/`ghp_`/`AKIA`/`_authToken` in tracked content |
| No production endpoints exposed | ✅ VERIFIED — no real URLs/IPs in `infra/`; assets are templated |
| No secrets in docs | ✅ VERIFIED — only placeholder/example values (`change-me-in-production`, `sk-...`) |
| Leaked key in **history** | ⚠️ KNOWN — blob `d7bbfc40` still in history but **distrusted** (anchor rotated to `3ae9add0`); purge tracked in `KEY-ROTATION-RUNBOOK.md` §7 |

## Enforcement
- `.gitignore` blocks RESTRICTED patterns (see additions in this sprint).
- `.gitleaks.toml` — `pem-private-key-block` rule + cloud-credential rules; `secret-scan.yml` runs on every push/PR.
- `secrets-guard` (rule #1 in `ci-cd.yml`) + `block-private-keys.yml` gate the release chain.
- `repository-policy.yml` enforces the root-folder allowlist + infra-templating + classification.
