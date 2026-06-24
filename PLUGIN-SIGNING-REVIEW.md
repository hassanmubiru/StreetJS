# StreetJS Plugin Signing & Marketplace Security Review — 2026

> Adversarial review of the StreetJS plugin **signing infrastructure**, the **plugin host** trust model, and the **marketplace/registry** install path. Source-verified; companion to `SECURITY-AUDIT-2026.md`. Each finding carries exploit path · impact · likelihood · remediation · effort.

## Scope & evidence

- `packages/core/src/platform/plugins/host.ts` — `PluginHost.register/enable`, `pluginManifestSchema`, `canonicalManifest`, `manifestChecksum`, `signManifest`, `verifyManifest`, `deepFreeze`.
- `packages/core/src/platform/plugins/official-key.ts` — embedded official public key.
- `packages/core/src/platform/plugins/registry.ts` — consumer `PluginInstaller` (fetch → verify → extract).
- `packages/core/src/platform/plugins/local-registry.ts` — `installThroughRegistry`, `LocalPluginRegistry`.
- `packages/registry-server/src/*` — server-side publish/download/verify.
- Sign scripts (`packages/plugin-*/scripts/sign*.mjs`) and CI (`.github/workflows/{sign-htmx,publish-plugins}.yml`).

## Trust chain (as built)

```
 author → signManifest(privKey)         Ed25519 over SHA-256(canonical body)
        → registry-server.publish        verify(signature, publisher pubKey) + checksum + authn/authz   [fail-closed]
        → consumer install
             • installThroughRegistry     requires host.verifiesSignatures()  [fail-closed]
             • PluginInstoller (raw)       verify ONLY if publicKey set; extract tarball  [DEFAULT-OPEN + zip-slip]
        → PluginHost.register             verify ONLY if publicKey set; deep-freeze + store  [opt-in]
        → enable                          permission grant-gate (declarative; not a sandbox)
```

## Strengths (verified — do not regress these)

- **S1 — Complete signed body.** `canonicalManifest` serializes `name`, `version`, `capabilities` (sorted), `permissions` (sorted), `dependencies` (key-sorted). All privilege-relevant fields are inside the signature; only `checksum`/`signature` are excluded.
- **S2 — Sound checksum↔signature binding.** `verifyManifest` recomputes `expected = manifestChecksum(m)` and verifies the Ed25519 signature over `expected` (not the attacker-supplied `m.checksum`); it also rejects a body/checksum mismatch. A valid-signature/swapped-body forgery cannot pass. `cryptoVerify(null, …)` derives the algorithm from the Ed25519 key (no algorithm confusion).
- **S3 — Private key never on workstations.** `scripts/sign*.mjs` abort if `STREET_PLUGIN_SIGNING_KEY` is unset ("refusing to sign with an ephemeral key"); signing is `prepublishOnly`/CI-only.
- **S4 — Pinned key + CI provenance.** `official-key.ts` embeds the SPKI PEM; `publish-plugins.yml` re-verifies the **packed** manifest against `officialPluginPublicKey()` and publishes with npm `--provenance`. Signatures ship as a committed `manifest.signed.json` + `manifest.pub` (in `package.json#files`).
- **S5 — Fail-closed publish pipeline.** `registry-server` verifies signature + checksum **before** `store.put`, validates metadata, enforces bearer authn + namespace authz, rejects duplicates, records the tarball SHA-256, and leaves the store untouched on any rejection.
- **S6 — TOCTOU closed.** `register()` stores `deepFreeze(structuredClone(manifest))` and verifies the same frozen clone; caller mutation post-register is inert.
- **S7 — Registry-mediated install fail-closed.** `installThroughRegistry` refuses unless `host.verifiesSignatures()` and re-verifies the fetched record before `register()`.

---

## Findings

### PS-1 — Zip-slip path traversal in `PluginInstaller._extractTarball` → arbitrary file write → RCE — CRITICAL
- **Affected:** `packages/core/src/platform/plugins/registry.ts` — `_extractTarball()`.
- **Evidence:** Per-entry destination is `path.join(destDir, name.replace(/^\.\//,'').replace(/^\//,''))` followed by `fs.writeFile`/`fs.mkdir`. It strips only a single leading `./` and `/`; there is **no `..` containment check**, and absolute paths / symlink/hardlink type-flags (`1`/`2`) are not rejected.
- **Exploit path:** A registry response (malicious, compromised, or MITM'd in a misconfigured endpoint) includes a tarball entry named `../../../../home/<user>/.bashrc` (or `~/.npmrc`, a cron/systemd path). `_extractTarball` joins it onto `destDir` and writes attacker bytes outside the plugins directory.
- **Impact:** Arbitrary file overwrite → code execution / persistence (RCE). Combined with PS-2, reachable with no signature.
- **Likelihood:** Medium — deterministic once the marketplace installer is used.
- **Remediation:** Compute `const resolved = path.resolve(destDir, sanitized)` and assert `resolved === destRoot || resolved.startsWith(destRoot + path.sep)` (with `destRoot = path.resolve(destDir)`); reject entries containing `..` segments, absolute paths, and link type-flags. Pure `node:path`.
- **Effort:** Low.

### PS-2 — Consumer `PluginInstaller` is default-open; integrity check is registry-self-referential — HIGH
- **Affected:** `registry.ts` — `install()`, `_fetchManifest()`.
- **Evidence:** Signature is checked only `if (this.publicKey)` (`publicKey` optional, unset by default). The checksum gate compares the downloaded tarball's SHA-256 to `manifest.checksum`, but **both come from the same untrusted registry response** — a self-referential check the attacker satisfies trivially. `_fetchManifest` does `JSON.parse(body) as PluginManifest` with no schema validation.
- **Exploit path:** `new PluginInstaller({ pluginsDir })` (no `publicKey`) → malicious registry returns manifest + matching tarball → checksum passes → extraction (→ PS-1).
- **Impact:** Arbitrary plugin code installation (RCE with PS-1).
- **Likelihood:** Medium–High (no default key; nothing forces one).
- **Remediation:** Default `publicKey` to `officialPluginPublicKey()`; remove the `if (this.publicKey)` opt-out behind an explicit `allowUnsigned: true`; validate the fetched manifest against `pluginManifestSchema`; reject responses without a signature; pin `https:` for `registryUrl`/`tarballUrl`.
- **Effort:** Low.

### PS-3 (host) — Bare `PluginHost.register()` is default-open — MEDIUM
- **Affected:** `host.ts` — constructor `this.publicKey = opts.publicKey`; `register()` `if (this.publicKey && !verifyManifest(frozen, this.publicKey))`.
- **Evidence:** With no key, the verification branch is skipped and `register()` accepts unsigned/tampered manifests. The marketplace path (`installThroughRegistry`) is fail-closed, but the raw host API is opt-in.
- **Exploit path:** Integrator calls `new PluginHost({ grantedPermissions: '*' })` without a key → any unsigned manifest registers + enables (runs `onInstall`/`onLoad`).
- **Impact:** Arbitrary unsigned-plugin execution within granted permissions. **Likelihood:** Medium (misconfiguration).
- **Remediation:** Default `publicKey` to `officialPluginPublicKey()` unless the caller opts into `allowUnsigned: true`; **fail closed when a manifest carries a `signature`/`checksum` that cannot be verified** even if no key is configured; warn on startup when verification is disabled.
- **Effort:** Low.

### PS-4 — Single signing key, no `keyId`/rotation/revocation — MEDIUM
- **Affected:** `official-key.ts` (single embedded key), `host.ts` (manifest has no `keyId`/`alg`), `signManifest`/`verifyManifest`.
- **Exploit path / impact:** If `STREET_PLUGIN_SIGNING_KEY` leaks, an attacker can sign manifests that pass `officialPluginPublicKey()` until a new core version (new embedded key) is published **and adopted by every consumer**; deployed hosts cannot revoke the old key.
- **Likelihood:** Low (CI-secret only). **Impact:** Ecosystem-wide blast radius on leak.
- **Remediation:** Add an optional `keyId` to the canonical body; let the host hold a **set** of trusted keys (overlap/rotation/revocation without an API break); document a rotation runbook; evaluate Sigstore keyless plugin signing.
- **Effort:** Medium.

### PS-5 — Non-strict manifest schema can drift from the signed body — MEDIUM
- **Affected:** `host.ts` — `pluginManifestSchema` (non-strict) vs. fixed-key `canonicalManifest`.
- **Evidence:** All currently-defined security fields are signed (strength), but the schema tolerates unknown keys while `canonicalManifest` is fixed. A future security-relevant field added to the manifest but not to `canonicalManifest` would be **unsigned and tamperable**.
- **Impact:** Latent signature-coverage gap. **Likelihood:** Low.
- **Remediation:** Make the schema `.strict()` or derive the canonical body from the schema's known keys; add a regression test asserting every signed field (except `checksum`/`signature`) appears in the canonical body.
- **Effort:** Low.

### PS-6 — `registry-server` trusts publisher-supplied public key — INFORMATIONAL
- **Affected:** `packages/registry-server/src/registry.ts` — `publish()` does `createPublicKey(req.publicKeyPem)` then `verifyManifest(manifest, publicKey)`; `download()`/`verify()` return/use that stored key.
- **Note:** By design, server trust is bound to bearer authn + namespace authz, and the manifest is verified against the **publisher's own** key — a reasonable model. The risk is a **consumer** that pins the registry-echoed `publicKeyPem` instead of an out-of-band key, gaining no authenticity guarantee.
- **Remediation:** Document that consumers must pin `officialPluginPublicKey()` (or a known publisher key), never the key returned by `download`; optionally cross-check known-publisher keys server-side.
- **Effort:** Low.

---

## Remediation summary

| Finding | Severity | Fix | Effort |
|---|---|---|---|
| PS-1 | CRITICAL | `..`/abs/symlink containment in tar extraction | Low |
| PS-2 | HIGH | Mandatory installer signature + manifest schema + https pin | Low |
| PS-3 | MEDIUM | Default host to official key; fail-closed on unverifiable signature | Low |
| PS-4 | MEDIUM | `keyId` + trusted-key set + rotation runbook | Medium |
| PS-5 | MEDIUM | `.strict()` schema / derive canonical body from schema + test | Low |
| PS-6 | INFO | Document consumer key-pinning | Low |

**Guardrails:** all fixes use `node:crypto`/`node:path` only — no new runtime dependency. Do not regress strengths S1–S7. The two highest-ROI items (PS-1, PS-2) are Low-effort and together close the unauthenticated-registry → RCE chain that is the most severe issue in the 2026 model.
