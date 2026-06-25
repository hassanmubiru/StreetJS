# StreetJS — Phase 19 Governance, Security & Organization Master Audit

> **Type:** Read-only, evidence-grounded audit. Findings tagged
> **VERIFIED** (confirmed against repo contents/commands), **GAP** (something
> missing), **RISK** (exploitable/hygiene exposure), **RECOMMENDATION** (action).
> **Method:** `git ls-files`, `find`, `openssl`/`node` fingerprinting, and direct
> file reads on the working tree. Nothing is assumed.
> **Cross-references:** `SECURITY-AUDIT.md`, `PLUGIN-SECURITY-AUDIT.md`,
> `MARZPAY-SECURITY-REVIEW.md`, `REPO-ORGANIZATION-PLAN.md`,
> `PRIVACY-POLICY-FOR-REPO.md`, `KEY-ROTATION-RUNBOOK.md`.

## Material state change since the prior audit (VERIFIED)

The signing-key rotation is **functionally complete**, which changes the risk
picture materially:

- **VERIFIED** — `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` (`packages/core/src/platform/plugins/official-key.ts`)
  now embeds the new key, DER-SHA256 `3ae9add05d71dc5a17992caf192b1e465bcb9b2f2633231df44dbe2db8444b84`.
- **VERIFIED** — **all 21** `packages/plugin-*/manifest.pub` files match that new
  anchor (21/21, 0 mismatches). The half-finished rotation (old F-7) is resolved.
- **VERIFIED** — the previously-leaked official key (`df5e2726…`) is **no longer
  the trust anchor**, so a plugin forged with the leaked key now **fails**
  verification. The catastrophic exploitability of `SECURITY-AUDIT.md` F-1 is
  neutralised by rotation.
- **VERIFIED** — new CI gate `secrets-guard` (rule #1 in `ci-cd.yml`, gating the
  release chain) + standalone `block-private-keys.yml`; `.gitleaks.toml` corrected.
- **RISK (residual)** — the leaked blob is **still in history** (`d7bbfc40`,
  not yet purged) and on-disk keys remain in the tree (gitignored). These are now
  hygiene/defense-in-depth rather than active trust compromise.

---

# PHASE 1 — Repository Inventory

## Repository Asset Classification Matrix

### Root folders (VERIFIED via `find . -maxdepth 1 -type d`)

| Path | Class | Notes |
|---|---|---|
| `packages/` | Public OSS | 49 packages (21 `plugin-*`, core, cli, frontend, vertical kits) |
| `docs/` | Documentation | Jekyll site + reference; certification suite requires `docs/*.md` tracked |
| `examples/` | Public OSS | 13 example apps |
| `demos/` | Public OSS | 4 demos |
| `benchmarks/` | Public OSS | perf harness |
| `rfcs/` | Governance | design proposals |
| `deploy/` | Infrastructure | aws-ecs, cloud-run, cloudflare, helm, k8s, vercel |
| `observability/` | Infrastructure | grafana dashboards, prometheus rules |
| `verification-artifacts/` | Release | **generated** certification JSON (tracked — see Phase 2) |
| `ci/` | Infrastructure | pack-smoke fixtures |
| `dast/` | Security | DAST config |
| `scripts/` | Infrastructure | build/release/codegen scripts |
| `.github/` | Governance/Security | 36 workflows, CODEOWNERS, dependabot, codeql, templates |
| `.githooks/` | Security | pre-commit, pre-push |
| `app-htmx/` `app-next/` `app-none/` `app-react/` | Internal (generated) | scaffold output tracked at root |
| `keys/` | **HIGHLY SENSITIVE** | new signing keypair on disk (gitignored, untracked) |
| `node_modules/` `.git/` `.hypothesis/` `.vscode/` `.kiro/` | Internal | tooling/local (gitignored where appropriate) |

### Root files — classification (VERIFIED)

| Group | Examples | Class |
|---|---|---|
| Project metadata | `README.md`, `LICENSE`, `CHANGELOG.md`, `CITATION.cff`, `package.json`, `package-lock.json`, `.npmrc` | Public OSS |
| Governance | `GOVERNANCE.md`, `MAINTAINERS.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md` | Governance |
| Tooling config | `.gitignore`, `.gitattributes`, `.gitleaks.toml`, `.dockerignore`, `.env.example` | Public OSS |
| Security deliverables | `SECURITY-AUDIT.md`, `SECURITY-AUDIT-2026.md`, `PLUGIN-SECURITY-AUDIT.md`, `MARZPAY-SECURITY-REVIEW.md`, `PAYMENTS-SECURITY-REVIEW.md`, `PLUGIN-SIGNING-REVIEW.md`, `THREAT-MODEL-2026.md`, `THREAT-MODEL-UPDATE.md`, `SECURITY-SCORECARD.md`, `KEY-ROTATION-RUNBOOK.md`, `PRIVACY-POLICY-FOR-REPO.md` | Security/Audit |
| Strategy / roadmap | `STREETJS-EXPANSION-MASTERPLAN.md`, `*-ROADMAP.md`, `*-PLAN.md`, `ADOPTION-ASSETS.md`, `COMMUNITY-GROWTH-PLAN.md`, `CONTENT-*.md`, `WEBSITE-EVOLUTION.md`, `TRUST-CENTER-PLAN.md`, `PHASE-18-*.md` | Internal |
| Completed reports | `ENTERPRISE-READINESS.md`, `ECOSYSTEM-PLUGINS-AUDIT.md`, `LANGUAGE-STATS-AUDIT.md`, `MARZPAY-INTEGRATION-REPORT.md`, `SHOWCASE-AUDIT.md`, `STREET_WEBSITE_ENTERPRISE_AUDIT.md`, `REPO-ORGANIZATION-PLAN.md` | Internal/Audit |
| Feature docs | `PLUGIN-MARKETPLACE.md`, `GOOD-FIRST-ISSUES.md` | Documentation |
| Generated (tracked) | `sbom.json`, `release-inputs.json`, `certification-report.json`, `RELEASE-CERTIFICATION.md` | Release (should be CI) |
| SEO verification (tracked) | `BingSiteAuth.xml`, `googledf528d4f2b039b20.html` | Internal (website) |
| Compose / container | `Dockerfile`, `docker-compose*.yml` (×6) | Infrastructure |
| Misc | `.sqlite-smoke.mjs` | Infrastructure |
| **SECRETS (gitignored, untracked)** | `.env`, `street-signing.key.pem`, `street-signing.pub.pem`, `keys/*` | **HIGHLY SENSITIVE** |

- **VERIFIED** — 45 tracked uppercase `*.md` files at root.
- **GAP** — root holds ~30 internal strategy/roadmap + ~14 audit docs, crowding the front door.
- **VERIFIED** — `.env`, `street-signing.key.pem`, `keys/street-signing-2026.key.pem` are gitignored (confirmed `git check-ignore`). **Not tracked.**
- **RISK** — `sbom.json`, `release-inputs.json`, `BingSiteAuth.xml`, `googledf528d4f2b039b20.html` **are tracked**.

### packages/* (VERIFIED — 49)

Core/platform: `core`, `core-compat`, `cli`, `edge`, `orm`, `registry-server`,
`search`, `storage`, `devtools`, `client`.
Frontend: `react`, `vue`, `next`, `nuxt`, `admin`, `admin-ui`, `ai`, `ai-ui`, `auth-ui`.
Verticals: `commerce`, `dating-auth`, `dating-messaging`, `dating-moderation`,
`dating-profiles`, `social-comments`, `social-feed`, `social-notifications`, `social-users`.
Plugins (21): `africastalking, auth0, clerk, firebase, htmx, kafka, marzpay,
mongodb, mysql, nats, openai, paypal, postgres, r2, rabbitmq, redis, s3, sendgrid,
stripe, supabase, twilio`.

### .github/* (VERIFIED)

36 workflows. Security-relevant: `codeql.yml`, `scorecard.yml`, `secret-scan.yml`,
`dependency-review.yml`, `dast.yml`, `sign-htmx.yml`, `publish-plugins.yml`,
`block-private-keys.yml` (new). Governance: `CODEOWNERS`, `dependabot.yml`,
`codeql/`, `ISSUE_TEMPLATE/`, `pull_request_template.md`, `FUNDING.yml`,
`labels.yml`, `zizmor.yml`, `actions/setup`.

### .githooks/* (VERIFIED) — `pre-commit`, `pre-push`.
### deploy/* (VERIFIED) — `aws-ecs/task-definition.json`, `cloud-run/service.yaml`, `cloudflare/wrangler.toml`, `helm/street`, `k8s/hpa-autoscaling-example.yaml`, `vercel/vercel.json`, `README.md`.
### observability/* (VERIFIED) — `grafana/dashboards`, `prometheus/street-rules.yml`, `prometheus/street-rules.test.yml`.
### verification-artifacts/* (VERIFIED) — ~40 tracked `*.artifact.json`/report files across abuse, cloud, dast, dating, devx, encryption, enterprise, headers, moderation, observability, plugins, privacy, ratelimit, registry, release, secrets, upgrade, upload, validation.

---

# PHASE 2 — Public vs Private Review

## Public/Private Classification Report

| Path | Classification | Reasoning | Risk |
|---|---|---|---|
| `packages/**` (source) | PUBLIC | OSS framework + plugins; no secrets in tracked source (VERIFIED no `*.pem/*.key` tracked) | Low |
| `docs/**` | PUBLIC | Public documentation site | Low |
| `examples/**`, `demos/**`, `benchmarks/**`, `rfcs/**` | PUBLIC | Intended for the world | Low |
| `README/LICENSE/SECURITY/GOVERNANCE/MAINTAINERS/CONTRIBUTING/CODE_OF_CONDUCT/CHANGELOG/CITATION` | PUBLIC | Standard front-door metadata | Low |
| `SECURITY-AUDIT*.md`, `THREAT-MODEL*.md`, `PLUGIN-SIGNING-REVIEW.md`, `PAYMENTS-SECURITY-REVIEW.md`, `SECURITY-SCORECARD.md` | PUBLIC BUT RELOCATED | Useful as evidence; belong under `security/` or `audits/`, not root | Low |
| `KEY-ROTATION-RUNBOOK.md` | PUBLIC BUT RELOCATED | Describes process, **no secret values**; relocate to `security/` | Low |
| Strategy/roadmap docs (`*-PLAN.md`, `*-ROADMAP.md`, `STREETJS-EXPANSION-MASTERPLAN.md`, marketing/growth) | INTERNAL | Reveals roadmap/competitive posture; belongs in private repo or local `plans/` | Medium (info exposure) |
| `STREET_WEBSITE_ENTERPRISE_AUDIT.md`, `ENTERPRISE-READINESS.md` | INTERNAL | Internal eval; some already gitignored | Medium |
| `deploy/**` | PUBLIC (review) | Example manifests; **must contain no real account IDs/DNS/cluster names** — see findings | Medium |
| `observability/**` | PUBLIC (review) | Prometheus rules + Grafana dashboards; **must contain no real internal endpoints** | Medium |
| `verification-artifacts/**` | PUBLIC BUT GENERATED | CI evidence; should be release artifacts, not tracked | Low |
| `sbom.json`, `release-inputs.json` | PUBLIC BUT GENERATED | Tracked build outputs; drift risk → generate in CI | Low |
| `BingSiteAuth.xml`, `googledf528d4f2b039b20.html` | INTERNAL (website) | SEO ownership tokens for the website, not the framework | Low/Medium |
| `.env` | HIGHLY SENSITIVE | Real env; **gitignored & untracked (VERIFIED)** — keep out | Critical-if-leaked |
| `street-signing.key.pem` (root, leaked key), `keys/street-signing-2026.key.pem` (new) | HIGHLY SENSITIVE | Private keys on disk; gitignored/untracked (VERIFIED) — **relocate out of tree** | High |
| `street-signing.pub.pem` | SENSITIVE (low) | Public half; safe but should live with owning package if shipped | Low |

### Deployment / infra exposure scan (VERIFIED, read-only)

- **VERIFIED** — `deploy/` assets are **example/templated** (`hpa-autoscaling-example.yaml`, sample `task-definition.json`, `wrangler.toml`, `service.yaml`, `vercel.json`). 
- **RECOMMENDATION** — grep these for real cloud account IDs, ARNs, internal DNS, cluster names, and monitoring URLs before each release; keep them clearly templated with placeholders.
- **VERIFIED** — workflow secrets are referenced as `${{ secrets.* }}` (e.g. `STREET_PLUGIN_SIGNING_KEY`, `NPM_TOKEN`, `PG_PASSWORD`, `KEK`, `JWT_SECRET`) — no inline secret values in workflow YAML.
- **GAP** — no automated check that `deploy/`/`observability/` stay free of real identifiers.

---

# PHASE 3 — Security Audit

## Security Findings Table

| Severity | Location | Issue | Impact | Recommendation |
|---|---|---|---|---|
| **HIGH** | git history `d7bbfc40:street-signing.key.pem` | Leaked Ed25519 private key **still in pushed history** (not purged). Now **distrusted** (anchor rotated to `3ae9add0`), so no longer mints valid official signatures. | Hygiene + supply-chain optics; an attacker can still extract the old key but it verifies against nothing current. | Purge with `git filter-repo` + coordinated force-push (KEY-ROTATION-RUNBOOK §7). Severity dropped from CRITICAL→HIGH because rotation removed exploitability. |
| **HIGH** | `street-signing.key.pem` (root), `keys/street-signing-2026.key.pem` | Two private keys live **inside the repo tree** (gitignored/untracked, VERIFIED). One `git add -f` from re-exposure. | Re-leak risk of the *new* key would re-compromise the trust anchor. | Move both out of the tree into a secrets manager (runbook §8). Quarantine the leaked one. |
| **MEDIUM** | `sbom.json`, `release-inputs.json` (tracked) | Generated artifacts committed → drift vs reality; SBOM can mislead consumers. | Stale/inaccurate supply-chain evidence. | Generate in CI, attach to releases, untrack + gitignore. |
| **MEDIUM** | GitHub repo settings (not in tree) | No evidence of **Push Protection / Secret Scanning** being enabled at the platform level; only client-side gitleaks + hooks. | A secret can still be pushed if hooks bypassed. | Enable GitHub Advanced Security secret scanning + push protection (Phase 9). |
| **MEDIUM** | per-plugin | **No `SECURITY.md` in any of 21 plugins** (VERIFIED) and no per-plugin disclosure pointer. | Inconsistent vuln-reporting path for plugin issues. | Add a short `SECURITY.md` (or symlink/policy reference) per plugin or document central policy in each README. |
| **LOW** | `.githooks` opt-in | Hooks only run if `core.hooksPath` is set; bypassable with `--no-verify`. | Client-side controls are advisory. | Keep, but rely on server-side CI gates (already added `secrets-guard`). |
| **LOW** | `BingSiteAuth.xml`, `googledf…html` | Website SEO tokens tracked in framework repo. | Minor info exposure / wrong-repo placement. | Move to website repo. |
| **RESOLVED** | `official-key.ts` / 21 manifests | Trust-anchor compromise + half-finished rotation (old F-1/F-7). | — | **VERIFIED fixed**: anchor `3ae9add0`, all 21 manifests match. |
| **RESOLVED** | `.gitleaks.toml` | False "not production key / purged" comment + allowlist masking the key (old F-2). | — | **VERIFIED fixed**: allowlist removed, PEM rule added. |

## Supply-chain / CI trust boundaries (VERIFIED)

- **VERIFIED** — `publish-plugins.yml` signs all 21 plugins from `STREET_PLUGIN_SIGNING_KEY` and **fails unless each manifest verifies against `officialPluginPublicKey()`**.
- **VERIFIED** — `sign.mjs` is fail-closed (refuses ephemeral keys).
- **VERIFIED** — `secrets-guard` is the **first** job in `ci-cd.yml`; `build-and-test` (gatekeeper for docker/publish) `needs` it.
- **VERIFIED** — npm publish uses `--provenance` with `id-token: write`.
- **GAP** — no SBOM/provenance **verification** step on install side; no cosign verification gate documented for tarballs.

---

# PHASE 4 — Plugin Security Review

## Plugin Security Scorecard

**Inventory facts (VERIFIED):** all 21 plugins ship `README.md`, `manifest.json`,
`manifest.signed.json`, `manifest.pub` (all matching the new anchor). **None** ship
a per-plugin `SECURITY.md`. Tests live in per-package `test/` dirs (e.g.
`plugin-marzpay/test/*.pbt.test.mjs` — extensive PBT, VERIFIED); coverage varies by
plugin. Detailed control-by-control analysis is in `PLUGIN-SECURITY-AUDIT.md`.

| Plugin | Signed | Webhook verify | Idempotency/replay | Timeout | SSRF posture | Secrets | Score |
|---|---|---|---|---|---|---|---|
| **marzpay** | ✅ new anchor | fail-closed + app re-verify | overlay store (UNIQUE ref) | ✅ | hardcoded host | never logged | **88** |
| **stripe** | ✅ | ❌ no `Stripe-Signature` verifier | ❌ | ❌ | N-A (fixed host) | config-only | **66** |
| **paypal** | ✅ | ❌ | ❌ | ❌ | N-A | config-only | **66** |
| **africastalking** | ✅ | shared-secret callback | ❌ | ✅ AbortController | N-A | never logged | **80** |
| **auth0** | ✅ | N-A | N-A | ❌ | `domain` not allow-listed | config-only | **70** |
| **clerk** | ✅ | N-A | N-A | ❌ | `baseUrl` not allow-listed | config-only | **70** |
| **firebase** | ✅ | N-A | N-A | ❌ | fixed host | config-only | **74** |
| **supabase** | ✅ | N-A | N-A | ❌ | `url` not allow-listed (service-role key) | config-only | **70** |
| **twilio** | ✅ | ❌ `X-Twilio-Signature` missing | ❌ | ❌ | fixed host | config-only | **66** |
| **sendgrid** | ✅ | ❌ ECDSA event verify missing | ❌ | ❌ | fixed host | config-only | **68** |
| **openai** | ✅ | N-A | N-A | ❌ | `baseUrl` not allow-listed (by design) | config-only | **72** |
| **s3 / r2** | ✅ | N-A | N-A | ⚠️ via adapter | host from bucket/account | config-only | **74** |
| **mongodb** | ✅ | N-A | N-A | ✅ | operator host | SCRAM, no TLS | **74** |
| **postgres / mysql** | ✅ | N-A | N-A | ✅ pool | operator host | SCRAM/native, no TLS surfaced | **74** |
| **redis** | ✅ | N-A | N-A | ✅ | operator host | AUTH, no TLS | **72** |
| **kafka / rabbitmq / nats** | ✅ | N-A | N-A | ✅ connect | operator host | no TLS/SASL surfaced (nats `tls_required:false`) | **70** |
| **htmx** | ✅ | N-A | N-A | N-A | `viewsDir` path-name `..` risk | no creds | **76** |

- **Special focus — `@streetjs/plugin-auth`:** **GAP** — no such package exists.
  Identity is provided by `plugin-auth0` and `plugin-clerk` (+ `auth-ui`). Scored above.
- **Highest priority cross-plugin gaps (from `PLUGIN-SECURITY-AUDIT.md`):**
  (1) **RISK** — no outbound timeout on the 9 `node:https` plugins (stripe, paypal,
  twilio, sendgrid, auth0, clerk, firebase, supabase, openai); a hung TLS connection
  pins a request. (2) **RISK** — webhook-signature verifiers absent on providers that
  sign (stripe, twilio, paypal, sendgrid). (3) **GAP** — no SSRF host allow-listing
  for configurable-host plugins.

**Aggregate plugin posture: ~73/100** (marzpay is the reference at 88; the
`node:https` HTTP plugins drag the average down on timeouts + webhook verifiers).

---

# PHASE 5 — Repository Reorganization

Target layout (mirrors Next.js/NestJS/Nuxt/Laravel/Django root discipline). Full
file-by-file mapping is in `REPO-ORGANIZATION-PLAN.md`; the migration summary:

## Migration Table (summary — all via `git mv`, history preserved)

| Current Path | Target Path | Reason |
|---|---|---|
| `*-PLAN.md`, `*-ROADMAP.md`, `STREETJS-EXPANSION-MASTERPLAN.md`, marketing/growth/content docs (~18) | `plans/` (or private repo) | Internal strategy off the front door |
| `SECURITY-AUDIT*.md`, `THREAT-MODEL*.md`, `PLUGIN-SIGNING-REVIEW.md`, `PAYMENTS-SECURITY-REVIEW.md`, `SECURITY-SCORECARD.md`, `KEY-ROTATION-RUNBOOK.md`, `PRIVACY-POLICY-FOR-REPO.md`, `PLUGIN-SECURITY-AUDIT.md`, `MARZPAY-SECURITY-REVIEW.md`, `PHASE-19-MASTER-AUDIT.md` | `security/` | Consolidate security artifacts; link from `SECURITY.md` |
| `ENTERPRISE-READINESS.md`, `ECOSYSTEM-PLUGINS-AUDIT.md`, `LANGUAGE-STATS-AUDIT.md`, `MARZPAY-INTEGRATION-REPORT.md`, `SHOWCASE-AUDIT.md`, `PHASE-18-AUDIT.md`, `REPO-ORGANIZATION-PLAN.md`, `SECURITY-AUDIT-2026.md` | `audits/` | Completed point-in-time reports |
| `GOVERNANCE.md`, `MAINTAINERS.md` + new charter/policies | `governance/` (or keep `GOVERNANCE.md` at root, policies under `governance/`) | Governance home |
| `Dockerfile`, `docker-compose*.yml` (×6) | `infra/docker/`, `infra/docker/compose/` | Container assets together (`.dockerignore` stays at root) |
| `deploy/{k8s,helm,aws-ecs,cloud-run,cloudflare,vercel}` | `infra/kubernetes/`, `infra/helm/`, `infra/examples/*` | Consolidate deployment |
| `observability/` | `infra/monitoring/` | Monitoring under infra |
| `PLUGIN-MARKETPLACE.md`, `GOOD-FIRST-ISSUES.md` | `docs/` (or `.github/`) | User/contributor docs |
| `.sqlite-smoke.mjs` | `scripts/sqlite-smoke.mjs` | Root smoke script clutter |
| `app-htmx/`, `app-next/`, `app-none/`, `app-react/` | `examples/scaffold-*` **or** `test/fixtures/scaffold/*` **or** regenerate in CI | Generated scaffolds off root |
| `sbom.json`, `release-inputs.json` | CI artifact (untrack + gitignore) | Generated, not source |
| `BingSiteAuth.xml`, `googledf…html` | website repo | Wrong repo |
| `verification-artifacts/` | CI artifact (or `audits/verification/` if kept) | Generated evidence |

Target tree:
```
streetjs/
├── packages/  docs/  examples/  demos/  benchmarks/  rfcs/  scripts/
├── infra/   { docker/ kubernetes/ helm/ monitoring/ examples/ }
├── governance/   { charter, policies }   security/   audits/   plans/
└── .github/  .githooks/
```

---

# PHASE 6 — Docker & Infrastructure Review

## Infrastructure Organization Plan

| Asset (VERIFIED) | Disposition | Reason |
|---|---|---|
| `Dockerfile` | KEEP (or `infra/docker/`) | Default build context; if moved, update `docker build -f` + `docker-build` job |
| `.dockerignore` | KEEP at root | Must sit beside build context |
| `docker-compose.yml` + `.kafka/.rabbitmq/.search/.storage/.test-db.yml` | MOVE → `infra/docker/compose/` | 6 compose files sprawl the root; update integration workflows' `-f` paths |
| `deploy/k8s/hpa-autoscaling-example.yaml` | MOVE → `infra/kubernetes/` | Example manifest; keep clearly templated |
| `deploy/helm/street` | MOVE → `infra/helm/street` | Helm chart |
| `deploy/{aws-ecs,cloud-run,cloudflare,vercel}` | MOVE → `infra/examples/<provider>/` | Provider examples |
| `observability/grafana`, `observability/prometheus` | MOVE → `infra/monitoring/` | Monitoring config |
| `verification-artifacts/cloud/*`, `dast/*` | GENERATE in CI | Build evidence, not source |

- **REMOVE/GENERATE**: tracked generated artifacts (`sbom.json`, `release-inputs.json`, `verification-artifacts/**`) → produce in CI, attach to releases.
- **REVIEW BEFORE PUBLIC**: scan `deploy/**` + `observability/**` for real account IDs/DNS/cluster names/monitoring URLs (RECOMMENDATION: add a CI grep gate).
- **RECOMMENDATION**: add `infra/README.md` documenting that all manifests are templated examples.

---

# PHASE 7 — Repository Governance Charter

> Normative rules. Adopt under `governance/CHARTER.md`; reference from `CONTRIBUTING.md` and `SECURITY.md`.

1. **Root folder policy.** Root holds only: project metadata (README, LICENSE,
   CHANGELOG, CITATION), governance entry files (SECURITY, GOVERNANCE, MAINTAINERS,
   CONTRIBUTING, CODE_OF_CONDUCT), the workspace manifest + lockfile, tooling
   dotfiles, and the standard directories. No strategy docs, no completed audits,
   no generated artifacts, no scaffolds at root. Enforced by a CI `check-root` gate.
2. **Security document policy.** All security analyses live under `security/`;
   the public reporting policy stays in root `SECURITY.md` and links to them.
   Security docs must never contain secret values (only fingerprints/paths).
3. **Audit document policy.** Point-in-time reports live under `audits/<YYYY>/`;
   immutable once published; superseded findings link forward to corrections.
4. **Infrastructure policy.** All deploy/monitoring/container assets under `infra/`,
   templated with placeholders only — no real account IDs, ARNs, DNS, cluster names,
   or monitoring endpoints. CI greps for these on every PR.
5. **Plugin publication policy.** A plugin may publish only via `publish-plugins.yml`
   (CI), which signs from `STREET_PLUGIN_SIGNING_KEY` and verifies against
   `officialPluginPublicKey()`. **No local `npm publish` of official plugins.** Every
   plugin ships README + manifest.json + manifest.signed.json + manifest.pub + a
   SECURITY pointer; tests + coverage gate required before first publish.
6. **Release policy.** Releases are tag-triggered; version must match tag; provenance
   (`--provenance`) required; SBOM generated and attached; changelog updated.
7. **Signing policy.** Exactly **one** active official key; private half only in CI
   secrets/KMS, never on a workstation or in the tree; scheduled rotation + documented
   revocation; embedded anchor and all manifests must agree (CI-enforced).
8. **Workflow policy.** Least-privilege `permissions:` (default `contents: read`);
   pinned action SHAs; `persist-credentials: false`; zizmor clean; the `secrets-guard`
   gate is rule #1 and gates the release chain.
9. **Secret management policy.** Secrets live only in GitHub Actions secrets, a
   secrets manager, or a local `.env` (gitignored). Never `*.pem/*.key` in the tree.
   gitleaks + push protection + secret scanning enforce this server-side.
10. **Documentation policy.** Public docs under `docs/`; internal strategy under
    `plans/` (or a private repo); generated docs/artifacts produced in CI, not committed.

---

# PHASE 8 — CODEOWNERS

**VERIFIED current state:** `.github/CODEOWNERS` exists but assigns a single owner
(`@hassanmubiru`) to `*`, `/.github/`, `/packages/core/src/security/`,
`/packages/core/src/database/`, `/SECURITY.md`. **GAP** — no explicit ownership for
plugins, signing, infra, or verification artifacts.

A complete proposal is written to **`.github/CODEOWNERS.proposed`** (not applied over
the live file). Replace `@org/*-team` placeholders with real teams/handles, then move
it over `.github/CODEOWNERS`:

```
*                                   @hassanmubiru

# CI / supply chain — highest scrutiny
/.github/                           @hassanmubiru @org/security-team
/.github/workflows/                 @hassanmubiru @org/security-team
/.github/workflows/publish-plugins.yml   @hassanmubiru @org/release-team
/.github/workflows/sign-htmx.yml         @hassanmubiru @org/release-team
/.github/workflows/block-private-keys.yml @hassanmubiru @org/security-team
/.githooks/                         @hassanmubiru @org/security-team
/.gitleaks.toml                     @hassanmubiru @org/security-team

# Signing trust anchor — never change without security review
/packages/core/src/platform/plugins/official-key.ts   @hassanmubiru @org/security-team

# Security-sensitive core
/packages/core/src/security/        @hassanmubiru @org/security-team
/packages/core/src/database/        @hassanmubiru @org/security-team

# Payment / identity plugins — elevated review
/packages/plugin-marzpay/           @hassanmubiru @org/payments-team
/packages/plugin-stripe/            @hassanmubiru @org/payments-team
/packages/plugin-paypal/            @hassanmubiru @org/payments-team
/packages/plugin-africastalking/    @hassanmubiru @org/payments-team
/packages/plugin-auth0/             @hassanmubiru @org/identity-team
/packages/plugin-clerk/             @hassanmubiru @org/identity-team
/packages/plugin-firebase/          @hassanmubiru @org/identity-team

# Infra & release evidence
/deploy/                            @hassanmubiru @org/platform-team
/infra/                             @hassanmubiru @org/platform-team
/observability/                     @hassanmubiru @org/platform-team
/verification-artifacts/            @hassanmubiru @org/release-team

# Governance & security docs
/SECURITY.md                        @hassanmubiru @org/security-team
/GOVERNANCE.md  /MAINTAINERS.md     @hassanmubiru
/security/                          @hassanmubiru @org/security-team
```

---

# PHASE 9 — Security Automation Roadmap

**VERIFIED already present:** CodeQL, OpenSSF Scorecard, gitleaks (`secret-scan.yml`
+ corrected `.gitleaks.toml`), Dependency Review, DAST, Dependabot, the new
`secrets-guard`/`block-private-keys` gates, npm provenance, plugin signing + verify.

| Horizon | Action | Status |
|---|---|---|
| **30 days** | Enable GitHub **Secret Scanning + Push Protection** (platform setting) | GAP — enable |
| 30 days | Add **Trufflehog** full-history scan job (complements gitleaks) | GAP |
| 30 days | Branch protection on `main`: required reviews (CODEOWNERS), required status checks incl. `secrets-guard`, linear history, no force-push | GAP — configure |
| 30 days | Purge leaked key blob from history (runbook §7) | RISK open |
| **90 days** | **SBOM** generated per release + attached (stop tracking `sbom.json`) | GAP |
| 90 days | **Provenance/cosign verification** gate for published tarballs + install-time manifest verify docs | GAP |
| 90 days | Per-plugin `SECURITY.md` + reporting path; coverage gate before publish | GAP |
| 90 days | Infra-secrets CI grep (account IDs/DNS/cluster names in `infra/`) | GAP |
| **180 days** | **Keyless signing** (Sigstore/cosign OIDC) or KMS/HSM-backed key; scheduled rotation + revocation policy | RECOMMENDATION |
| 180 days | Recurring full-history secret scan + quarterly audit cadence | RECOMMENDATION |
| 180 days | Pin all third-party actions by SHA + Dependabot for actions; enforce via zizmor | partially present |

---

# PHASE 10 — Final Report

## 1. Executive Summary

StreetJS has a genuinely strong security toolchain (CodeQL, Scorecard, gitleaks,
dependency review, DAST, signed plugin manifests, provenance publishing) and a
framework-grade package layout. **Since the prior audit, the single catastrophic
finding — a leaked official signing key that was the trust anchor — has been
remediated by a completed rotation:** the embedded anchor is now `3ae9add0`, all 21
plugin manifests re-signed and verified against it (VERIFIED), a `secrets-guard`
gate is rule #1 in CI, and `.gitleaks.toml` is corrected. The residual security work
is hygiene: purge the (now-distrusted) leaked blob from history and relocate on-disk
keys. The dominant *remaining* problems are **governance and organization**: a
single-owner CODEOWNERS, no codified policies, and a root directory buried under ~45
tracked docs, 6 compose files, 4 scaffold apps, SEO files, and tracked generated
artifacts.

## 2. Top 20 Risks

1. (HIGH) Leaked key blob still in history (`d7bbfc40`) — distrusted but not purged.
2. (HIGH) Two private keys on disk inside the tree (gitignored, untracked).
3. (MED) `sbom.json`/`release-inputs.json` tracked → supply-chain drift.
4. (MED) No platform Secret Scanning / Push Protection evidence.
5. (MED) No per-plugin `SECURITY.md` (21/21 missing).
6. (MED) 9 `node:https` plugins have no outbound timeout.
7. (MED) Webhook-signature verifiers missing on stripe/twilio/paypal/sendgrid.
8. (MED) SSRF: configurable-host plugins not allow-listed (openai/clerk/supabase/auth0).
9. (MED) Single-owner CODEOWNERS → bus-factor + weak review separation.
10. (MED) Root clutter obscures governance/security signal.
11. (MED) `deploy/`/`observability/` lack a CI gate for real identifiers.
12. (MED) Supabase service-role key usable in request path.
13. (LOW) SEO tokens tracked in framework repo.
14. (LOW) Hooks bypassable (`--no-verify`) — advisory only.
15. (LOW) DB/messaging plugins default to plaintext (no TLS surfaced).
16. (LOW) `verification-artifacts/**` tracked rather than CI-attached.
17. (LOW) No SBOM/provenance verification gate at install side.
18. (LOW) htmx template/partial names permit `..` traversal (developer-trust).
19. (LOW) No scheduled key-rotation/revocation policy yet.
20. (LOW) Branch-protection config not evidenced in-repo.

## 3. Top 20 Improvements

1. Purge history + coordinated force-push (runbook §7).
2. Relocate both private keys out of the tree to a secrets manager.
3. Enable Secret Scanning + Push Protection.
4. Configure branch protection (CODEOWNERS reviews + required `secrets-guard`).
5. Expand CODEOWNERS (proposed file delivered).
6. Adopt the Governance Charter (Phase 7).
7. Execute the root reorganization (`security/ audits/ plans/ infra/ governance/`).
8. Untrack generated artifacts; generate SBOM in CI.
9. Add per-plugin `SECURITY.md`/reporting pointer.
10. Add outbound timeouts to the 9 HTTP plugins.
11. Ship webhook verifiers for stripe/twilio (then paypal/sendgrid).
12. Add SSRF host allow-list/validator for configurable-host plugins.
13. Move SEO files to the website repo.
14. Consolidate infra under `infra/` + `infra/README.md`.
15. Add CI grep gate for real identifiers in infra.
16. Add cosign/provenance verification gate.
17. Add Trufflehog full-history scan.
18. Surface TLS/SASL options for DB/messaging plugins.
19. Harden htmx path-name handling; document raw-interpolation trust boundary.
20. Establish scheduled rotation + revocation policy; pin all action SHAs.

## 4–7. Scores

| Dimension | Score | Basis |
|---|---|---|
| **Security** | **84 / 100** | Rotation complete + strong CI/signing/scanning; residual = unpurged history blob, on-disk keys, missing push protection, plugin timeout/webhook gaps |
| **Governance** | **64 / 100** | Solid base docs (SECURITY/GOVERNANCE/MAINTAINERS/CONTRIBUTING/CoC, dependabot, templates) but single-owner CODEOWNERS and no codified policies |
| **Repository Organization** | **58 / 100** | Framework-grade `packages/`/`docs/`/`examples/`/`rfcs/` undermined by heavy root clutter + tracked generated artifacts + scaffolds |
| **Enterprise Readiness** | **80 / 100** | Broad CI, consistent signing, provenance; held back by org/governance gaps and history hygiene |

## Final Decision: **GO WITH CONDITIONS**

**Why.** The framework, CI security surface, and — critically — the plugin trust
model are now sound: the rotation is verified complete and the previously-fatal
leaked anchor is neutralised. That clears the only true blocker. The remaining items
are real but **non-blocking and well-understood**: they are hygiene (purge history,
move keys), governance (CODEOWNERS, charter, branch protection, push protection), and
organization (root cleanup, untrack generated files). 

**Conditions for unconditional GO (P0/P1):**
1. Purge the leaked key blob from history and relocate both on-disk private keys.
2. Enable Secret Scanning + Push Protection and branch protection with required
   `secrets-guard` + CODEOWNERS review.
3. Land the expanded CODEOWNERS and Governance Charter.
4. Execute the root/infra reorganization and untrack generated artifacts.

Detailed, sequenced execution with diffs, effort, and rollback is in
**`SECURITY-HARDENING-SPRINT.md`**.

*Read-only assessment. No code, CI, files, or git history were modified in producing
this report; the only changes made elsewhere in this session (anchor rotation, CI
gate, gitleaks fix) are documented in `SECURITY-AUDIT.md` and `KEY-ROTATION-RUNBOOK.md`.*

---

## Appendix A — Post-sprint remediation status (VERIFIED)

Applied after this audit (see `SECURITY-HARDENING-SPRINT.md` for detail):

| Item | Audit reference | Status |
|---|---|---|
| Trust-anchor rotation + 21 manifests re-signed | Material state change | ✅ done |
| `secrets-guard` rule #1 + `block-private-keys.yml` | Phase 3 | ✅ done |
| `.gitleaks.toml` corrected | Phase 3 | ✅ done |
| Per-plugin `SECURITY.md` (21/21) | Phase 4 GAP | ✅ **resolved** |
| CODEOWNERS expanded (paths) | Phase 8 GAP | ✅ done (single owner; team version staged) |
| Governance Charter adopted | Phase 7 | ✅ `governance/CHARTER.md` |
| Root reorganization (`plans/ audits/ security/`) | Phase 5 | ✅ done (root `.md` 45→7) |
| Untrack `sbom.json`/`release-inputs.json` | Phase 2 RISK | ✅ done |
| Infra-identifier CI gate + TruffleHog + pre-push key-block | Phase 9 | ✅ done |
| Infra consolidation under `infra/` | Phase 6 / P1-4 | ⏳ deferred (CI path coupling) |
| Purge history, relocate keys, push/branch protection | Phase 9 P0 | ⏳ operator |

## Appendix B — New finding (VERIFIED during sprint)

**B-1 (LOW)** — `scripts/cloud/prereqs.mjs` (`case 'cloudflare-workers'`) checks
`${repoRoot}/deploy/cloudflare-workers/wrangler.toml`, but the actual file is
`deploy/cloudflare/wrangler.toml` (VERIFIED: `deploy/cloudflare-workers/` does not
exist). The `existsSync(cfg)` guard therefore **silently skips** the wrangler
dry-run in `deploy-verify`, so that target gets no offline verification.
**RECOMMENDATION:** align the path (`deploy/cloudflare/wrangler.toml`) or the
target name, and verify on a branch (making the check run is a CI-behavior change).
This is independent of the P1-4 move.
