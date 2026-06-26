# Repository Privacy & Exposure Policy

> **Status:** Normative policy for the public `streetJS` framework repository.
> **Audience:** Contributors and maintainers.
> **Related:** [`CONTRIBUTING.md`](../CONTRIBUTING.md) · [`SECURITY.md`](../SECURITY.md) · [`SECURITY-AUDIT-2026.md`](../audits/archive/SECURITY-AUDIT-2026.md) · [`.gitignore`](../.gitignore) · [`.gitleaks.toml`](../.gitleaks.toml)

## 1. Purpose & scope

StreetJS is a **public, open-source** framework. Everything committed here is world-readable, forever, including content removed in a later commit — git history preserves it. This policy defines, for every file you might add:

- what **may** be committed publicly,
- what must be **generated in CI** rather than hand-committed,
- what is **internal** and belongs in a private repo or local-only `plans/`,
- and what must **never** touch the repository under any circumstances.

It applies to all branches, all packages under `packages/`, all docs, all workflows, and any working files created while developing against this repo. When in doubt, treat content as more sensitive, not less, and ask a maintainer before pushing.

## 2. Classification model

Four tiers. Each file you add falls into exactly one. Examples below are drawn from this repo's actual layout and its existing [`.gitignore`](./.gitignore) rules.

### Tier 1 — PUBLIC (commit freely)

Source and project artifacts intended for the world.

- Framework source under `packages/` (e.g. `packages/core/`, `packages/cli/`, `packages/plugin-*`).
- Official documentation under `docs/` (doc sources stay tracked — the documentation certification suite requires `docs/*.md` in the repo).
- `examples/` and `packages/*/example/` sample apps.
- RFCs and design proposals intended for public review (`rfcs/`).
- Governance and project files: `LICENSE`, `SECURITY.md`, `GOVERNANCE.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `MAINTAINERS.md`, `CITATION.cff`.
- **Templates only**, never real values: `.env.example` (explicitly re-included via `!.env.example`).

### Tier 2 — GENERATED-IN-CI (do not hand-commit)

These are build/release outputs. CI produces them deterministically; a hand-committed copy is at best stale and at worst misleading. The `.gitignore` already blocks the main offenders.

- `sbom.json` (software bill of materials).
- Coverage reports — `coverage/`.
- `certification-report.json`, `RELEASE-CERTIFICATION.md`.
- Benchmark reports — `benchmark-report.json`, `benchmark-report.md`, `benchmark-history.json`, `ratelimit-benchmark.json`.
- Verification artifacts — `verification-artifacts/` (produced by executed commands, uploaded from CI).
- Build output — `dist/`, `packages/*/dist/`.
- Signed manifests / signatures — produced and **signed during release in CI**, never signed locally and committed.

> If you need to share a generated artifact for review, attach it to the PR or CI run. Do not commit it into the tree.

### Tier 3 — INTERNAL (private repo or local `plans/`, never public)

Business, strategy, and agent working files. These are not secrets in the cryptographic sense, but publishing them is an information-exposure problem (reveals roadmap, competitive posture, marketing plans, internal tooling). Keep them in a private repository or a local-only `plans/` directory that is not pushed.

- Strategy / roadmap / marketing / adoption planning docs, e.g.:
  `ADOPTION-ASSETS.md`, `COMMUNITY-GROWTH-PLAN.md`, `CONTENT-*.md`, `DEMO-INFRA-PLAN.md`, `PHASE-18-*`, `SHOWCASE-*`, `TRUST-CENTER-PLAN.md`, `WEBSITE-EVOLUTION.md`, `STREETJS-EXPANSION-MASTERPLAN.md`.
- Agent / assistant working files: `CLAUDE.md` (gitignored), `.kiro/specs/` (gitignored — "kept local, not source-controlled").
- Local-only audits: `STREET_WEBSITE_ENTERPRISE_AUDIT.md` (already gitignored).

### Tier 4 — NEVER COMMIT (secrets)

Cryptographic material and access credentials. A single commit equals a full compromise of whatever the secret protects. The `.gitignore` blocks these by pattern, but the pattern is a safety net, not a license to rely on it.

- Environment files with real values — `.env`, `.env.*` (only `.env.example` is allowed).
- Private keys — `*.pem`, `*.key`.
- Certificates — `*.crt`, `*.p12`, `*.pfx`.
- Service-account / credentials JSON — `*service-account*.json`, `*credentials*.json`, `aws-credentials.json`.
- npm tokens — any `.npmrc` containing `_authToken`.
- Signing keys — e.g. `street-signing.key.pem` (and the `*.street-signing.pem` / `*.street-signing.pub.pem` patterns).
- Any API key, bearer token, OAuth client secret, or webhook secret.

## 3. CRITICAL incident: a signing key reached public history

This is the cautionary tale that justifies the entire Tier 4 list.

**What happened:** the plugin-signing private key `street-signing.key.pem` was committed to git history in commit **`d7bbfc40`** and pushed to **`origin/main`**. The moment a private key is pushed to a public remote, it is **compromised** — assume it has been cloned, indexed, and scraped. Removing it in a later commit does **not** undo the exposure; the blob lives in history until purged, and copies may already exist off-platform.

**Required response (treat the key as burned):**

1. **Rotate** — generate a new signing keypair and invalidate the exposed one everywhere it was trusted.
2. **Purge** — rewrite history to remove the blob from all refs, then force-update the remote and have collaborators re-clone.
3. **Relocate** — store the new key in a secrets manager / CI secret store, never back in the working tree.
4. **Verify** — confirm no workflow or signing script references the on-disk path, and that the scanner allowlist for the historical path is defense-in-depth only.

Cross-reference [`SECURITY-AUDIT-2026.md`](../audits/archive/SECURITY-AUDIT-2026.md) for the full incident record and remediation status. **Verified status (do not soften this):** the public half of the exposed `street-signing.key.pem` (DER-SHA256 `df5e2726…`) is an **exact match** for the embedded official trust anchor `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` in `packages/core/src/platform/plugins/official-key.ts` — i.e. the leaked key **is** the official plugin-signing key that consumers verify against (`registry.ts` defaults trust to `officialPluginPublicKey()`). It is **not** a retired or non-production key. While the working-tree path is now gitignored and allowlisted in [`.gitleaks.toml`](../.gitleaks.toml), and the publish pipeline reads `STREET_PLUGIN_SIGNING_KEY` from a GitHub secret rather than a tracked file, **none of that neutralizes the exposure**: the private key remains recoverable from pushed history, so anyone can forge signatures that pass official verification. The `.gitleaks.toml` comment claiming this key is "not the production key" / "purged from history" is **factually wrong** and must be corrected. The required response is **rotation** — generate a new keypair, update the embedded anchor, re-sign all official plugins in CI, and revoke trust in the old public key — not deletion alone. A private key that reaches a public remote must be rotated, not just deleted.

## 4. Handling secrets correctly

Secrets must live exactly one of three places — never the repo.

- **CI / release:** GitHub Actions secrets, referenced as `secrets.*` in workflow YAML. Examples: `secrets.STREET_PLUGIN_SIGNING_KEY` for plugin signing, npm publish tokens for the `publish-*` workflows. Signing and publishing happen inside CI so the secret is injected at runtime and never persisted.
- **Local development:** a `.env` file at the repo root. It is gitignored (`.env`, `.env.*`). Commit only the redacted `.env.example` template so others know which variables to set.
- **Keys and certs:** stored **outside the working tree** entirely (a secrets manager, your OS keychain, or a path well away from any git repo). If a tool needs a key path, point it at that external location — do not copy the key into the project directory "just for now."

Rule of thumb: if a value would let someone act as you, sign as the project, or spend money, it is a secret and belongs in a secret store.

## 5. Enforcement

Layered, so a mistake has to slip past several gates:

- **gitleaks** — configured in [`.gitleaks.toml`](../.gitleaks.toml) (extends the default ruleset, with narrow allowlists for documented public test fixtures). Run locally:
  ```bash
  gitleaks detect --source . --config .gitleaks.toml --redact
  ```
- **Local git hooks** — [`.githooks/pre-commit`](./.githooks/pre-commit) (validates staged workflow YAML) and [`.githooks/pre-push`](./.githooks/pre-push) (blocks mismatched release tags). These run only if you've enabled the hooks path (see below).
- **CI secret scanning** — `.github/workflows/secret-scan.yml` enforces gitleaks on every push and PR.
- **Recommended CI gate** — a required status check that **fails the build** on any newly added private key, token, or `.env` file (not just `.env.example`). Wire it as a branch-protection-required check so a flagged PR cannot merge. This makes Tier 4 enforcement non-bypassable at the server side, complementing the client-side hooks.

**Contributors: enable the hooks once per clone.**

```bash
git config core.hooksPath .githooks
```

(The repo's `prepare` script sets this automatically on install; run it manually if you skipped install scripts.) Bypassing a hook with `--no-verify` is intentional for narrow cases — never use it to push secrets.

## 6. Contributor checklist (before you push)

- [ ] Hooks enabled: `git config core.hooksPath .githooks`.
- [ ] Ran `gitleaks detect --source . --config .gitleaks.toml --redact` clean.
- [ ] No `.env` (only `.env.example`), no `*.pem` / `*.key` / `*.crt` / `*.p12` / `*.pfx`, no `*credentials*.json` / `*service-account*.json`, no `.npmrc` with `_authToken`.
- [ ] No signing keys (`street-signing.key.pem` and friends) anywhere in the diff.
- [ ] No Tier 2 generated artifacts hand-committed (`coverage/`, `dist/`, `sbom.json`, `certification-report.json`, `RELEASE-CERTIFICATION.md`, benchmark reports, `verification-artifacts/`).
- [ ] No Tier 3 internal docs (strategy/roadmap/marketing, `CLAUDE.md`, `.kiro/specs/`) — these go to a private repo or local `plans/`.
- [ ] `git diff --cached --name-only` reviewed file-by-file; nothing unexpected staged.
- [ ] Real config values live in `.env` / GitHub Secrets / a secrets manager — not in source, tests, or docs.
- [ ] If you discover a secret already in history, **stop** and follow §3: rotate, purge, relocate, and notify a maintainer per [`SECURITY.md`](../SECURITY.md).
