# StreetJS Plugin-Signing Key Rotation Runbook

> **Why:** the official plugin-signing **private key** is in pushed git history
> (`SECURITY-AUDIT.md`, F-1). Its public half (DER-SHA256 `df5e2726…`) is the
> embedded trust anchor `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM`
> (`packages/core/src/platform/plugins/official-key.ts`). Anyone with the leaked
> key can forge plugins that verify as official. **Deletion is not enough — the
> key must be rotated.** This runbook is the step-by-step fix.
>
> **Operator-run only.** Every command that touches a real private key, a GitHub
> Secret, `main`, or git history must be run **by a maintainer** in an
> authenticated environment. No automated agent generated the production key,
> edited core code, modified secrets, or rewrote history. Commands below are for
> you to execute and review.
>
> **Key facts this runbook relies on (verified):**
> - `STREET_PLUGIN_SIGNING_KEY` is a **PKCS#8 PEM Ed25519 private key**
>   (`packages/*/scripts/sign.mjs` calls `createPrivateKey(envKey)`).
> - `manifest.pub` is the **SPKI PEM** public half, derived in `sign.mjs` via
>   `createPublicKey(privateKey).export({ type: 'spki', format: 'pem' })`.
> - `official-key.ts` embeds that **same SPKI PEM**; `registry.ts:89` defaults
>   trust to `officialPluginPublicKey()`.
> - `publish-plugins.yml` already signs **all 21 plugins** from the secret and
>   fails unless each manifest verifies against `officialPluginPublicKey()`.

---

## Rotation status (2026)

| Key | DER-SHA256 fingerprint | Status |
| --- | --- | --- |
| Leaked official key (in history `d7bbfc40`) | `df5e2726ecad5ffd992c1a182adff5999fdadca00366c02c092098c83cf0f540` | **DISTRUSTED** |
| Old on-disk / marzpay key | `7de6474b332d48ff65a0202ef8b138c51db262e89af5ff8c2f93e8deab624919` | **RETIRED** |
| **New official key (2026)** | `3ae9add05d71dc5a17992caf192b1e465bcb9b2f2633231df44dbe2db8444b84` | **ACTIVE** |

| Step | State |
| --- | --- |
| 1. Generate new keypair | ✅ done (`keys/street-signing-2026.{key,pub}.pem`, `ed25519`) |
| 2. Store private key as CI secret + backup | ⏳ operator — **TODO** |
| 3. Update embedded anchor (`official-key.ts`) + rebuild core | ✅ done & verified (anchor = `3ae9add0…`) |
| 4. Re-sign all 21 plugins under the new key | ⏳ operator — **TODO** (CI anchor-verify job RED until done) |
| 5. Correct `.gitleaks.toml` (F-2) | ✅ done (allowlist removed, PEM rule added) |
| 6. Security Advisory + changelog | ⏳ operator — **TODO** |
| 7. Purge history + coordinated force-push | ⏳ operator — **TODO** (destructive) |
| 8. Move on-disk keys out of the tree | ⏳ operator — **TODO** (key currently in `keys/`) |
| 9. CI gate (`block-private-keys.yml` + anchor check) | ✅ done |

> Throughout this runbook, **`<NEW_FINGERPRINT>` = `3ae9add05d71dc5a17992caf192b1e465bcb9b2f2633231df44dbe2db8444b84`**.

---

## 0. Pre-flight

```bash
# Run from the repo root. Confirm you're on an up-to-date main.
git fetch origin
git status
node --version            # expect v20.x (matches CI's setup action)
openssl version           # any modern OpenSSL 1.1.1+ / 3.x with ed25519
```

Decide **where the new private key will live permanently**: only as the
`STREET_PLUGIN_SIGNING_KEY` GitHub Actions secret (and a secrets manager / offline
backup). It must **never** be committed or left in the working tree.

---

## 1. Generate ONE new Ed25519 keypair

Do this on a trusted workstation, ideally offline, in a directory **outside any
git repo** (e.g. `~/keys/`, not the project tree) so it cannot be accidentally
committed.

```bash
cd ~                      # NOT inside the streetJS repo
mkdir -p keys && chmod 700 keys && cd keys

# 1a. Private key — PKCS#8 PEM, Ed25519. This is the secret.
openssl genpkey -algorithm ed25519 -out street-signing-2026.key.pem
chmod 600 street-signing-2026.key.pem

# 1b. Public key — SPKI PEM. Safe to embed/distribute.
openssl pkey -in street-signing-2026.key.pem -pubout -out street-signing-2026.pub.pem
```

Inspect them:

```bash
cat street-signing-2026.pub.pem
# -----BEGIN PUBLIC KEY-----
# MCowBQYDK2Vw...
# -----END PUBLIC KEY-----
```

### 1c. Record the key's identity (DER-SHA256 fingerprint)

This is the same fingerprint the audit uses to compare keys. Save it — you'll use
it to confirm every plugin re-signs under the new key.

```bash
openssl pkey -pubin -in street-signing-2026.pub.pem -outform DER | sha256sum
# => <NEW_FINGERPRINT>  -   (must NOT be df5e2726… and NOT 7de6474b…)
```

### 1d. Sanity-check the format Node expects (must print `ed25519`)

```bash
STREET_PLUGIN_SIGNING_KEY="$(cat street-signing-2026.key.pem)" node -e '
const { createPrivateKey, createPublicKey } = require("node:crypto");
const k = createPrivateKey(process.env.STREET_PLUGIN_SIGNING_KEY);
console.log("type:", k.asymmetricKeyType);              // ed25519
process.stdout.write(createPublicKey(k).export({ type: "spki", format: "pem" }).toString());
'
```

> The SPKI PEM this prints must be **byte-identical** to
> `street-signing-2026.pub.pem`. That same PEM goes into `official-key.ts`
> (step 3) and is what `manifest.pub` will contain after re-signing.

> **Optional, stronger:** generate/store the key in a KMS/HSM or via Sigstore
> keyless signing instead of a file (see `SECURITY-AUDIT.md` §9, long-term 11).
> The file-based flow above is the minimum viable rotation.

---

## 2. Store the private key as a CI secret (and back it up)

Use the new public key's fingerprint from 1c to label your backup.

**GitHub Actions secret** (repo or org level). Either via UI
(Settings → Secrets and variables → Actions → `STREET_PLUGIN_SIGNING_KEY`) or CLI:

```bash
# From ~/keys — paste the WHOLE PEM, including BEGIN/END lines and trailing newline.
gh secret set STREET_PLUGIN_SIGNING_KEY < street-signing-2026.key.pem
# For an org-wide secret: gh secret set STREET_PLUGIN_SIGNING_KEY --org <org> --visibility selected --repos <repo>
```

**Offline backup:** store `street-signing-2026.key.pem` in a secrets manager
(1Password, Vault, AWS/GCP Secrets Manager). Then remove the on-disk copy when
done, or keep it only in the locked `~/keys` dir — **never** in the project tree.

> ⚠️ Do **not** reuse the leaked `df5e2726…` key or the ad-hoc on-disk
> `street-signing.key.pem` (`7de6474b…`) as the new secret. Both are now
> distrusted.

---

## 3. Update the embedded trust anchor (core code — maintainer edits)  ✅ DONE

> **Completed.** `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` now embeds the new key
> (`3ae9add0…`), verified to equal the public half of the signing key, and core
> was rebuilt. A mismatched key (`125d1c32…`, matching neither the private key
> nor `keys/*.pub.pem`) was caught and corrected during this step — always
> confirm the fingerprint check below matches `<NEW_FINGERPRINT>`.

Replace the public key in `packages/core/src/platform/plugins/official-key.ts`
with the **new SPKI PEM** from step 1b. Only the PEM literal changes:

```diff
 /** PEM (SPKI) of the official StreetJS plugin-signing public key. */
 export const OFFICIAL_PLUGIN_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
-MCowBQYDK2VwAyEA4IqlSB2iIgXeWGpZKxNJNpNbR3vwgzQJslrDe6fckW4=
+<paste the base64 body of street-signing-2026.pub.pem here>
 -----END PUBLIC KEY-----
 `;
```

Verify the file still parses and matches your new key:

```bash
node -e '
const { createPublicKey } = require("node:crypto");
const { execSync } = require("node:child_process");
const src = require("fs").readFileSync("packages/core/src/platform/plugins/official-key.ts","utf8");
const pem = src.split("`")[1];                       // the template literal
const der = createPublicKey(pem).export({ type: "spki", format: "der" });
console.log(require("crypto").createHash("sha256").update(der).digest("hex"));
'
# => must equal <NEW_FINGERPRINT> from step 1c
```

Rebuild core so the new anchor is in `dist`:

```bash
npm run build -w packages/core
```

---

## 4. Re-sign all 21 plugins under the new key (in CI)

The cleanest path is the existing `publish-plugins.yml`, which signs every plugin
from the secret and verifies each manifest against `officialPluginPublicKey()`.
After steps 2–3 are merged, trigger it so all 21 committed manifests move to the
new anchor:

```bash
# Triggers the full matrix (all 21 plugins): build → sign → publish (idempotent) → verify.
gh workflow run publish-plugins.yml
# Watch it:
gh run watch "$(gh run list --workflow=publish-plugins.yml -L1 --json databaseId -q '.[0].databaseId')"
```

For each plugin the workflow's **"Verify packed manifest is officially signed"**
step must pass — that is your proof the new key signed it and the new anchor
trusts it.

> **Committing the regenerated manifests:** `main` is protected and the signing
> workflows don't push. To refresh the committed `manifest.signed.json` /
> `manifest.pub` for each plugin, either (a) download the workflow artifacts and
> commit them through a normal PR, or (b) run the local re-sign below on a branch
> with the secret exported, then PR the diff:

```bash
# Local re-sign of every plugin (branch + PR; secret exported in THIS shell only).
export STREET_PLUGIN_SIGNING_KEY="$(cat ~/keys/street-signing-2026.key.pem)"
npm run build -w packages/core
for p in packages/plugin-*; do
  name="${p#packages/}"
  npm run build -w "$p" && npm run sign -w "$p"
done
unset STREET_PLUGIN_SIGNING_KEY            # don't leave the key in the environment
```

Confirm **all 21** `manifest.pub` files now match the new anchor:

```bash
NEW=<NEW_FINGERPRINT>
for f in packages/plugin-*/manifest.pub; do
  fp=$(openssl pkey -pubin -in "$f" -outform DER | sha256sum | cut -d' ' -f1)
  [ "$fp" = "$NEW" ] && echo "OK   $f" || echo "FAIL $f ($fp)"
done
# Every line should read OK.
```

---

## 5. Correct `.gitleaks.toml` (F-2)

The current allowlist comment claims the leaked key is "NOT the production key"
and "purged from history" — both false. Remove the false comment **and** the path
allowlist that hides the key, and add an explicit private-key rule
(`SECURITY-AUDIT.md` §8.1):

```diff
 paths = [
   '''\.env$''',
   '''\.env\.example$''',
   '''(^|/)dist/''',
   '''(^|/)docs/''',
   '''.*/tests/.*\.test\.(ts|js)$''',
   '''.*/examples/.*''',
   '''packages/.*/example/.*''',
-  # Retired local/dev signing keypair accidentally committed once (commit
-  # d7bbfc40, 2026-06-14), then removed and gitignored. This is NOT the
-  # production signing key — the publish pipeline signs from the
-  # STREET_PLUGIN_SIGNING_KEY GitHub secret, and this file is referenced by no
-  # workflow or signing script. The blob is also purged from history; this path
-  # allowlist is defense-in-depth so the historical commit can't fail the scan.
-  '''(^|/)street-signing\.(key|pub)\.pem$''',
 ]
```

```toml
# Append a hard rule so any PEM private key fails the scan:
[[rules]]
id = "pem-private-key-block"
description = "PEM private key material must never be committed"
regex = '''-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP |ENCRYPTED )?PRIVATE KEY-----'''
keywords = ["PRIVATE KEY"]
```

> Note: with the path allowlist removed, gitleaks **will** now flag the historical
> `d7bbfc40` blob — which is correct and expected until step 7 purges it. Run a
> working-tree-only scan in the meantime: `gitleaks detect --no-git`.

---

## 6. Publish a Security Advisory + changelog (revoke trust in the old key)

Downstream consumers must learn to **distrust `df5e2726…`** and trust the new key.

- Open a GitHub Security Advisory describing the exposure and the new key
  fingerprint (`<NEW_FINGERPRINT>`).
- Add a `CHANGELOG.md` entry and bump the affected packages so consumers pull
  versions signed by the new anchor.
- Anyone pinning the old public key out-of-band must update it.

---

## 7. Purge the key from history (after rotation, not before)

Rotation (steps 1–4) neutralizes the exposure; purging removes the blob so it
stops being trivially fetched. This **rewrites history** and requires a
coordinated force-push — **all collaborators must re-clone afterward**. Do this
last, with the team informed.

```bash
# Use a FRESH clone as a workspace for the rewrite.
git clone --mirror git@github.com:<org>/streetJS.git streetJS-rewrite.git
cd streetJS-rewrite.git

# Preferred: git-filter-repo (install separately).
git filter-repo --invert-paths \
  --path street-signing.key.pem \
  --path street-signing.pub.pem

# Push the rewritten history (DESTRUCTIVE — coordinate first).
git push --force --mirror
```

> ⚠️ **High-risk, irreversible for collaborators.** After the force-push:
> - every clone/fork is now divergent and must be re-cloned;
> - open PRs may need rebasing/reopening;
> - CI caches and existing forks **still contain the blob** — this is exactly why
>   rotation (step 1) is mandatory and purging alone is insufficient.
>
> Get explicit sign-off before running the force-push. If you use BFG instead:
> `bfg --delete-files 'street-signing.{key,pub}.pem'` then
> `git reflog expire --expire=now --all && git gc --prune=now --aggressive`.

---

## 8. Move on-disk keys out of the repo directory (F-4, F-5)

```bash
# These are gitignored but still inside the tree — one `git add -f` from re-exposure.
mv street-signing.key.pem ~/keys/LEAKED-do-not-use.key.pem            # quarantine/destroy
mv packages/plugin-marzpay/signing-key.pkcs8.pem ~/keys/old-marzpay.key.pem
```

Treat both as compromised/retired; do not reuse either as the new secret.

---

## 9. Add a CI gate so this can't recur (F-6)

Add the `block-private-keys` job from `SECURITY-AUDIT.md` §8.2 (fails the build on
any tracked `*.pem/*.key/*.p12/*.pfx` or `BEGIN PRIVATE KEY` blob), and optionally
the pre-commit hook in §8.3. Also add a check that every committed `manifest.pub`
matches the embedded anchor (the loop in step 4) so a future key drift fails CI.

---

## 10. Final verification checklist

- [ ] New keypair generated; `<NEW_FINGERPRINT>` ≠ `df5e2726…` and ≠ `7de6474b…`.
- [ ] `STREET_PLUGIN_SIGNING_KEY` secret updated to the new private key; backed up offline.
- [ ] `official-key.ts` embeds the new SPKI PEM; core rebuilds; fingerprint check matches.
- [ ] All 21 `manifest.pub` files match `<NEW_FINGERPRINT>` (step 4 loop all `OK`).
- [ ] `publish-plugins.yml` green, including every "Verify packed manifest is officially signed".
- [ ] `.gitleaks.toml` false comment + path allowlist removed; private-key rule added.
- [ ] Security Advisory + changelog published; old key fingerprint marked distrusted.
- [ ] History purged and force-pushed **with team coordination**; everyone re-cloned.
- [ ] On-disk keys quarantined out of the tree.
- [ ] CI `block-private-keys` gate + manifest/anchor consistency check added.

When all boxes are checked, re-run the audit to confirm the projected **~88/100**
posture (`SECURITY-AUDIT.md` §2).

---

*This runbook is documentation. Executing it — generating keys, setting secrets,
editing core code, publishing, and rewriting history — is a maintainer action to
be performed in an authenticated environment with team coordination.*
