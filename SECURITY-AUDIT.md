# StreetJS — Repository Security Audit

**Scope:** Repository-level security posture of the StreetJS framework monorepo (secrets handling, plugin-signing trust model, CI security controls, and security-artifact placement).
**Audit type:** Read-only documentation deliverable. No code, files, git history, or CI configuration were modified in producing this report.
**Methodology:** Verified findings combined with read-only `git`, `git ls-files`, `git cat-file`, and content inspection of `.gitignore`, `.gitleaks.toml`, `.githooks/`, `.github/workflows/`, and `SECURITY.md`.

---

## 1. Executive Summary

StreetJS ships with a mature, well-considered security toolchain: a strong `.gitignore`, a tuned `gitleaks` configuration, local git hooks, and a broad set of CI security workflows (CodeQL, OpenSSF Scorecard, secret scanning, dependency review, DAST). The plugin-signing pipeline is also designed correctly for the common path — CI signs from a GitHub Secret, and the signing script fails closed when handed an ephemeral key.

That strong posture is undermined by **one catastrophic finding**: the **Ed25519 plugin-signing private key was committed to git history and pushed to the remote**. The committing commit (`d7bbfc40`) is an ancestor of `origin/main`, so the private key is part of the published history and is trivially recoverable by anyone with clone/fork access. The public half of this leaked private key (DER-SHA256 `df5e2726ecad5ffd992c1a182adff5999fdadca00366c02c092098c83cf0f540`) is an **exact match** for the embedded official trust anchor `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` (`packages/core/src/platform/plugins/official-key.ts`), which the registry uses as the default key consumers verify official plugins against (`officialPluginPublicKey()`, `packages/core/src/platform/plugins/registry.ts:89`). In other words, **the official plugin-signing private key is in pushed git history**, so an attacker can mint forged plugins that verify as official. The key must be treated as **compromised**, and every artifact whose authenticity depends on it must be re-established under a new key.

**Correction to earlier specifics:** the leaked key did **not** sign `@streetjs/plugin-marzpay@1.1.0`. The marzpay `manifest.pub` is a **different** key (DER-SHA256 `7de6474b332d48ff65a0202ef8b138c51db262e89af5ff8c2f93e8deab624919`) whose private half (the on-disk `street-signing.key.pem`) was searched for across **all** history blobs and is **not** present — so the key that signed marzpay 1.1.0 was not leaked. Of the 21 plugins, **only** `@streetjs/plugin-htmx` ships the embedded official key (`df5e2726…`); the other 20 each ship a **distinct** `manifest.pub` (see F-7).

Until the key is rotated and trust in the old public key is revoked, an attacker in possession of the leaked private key can forge signatures that pass verification against the currently-distributed official public key — i.e., publish malicious plugins that appear "officially signed." This is the defining risk of the repository today and it dominates the score.

**Bottom line:** excellent tooling, one trust-fatal exposure. The exposure is fully remediable, but remediation **requires key rotation** — history rewriting alone is insufficient because the key is already in clones, forks, and CI caches.

---

## 2. Security Score

### Security Score: **42 / 100**

| Band | Meaning |
| --- | --- |
| 0–39 | Critical, actively exploitable exposure with no compensating controls |
| **40–59** | **Strong tooling undermined by a severe, trust-fatal exposure** |
| 60–79 | Solid posture with notable gaps |
| 80–100 | Enterprise-grade, defense-in-depth |

**Justification.** The baseline tooling and process design would score in the high 80s on their own: no secrets are currently tracked, the ignore/scan/hook stack is comprehensive, and CI signing is correctly secret-backed. However, a **committed-and-pushed signing private key that anchors the entire plugin trust model** is a categorical failure — it invalidates the integrity guarantee the framework markets to its users. A signing system whose root key is public provides *negative* assurance (it lets forgeries look legitimate), so the otherwise-strong controls cannot offset it. The score is held at **42/100**: the controls keep it out of the sub-40 "no compensating controls" band, but the trust-anchor compromise prevents anything higher.

**Projected score after remediation: ~88/100.** Once the key is **rotated** (new keypair, new public key distributed, all official plugins re-signed and re-released, old public key trust revoked), history is **purged** (`git filter-repo`/BFG + coordinated force-push), and **all** plugin signing is moved into CI (key never touches a workstation), the residual risk drops to ordinary operational hardening and the repository reaches enterprise-grade.

---

## 3. Risk Score

### Risk Score: **High — 72 / 100**

| Dimension | Rating | Notes |
| --- | --- | --- |
| Likelihood of exploitation | High | Key is recoverable with one `git show` against pushed history; no special access required beyond clone/fork. |
| Blast radius | Critical | Trust anchor for **every** official signed plugin; forged plugins pass official verification. |
| Detectability of abuse | Low | A forged signature is cryptographically valid against the current public key; nothing flags it as fraudulent. |
| Reversibility | Partial | History can be purged, but exposure cannot be "un-leaked"; rotation is mandatory. |
| Compensating controls | Moderate | Strong scanning/CI exists but did **not** prevent or retroactively neutralize this specific leak. |

Risk is rated **High (72/100)** rather than Critical-maximum because the exposure is well-understood, bounded to a single (rotatable) credential, and fully remediable with known procedures. It is not lower because the leaked credential is a **trust root** and the leak is already **public in pushed history**.

---

## 4. Findings Table

| # | Severity | Finding | Status | Evidence |
| --- | --- | --- | --- | --- |
| F-1 | **Critical** | Ed25519 plugin-signing **private key** committed and **pushed** to `origin/main` history; recoverable today. | Open | `git show d7bbfc40:street-signing.key.pem` → `-----BEGIN PRIVATE KEY-----`; `git merge-base --is-ancestor d7bbfc40 origin/main` → true; blob still present (`git cat-file -t` → `blob`). |
| F-2 | High | `.gitleaks.toml` documents the leaked key as "**NOT** the production signing key" and "**purged from history**" — both statements are false and create a dangerous false sense of safety; the allowlist path also exempts the key filename from scanning. | Open | `.gitleaks.toml` allowlist comment + `paths` entry `street-signing\.(key\|pub)\.pem$`. |
| F-3 | High | Process gap: only `@streetjs/plugin-htmx` has a CI signing workflow. `@streetjs/plugin-marzpay@1.1.0` was signed during a **manual local publish** using an **on-disk per-plugin key** (`street-signing.key.pem`, public half DER-SHA256 `7de6474b…` — *not* the leaked official anchor), meaning long-lived signing keys reach developer workstations. | Open | `sign-htmx.yml` is the only signing workflow; `packages/plugin-marzpay/manifest.signed.json` present. |
| F-4 | Medium | A second **untracked** private key exists in the working tree: `packages/plugin-marzpay/signing-key.pkcs8.pem` (gitignored, on disk). Increases manual-signing surface and risk of a repeat leak. | Open | `git status --ignored` → `!! packages/plugin-marzpay/signing-key.pkcs8.pem`. |
| F-5 | Medium | The working-tree `street-signing.key.pem` still sits inside the repo directory (untracked/gitignored). One `git add -f` or tooling misstep away from re-exposure. | Open | `git status --ignored` → `!! street-signing.key.pem`. |
| F-6 | Low | No CI gate explicitly fails a build when a `BEGIN PRIVATE KEY` blob or `*.pem`/`*.key` file is added; reliance is on gitleaks defaults + ignore rules (which currently allowlist the sensitive filename — see F-2). | Open | No dedicated private-key-block job in `.github/workflows/`. |
| F-7 | High | **Inconsistent / half-finished signing-key rotation.** The embedded official trust anchor (`official-key.ts`) still embeds the **old leaked** key (`df5e2726…`), yet newer releases were signed with a **new** key (e.g. marzpay = `7de6474b…`, never committed). Each of the 21 plugins ships a different `manifest.pub`; only htmx matches the embedded official key. So (a) any plugin signed with a non-official key (incl. marzpay 1.1.0) would **fail** verification against `officialPluginPublicKey()` — a correctness/trust break; and (b) the compromised key remains the embedded anchor, so the rotation that appears to have begun was never completed in core. | Open | `official-key.ts` DER-SHA256 `df5e2726…`; `registry.ts:89` defaults trust to `officialPluginPublicKey()`; 21 distinct `manifest.pub` files (marzpay `7de6474b…`, htmx `df5e2726…`, 19 others all distinct). |

**Only F-1 is Critical.** F-2/F-3/F-7 are High because they materially weaken the response to and recurrence-prevention of F-1.

---

## 5. Secrets Audit

**Currently tracked secrets: none.** Verified read-only:

- No `*.pem`, `*.key`, `*.crt`, `*.p12`, or `*.pfx` files are tracked.
- No `*service-account*.json` / `*credentials*.json` tracked.
- The only `.env`-family files tracked are **templates** (`.env.example` at root and per-app), which is correct.
- The on-disk root `.env`, `street-signing.key.pem`, and `packages/plugin-marzpay/signing-key.pkcs8.pem` are **untracked and gitignored** (confirmed via `git status --ignored`).

**`.gitignore` posture: strong.** It ignores `.env` / `.env.*` (with an explicit `!.env.example` re-include), `*.pem` / `*.key` / `*.p12` / `*.pfx` / `*.crt`, `*service-account*.json` / `*credentials*.json` / `aws-credentials.json`, plus build/generated outputs (`dist/`, `packages/*/dist/`, `coverage/`, `verification-artifacts/`, certification/benchmark artifacts), `.kiro/specs/`, and `CLAUDE.md`.

**The exception that matters:** the ignore rules were added *after* `d7bbfc40`, so they protect the working tree going forward but do **not** retroactively remove the key from history (F-1). The presence of two untracked private keys on disk (F-4, F-5) means the ignore rules are now the *only* thing standing between those keys and a second commit — a single forced add bypasses them.

**Secrets handling verdict:** correct for everything *except* the historical signing-key blob, which is the entire problem.

---

## 6. Signing Infrastructure Audit

**Design (correct):**

- CI signs `@streetjs/plugin-htmx` from a GitHub Secret: `STREET_PLUGIN_SIGNING_KEY: ${{ secrets.STREET_PLUGIN_SIGNING_KEY }}` (`.github/workflows/sign-htmx.yml`). No committed key is referenced by that workflow.
- The workflow verifies its own output against the official public key and fails the job if the manifest is not signed by the official key — a good integrity self-check.
- `sign.mjs` refuses to sign with an ephemeral key (fail-closed), preventing accidental "signed-with-throwaway-key" releases.
- `main` is treated as protected; the signing workflow uploads an artifact rather than pushing, keeping release flow controlled.

**Trust model (compromised by F-1):**

- The committed private key `street-signing.key.pem` (in pushed history at `d7bbfc40`) has public half `df5e2726…`, an **exact match** for the embedded official trust anchor (`official-key.ts`) that `officialPluginPublicKey()` returns and consumers verify official plugins against (`registry.ts:89`). Because that private key is in pushed history, **any** signature that verifies against the official key — including `@streetjs/plugin-htmx`, whose `manifest.pub` is the official key — can no longer be assumed to be exclusively maintainer-produced. Anyone with the leaked key can mint valid "official" signatures.
- **Note (corrected):** `@streetjs/plugin-marzpay@1.1.0` was **not** signed with the leaked key. Its `manifest.pub` is a distinct key (`7de6474b…`) whose private half was not found anywhere in history. The marzpay signature itself is therefore not forgeable from the leaked material — but see F-7: marzpay's key is not the official anchor, so it would not verify as official either.
- **Process gap (F-3):** only htmx signs in CI. `plugin-marzpay@1.1.0` was signed via a **manual local publish** using an on-disk per-plugin key. Any signing path that touches a workstation re-exposes long-lived key material and is how leaks like F-1 happen.

**Required outcome:** the official public key currently distributed to plugin hosts/consumers must be **revoked and replaced**, and **all** official plugins re-signed under a new key whose private half lives **only** in CI secrets.

---

## 7. Security-Artifacts Placement

| Artifact | Nature | Correct home | Current/Recommended |
| --- | --- | --- | --- |
| `SECURITY.md` | **Public** policy (reporting, severity SLAs, supported versions) | Repo root, source-controlled | ✅ Present and well-formed (CVSS bands, private reporting, response windows). Keep tracked. |
| `THREAT-MODEL` | Analysis doc | Source-controlled **or** release-attached; should be reviewed like code | Recommend: keep tracked at root (e.g., `THREAT-MODEL.md`) and reference from `SECURITY.md`. |
| SBOM (e.g., CycloneDX/SPDX) | **Generated** | Build/release output, attached to releases — not hand-authored in tree | Recommend: generate in CI, publish as a release asset + attestation; do not commit a static copy. |
| OpenSSF Scorecard report | **Generated** | CI-produced, surfaced via badge/dashboard | Recommend: keep `scorecard.yml` producing results to the dashboard; do not commit report JSON. |
| Signed plugin manifests (`manifest.signed.json`) | Release evidence | Committed per package (current practice) | Acceptable; ensure they are regenerated under the rotated key. |
| This audit / enterprise audits | Internal/eval | Local or restricted; some are already gitignored (`STREET_WEBSITE_ENTERPRISE_AUDIT.md`) | Decide tracked-vs-local per disclosure policy. |

**Principle:** public-facing policy (`SECURITY.md`) stays tracked; **generated** artifacts (SBOM, Scorecard) are produced by CI and attached to releases rather than committed, so they cannot drift from reality. The `.gitleaks.toml` comment in F-2 is a cautionary example of a hand-authored security artifact drifting *away* from the verified truth.

**CI security workflows present** (enumerated from `.github/workflows/`): `codeql.yml`, `scorecard.yml`, `secret-scan.yml`, `dependency-review.yml`, `dast.yml`, plus `ci-cd.yml`, `ci-cd-enforcement.yml`, `registry-verify.yml`, `runtime-certification.yml`, `enterprise-verify.yml`, `deploy-verify.yml`, `soak-scale-chaos.yml`, and integration suites (mongodb/kafka/rabbitmq/orm/provider/vendor). This is a strong, broad control surface.

---

## 8. Enforcement Recommendations (ready-to-apply snippets — NOT applied)

> These are provided as drop-in snippets for maintainers to review and apply through the normal change process. **No CI, hook, or config file was modified by this audit.** Note in particular that recommendation 8.1 *reverses* the current `.gitleaks.toml` allowlisting of the signing-key path (F-2).

### 8.1 Strengthen gitleaks to explicitly catch private keys (and stop allowlisting the leaked path)

Remove the `street-signing\.(key|pub)\.pem$` entry from the `[allowlist].paths` (it currently hides the very file that leaked), and add an explicit rule:

```toml
# Append to .gitleaks.toml
[[rules]]
id = "pem-private-key-block"
description = "PEM private key material must never be committed"
regex = '''-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----'''
keywords = ["PRIVATE KEY"]
# Do NOT allowlist street-signing.* — that exemption is what masked the leak.
```

### 8.2 CI job that fails if any private key / sensitive keypair file is added

```yaml
# Suggested: a "block-secrets" job (e.g., add to secret-scan.yml or a new workflow)
name: Block private keys
on: [push, pull_request]
permissions:
  contents: read
jobs:
  block-private-keys:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
          persist-credentials: false
      - name: Fail on tracked key files
        run: |
          if git ls-files | grep -E '\.(pem|key|p12|pfx)$'; then
            echo "::error::A private key / keystore file is tracked. Remove it and rotate the credential."
            exit 1
          fi
      - name: Fail on BEGIN PRIVATE KEY blobs in the diff
        run: |
          if git grep -nI -e '-----BEGIN .*PRIVATE KEY-----' -- . ':(exclude)**/*.test.*'; then
            echo "::error::Private key material detected in tracked content."
            exit 1
          fi
```

### 8.3 Pre-commit private-key block (local defense-in-depth)

```bash
# Suggested addition to .githooks/pre-commit (runs before the existing workflow validation)
STAGED=$(git diff --cached --name-only --diff-filter=ACM)
for f in $STAGED; do
  case "$f" in
    *.pem|*.key|*.p12|*.pfx)
      echo "[pre-commit] BLOCKED: refusing to commit key/keystore file: $f" >&2
      exit 1 ;;
  esac
  if git show ":$f" 2>/dev/null | grep -q -- '-----BEGIN .*PRIVATE KEY-----'; then
    echo "[pre-commit] BLOCKED: private key material in $f" >&2
    exit 1
  fi
done
```

---

## 9. Phased Action Plan

### Immediate — within 7 days (P0)

1. **Rotate to a single new official key.** Generate **one** fresh Ed25519 keypair; store the private half **only** in GitHub Secrets (`STREET_PLUGIN_SIGNING_KEY`). Treat the embedded `df5e2726…` anchor (and the ad-hoc per-plugin keys such as marzpay's `7de6474b…`) as **compromised/distrusted**, and distribute the **new public key** to plugin hosts/consumers.
2. **Update the embedded anchor and re-sign consistently.** Replace `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` in `packages/core/src/platform/plugins/official-key.ts` with the new public key, then **re-sign all 21 plugins** (htmx, marzpay, and the 19 others currently shipping distinct `manifest.pub` keys) with the single new official key in CI, and publish the new signed manifests. This completes the half-finished rotation in F-7 and ensures every plugin verifies against `officialPluginPublicKey()`.
3. **Move ALL plugin signing into CI.** Generalize the `sign-htmx.yml` pattern so every official plugin signs from the CI secret. The private key must never again touch a developer machine (closes F-3).
4. **Purge history** of `street-signing.key.pem` and `street-signing.pub.pem`: `git filter-repo --invert-paths --path street-signing.key.pem --path street-signing.pub.pem` (or BFG), then **coordinate a force-push** with all contributors and have everyone re-clone. ⚠️ Purging does **not** undo exposure (existing clones/forks/CI caches retain the blob) — this is why rotation in step 1 is mandatory regardless.
5. **Remove on-disk keys from the repo directory.** Move `street-signing.key.pem` (F-5) and `packages/plugin-marzpay/signing-key.pkcs8.pem` (F-4) into a secrets manager / outside the working tree.
6. **Correct `.gitleaks.toml` (F-2):** delete the false "not the production key / purged from history" comment and the path allowlist for the signing key; apply snippet 8.1.

### Medium-term — within 30 days

7. Apply enforcement snippets 8.1–8.3 through normal review; add a CI `block-private-keys` gate (8.2).
8. Add signing to the publish pipeline for **every** plugin package and assert in CI that published manifests verify against the **new** official public key (extend the htmx self-check to all plugins).
9. Generate and attach an **SBOM** per release (CycloneDX/SPDX) and publish signing/build **attestations**; stop committing generated security reports.
10. Document the incident and rotation in a GitHub Security Advisory and the changelog so downstream consumers know to trust the new key and distrust the old one.

### Long-term — within 90 days

11. Adopt a **keyless / managed signing** model (e.g., Sigstore/cosign with OIDC, or a KMS/HSM-backed key) so no long-lived private key exists to leak.
12. Establish a **key-rotation policy** (scheduled rotation, defined revocation procedure, dual-control for release signing).
13. Add periodic **history secret-scanning** (full-history gitleaks run in CI) and a recurring audit cadence to catch drift between security documentation and verified reality.
14. Re-run this audit to confirm the projected **~88/100** posture is achieved.

---

## 10. Verification Notes

- `git show d7bbfc40:street-signing.key.pem` returns `-----BEGIN PRIVATE KEY-----` (real PKCS#8 Ed25519 private key).
- `git merge-base --is-ancestor d7bbfc40 origin/main` exits 0 → commit is on pushed `main`.
- `git cat-file -t d7bbfc40:street-signing.key.pem` → `blob` (still resident in history).
- `git ls-files | grep -E '\.(pem|key|crt|p12|pfx)$'` → empty (nothing sensitive currently tracked).
- `git status --ignored` shows `.env`, `street-signing.key.pem`, and `packages/plugin-marzpay/signing-key.pkcs8.pem` as ignored/untracked on disk.
- Commit `d7bbfc40` introduced both `.pem` files (2026-06-14); `6088fa22` deleted `street-signing.key.pem`.

### Verified key-comparison evidence

All public keys compared by DER (SubjectPublicKeyInfo) SHA-256:

| Key | DER-SHA256 | Match? |
| --- | --- | --- |
| Embedded official trust anchor (`packages/core/src/platform/plugins/official-key.ts`, `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM`) | `df5e2726ecad5ffd992c1a182adff5999fdadca00366c02c092098c83cf0f540` | — (reference) |
| Public half of **leaked private key** in pushed history (`d7bbfc40:street-signing.key.pem`) | `df5e2726ecad5ffd992c1a182adff5999fdadca00366c02c092098c83cf0f540` | ✅ **MATCH** → official signing private key is in pushed history (F-1) |
| Current **on-disk** `street-signing.key.pem` public half (private searched across all history blobs — **not present**) | `7de6474b332d48ff65a0202ef8b138c51db262e89af5ff8c2f93e8deab624919` | ❌ differs from official anchor |
| `packages/plugin-marzpay/manifest.pub` | `7de6474b332d48ff65a0202ef8b138c51db262e89af5ff8c2f93e8deab624919` | ❌ differs from official anchor (marzpay 1.1.0 not signed by leaked key) |
| `packages/plugin-htmx/manifest.pub` | `df5e2726ecad5ffd992c1a182adff5999fdadca00366c02c092098c83cf0f540` | ✅ matches official anchor (only plugin of 21 that does) |

- **Trust-key fact:** `packages/core/src/platform/plugins/registry.ts:89` defaults `this.trustedKey` to `officialPluginPublicKey()` (the embedded `official-key.ts` anchor) unless the caller supplies an explicit `publicKey` or opts into `allowUnsigned`. This is the key official plugins are verified against.
- Of the 21 plugins, only `plugin-htmx` ships the embedded official key (`df5e2726…`); the other 20 each ship a distinct `manifest.pub` (marzpay `7de6474b…`, and 19 others all different from each other and from the official key) — see F-7.

*This document is a read-only assessment. It did not modify code, move or delete files, alter CI configuration, or rewrite git history.*
