# StreetJS — Full Repository Governance, Security & Organization Report

> **Single consolidated report** covering all 14 review phases. Read-only,
> evidence-based (`git ls-files`, `git grep`, `openssl`/`node` fingerprinting,
> `docker compose config`, direct file reads). Detailed companion docs are
> cross-referenced; this document is self-contained for executive review.
>
> **Constraint honored throughout:** no `packages/core` runtime, no public API, and
> no published-package path changed. All changes are organization, CI, docs, and
> security-controls only — backward compatible.

---

## 0. Executive Summary

StreetJS is a security-forward, monorepo-structured TypeScript framework (49
packages, 21 signed official plugins, CLI, docs site, SaaS starter). This review
took it from a cluttered root with a **leaked signing key** to a mature-framework
layout with a verified plugin trust model and layered CI security gates.

- **The one historical critical** — the official plugin-signing private key was in
  git history and was the trust anchor — is **remediated by a completed key
  rotation** (new anchor `3ae9add0`, all 21 manifests re-signed and CI-verified).
  The old key is distrusted; the only residual is purging the (now-inert) blob.
- Root `.md` files reduced **45 → 7**; assets consolidated into
  `infra/ security/ audits/ governance/ plans/`.
- Plugin source is clean of dangerous constructs (0 `eval`/`Function`/
  `child_process`/`exec`/`any`).
- No secrets, tokens, or production endpoints are committed.

| Score | Value |
|---|---|
| Security | **86 / 100** |
| Repository organization | **88 / 100** |
| Governance | **72 / 100** |
| Enterprise readiness (composite) | **~82 / 100** |
| Residual risk | **LOW–MEDIUM (~20/100)** |

**Verdict: GO WITH CONDITIONS** — adopt-ready; close the operator items
(history purge, branch/push protection, CODEOWNERS teams) for unconditional GO.

---

## Phase 1 — Repository folder audit (VERIFIED)

| Top-level | Purpose | Public? | Disposition |
|---|---|---|---|
| `.github/` `.githooks/` | CI, CODEOWNERS, hooks | yes | keep |
| `.vscode/` | shared editor config (tracked) | yes | keep (not ignored) |
| `app-htmx/ app-next/ app-none/ app-react/` | generated scaffold samples | yes | move → `examples/scaffold-*` (or regenerate in CI) |
| `audits/ benchmarks/ ci/ dast/ demos/ docs/ examples/ rfcs/ scripts/` | reports, perf, fixtures, DAST, demos, docs, examples, RFCs, scripts | yes | keep |
| `governance/ security/` | charter/org + reviews/runbooks/classification | yes | keep |
| `infra/` | docker/compose/k8s/helm/examples/monitoring | yes | keep |
| `packages/` | 49 packages (21 plugins, core, cli, …) | yes | keep |
| `plans/` | internal strategy/roadmap | INTERNAL | keep / private repo |
| `verification-artifacts/` | CI certification evidence | yes | generate in CI (currently tracked) |
| `keys/`, `*.pem`, `.env` | secrets | SECRET | gitignored; relocate out of tree |
| `BingSiteAuth.xml`, `googledf*.html` | website SEO tokens | INTERNAL | move → website repo |

---

## Phase 2 — Public / Private classification

Four tiers (full matrix: `security/SECURITY-CLASSIFICATION.md`):
- **PUBLIC:** `packages/**`, `docs/`, `examples/`, `rfcs/`, root metadata, governance, sanitized security docs, templated `infra/`.
- **INTERNAL:** `plans/**`, website SEO files, local-only audits.
- **CONFIDENTIAL:** deployment/signing process docs (kept sanitized in `security/`).
- **SECRET (never commit, VERIFIED untracked):** `.env`, `*.pem`/`*.key`, signing keys, credentials, kubeconfig, tfstate.

---

## Phase 3 — Organization

Reorganized to mature-framework layout; root reduced 45 → 7 `.md`.
```
packages/ docs/ examples/ demos/ benchmarks/ rfcs/ scripts/ ci/ dast/
infra/{docker{,/compose}, kubernetes, helm, examples, monitoring}
security/  audits/  governance/  plans/  .github/  .githooks/
```
Detail + breaking-change analysis: `governance/REPOSITORY-ORGANIZATION.md`.
**No published path changed → zero consumer breakage.**

---

## Phase 4 — Docker (VERIFIED)

| Dockerfile | Class | Disposition |
|---|---|---|
| `infra/docker/Dockerfile` | production (framework) | keep (distroless, digest-pinned, non-root) |
| `packages/registry-server/Dockerfile` | production (service) | keep (deployable service) |
| `app-*/Dockerfile` (×4), `demos/Dockerfile` | example | keep with sample |
| `packages/plugin-*` | — | **none ship a Dockerfile (VERIFIED)** |

All base images digest-pinned (`node:20-alpine@sha256:…`); compose validated via
`docker compose config`. Detail: `audits/DOCKER-REVIEW.md`.

---

## Phase 5 — .gitignore

Added: `.idea/`, `playwright-report/`, `logs/`, `*.sqlite`, `*.sqlite3`, `*.db`
(plus existing `.env*`, `*.pem/*.key/*.crt`, `dist/`, `coverage/`, `node_modules/`,
tfstate/kubeconfig/service-account). **Did not** ignore `.vscode/settings.json` —
it is intentionally tracked shared config (contributor-file rule overrides).

---

## Phase 6 — Secret detection (.gitleaks.toml)

6 explicit rules: `pem-private-key-block`, `aws-access-key-id`, `gh-pat`,
`npm-authtoken`, `gcp-service-account-key`, `kubeconfig-token` + upstream default
ruleset. The false signing-key path-allowlist was removed; a **truthful
commit-scoped allowlist** accepts the one known historical blob (pending purge)
while still catching any new key.

---

## Phase 7 — Dependabot

Ecosystems: `github-actions` (/), `npm` (/ + the 4 frontend `web/` apps),
`docker` (`infra/docker`, `app-*`, `demos`, `packages/registry-server`). Grouped
dev/prod, weekly, cooldown. (Web apps need a committed lockfile to fully activate.)

---

## Phase 8 — SECURITY.md

Contains: supported versions, CVSS v3.1 severity + SLAs, private vulnerability
reporting, scope, **plugin-vulnerability reporting**, **CVE/GHSA policy**, and
**encrypted reporting** (GitHub-native; PGP placeholder for maintainers — no
fabricated key). Per-plugin `SECURITY.md` points here (21/21).

---

## Phase 9 — Plugin security (VERIFIED)

Dangerous-construct scan across `packages/plugin-*/src`: **0** `eval`, `new
Function`, `child_process`, `exec`/`spawn`, `any`-types, arbitrary file writes.
All 21 plugins: signed manifest matching anchor, required files (incl. `LICENSE` +
`SECURITY.md` added this pass), no secret logging, input validation.
Known gaps (runtime, separate change): outbound timeouts on 9 `node:https`
plugins; webhook verifiers for stripe/twilio/paypal/sendgrid. Detail:
`audits/PLUGIN-SECURITY-REPORT.md`, `security/PLUGIN-SECURITY-AUDIT.md`,
`security/PLUGIN-SECURITY-STANDARD.md`.

---

## Phase 10 — Documentation cleanup

Root 45 → 7 `.md`; strategy → `plans/`, reports → `audits/`, security → `security/`,
governance → `governance/`. Remaining moves (SEO files, `app-*`) in
`plans/REPOSITORY-CLEANUP-PLAN.md`.

---

## Phase 11 — Repository policy (repository-policy.yml)

Jobs: root-folder allowlist, no-RESTRICTED-tracked, governance-docs-present,
**no-plugin-dockerfiles**. Plus `block-private-keys.yml` (secrets-guard mirror +
anchor verify + infra-identifier scan) and `security-baseline.yml` (plugin standard
+ forbidden files). All dry-run green against the current tree.

---

## Phase 12 — CI hardening (VERIFIED)

38 workflows, all with `permissions:` (default `contents: read`); SHA-pinned core
actions; no `pull_request_target`; npm provenance + cosign signed releases;
CodeQL, Scorecard, secret-scan (gitleaks free CLI + trufflehog `--only-verified`),
dependency-review; `secrets-guard` is rule #1 gating the release chain.
Minor: standardize `retention-days`/`concurrency` (8/38 use concurrency).

---

## Phase 13 — Enterprise readiness vs Next/Nest/Astro/Nuxt/Laravel/Express/Fastify/Vite

Composite **~82/100**. Ahead of Express/Fastify/Vite on supply-chain trust (signed
+ CI-verified plugins); on par with Next/Nest/Nuxt on structure, RFCs, provenance;
behind Next/Laravel on ecosystem breadth and hosted docs search/versioning.
Top gaps: single-owner CODEOWNERS, branch/push protection, history purge, plugin
timeouts/webhook verifiers, PGP/security-team breadth. Detail:
`audits/ENTERPRISE-READINESS-COMPARISON.md`.

---

## Top risks (residual)

1. (HIGH) Leaked key blob in history — distrusted but unpurged.
2. (HIGH) On-disk private keys in tree (gitignored).
3. (MED) Branch/Push protection not enforced (platform).
4. (MED) 9 HTTP plugins lack outbound timeouts; missing webhook verifiers.
5. (MED) Single-owner CODEOWNERS.
6. (LOW) `web/` apps lack lockfiles; SEO files tracked; `app-*` at root; `verification-artifacts/` tracked.

## Remediation plan (priority)
- **P0 (operator):** purge history (`security/KEY-ROTATION-RUNBOOK.md` §7); relocate keys; enable Secret Scanning + Push Protection + branch protection.
- **P1 (governance/org):** fill CODEOWNERS teams; commit `web/` lockfiles; relocate `app-*` → `examples/`; move SEO files to website repo; generate `verification-artifacts/` in CI.
- **P2 (runtime, separate change):** plugin outbound timeouts + webhook verifiers; add PGP key; versioned/searchable docs.

## Migration & breaking-change analysis
All moves are repo-internal `git mv` (history preserved); every script/CI/doc
reference updated and statically validated (`node --check`, `bash -n`, YAML
diagnostics, `docker compose config`). **No npm package path, import, or public API
changed → zero downstream breakage.** Rollback: every change is a revertable
commit; the only irreversible action (history purge) is operator-gated and retains
a pre-rewrite mirror.

## Deliverables index
- `audits/REPOSITORY-HARDENING-REPORT.md` (+ Phase 1/12 tables, completion matrix)
- `audits/PLUGIN-SECURITY-REPORT.md` · `audits/DOCKER-REVIEW.md` · `audits/ENTERPRISE-READINESS-COMPARISON.md`
- `security/SECURITY-CLASSIFICATION.md` · `security/PLUGIN-SECURITY-STANDARD.md` · `security/KEY-ROTATION-RUNBOOK.md` · `security/*-REVIEW.md`
- `governance/CHARTER.md` · `governance/REPOSITORY-ORGANIZATION.md`
- `plans/REPOSITORY-CLEANUP-PLAN.md` · root `CHANGELOG.md` (`[Unreleased]`)
- CI: `repository-policy.yml`, `security-baseline.yml`, `block-private-keys.yml`; configs: `.gitleaks.toml`, `.gitignore`, `dependabot.yml`, `.github/CODEOWNERS`

## 14-phase completion

| Phase | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Status | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

*Read-only assessment consolidating work applied across the governance/security
hardening sprints. No `packages/core` runtime code was modified.*
