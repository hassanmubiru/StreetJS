---
rfc: 0005
title: Keyless plugin signing (Sigstore/OIDC) — removing the long-lived key
status: Draft
authors: ["@hassanmubiru"]
created: 2026-07-11
tracking-issue:
---

# RFC 0005 — Keyless plugin signing (Sigstore/OIDC)

## Implementation status (2026-07-11)

**Verification tooling + the security-critical identity policy are implemented and
unit-tested; the producer wiring and live round-trip are operator/CI steps.**
- ✅ **Identity policy** (`scripts/security/keyless-identity.mjs`): the pinned signer
  identity (issuer `token.actions.githubusercontent.com` + the exact
  `publish-plugins.yml@refs/tags/plugins-v*` workflow), a pure `matchesIdentity`
  matcher, and `cosignVerifyArgs` builder. **Unit-tested 7/7**, including the decisive
  negatives — a valid Fulcio cert from a **different repo**, a **different workflow**,
  a **non-release ref**, and a **wrong issuer** are all rejected.
- ✅ **Verifier** (`scripts/security/verify-keyless.mjs`): delegates crypto to cosign
  `verify-blob` with the identity pins; honest-BLOCKED (exit 0) when cosign is absent.
- ⏳ **Operator/CI steps remaining (cannot be run/verified from a dev box — need the
  Actions OIDC context, and re-signing re-publishes official plugins):**
  1. Add a keyless-sign step to `publish-plugins.yml` (it already grants
     `id-token: write`) that emits a `manifest.cosign.bundle` per plugin alongside the
     existing Ed25519 `manifest.signed.json` (dual-anchor).
  2. Wire `verify-keyless.mjs` into `verify-signatures.yml` as an additional (then,
     after the transition, fatal) check.
  3. Re-publish official plugins so they carry keyless bundles; then retire the
     long-lived key once telemetry supports dropping the legacy anchor.
  These are deliberately **not** executed autonomously (they modify the certified
  publish pipeline and re-publish live packages).

## Summary

Migrate official `@streetjs/plugin-*` manifest signing from a long-lived ed25519
key to **keyless signing via Sigstore/OIDC** (Fulcio-issued short-lived certs +
Rekor transparency log), or a KMS/HSM-backed key as a fallback. This removes the
one long-lived secret in the supply chain and moves the project toward SLSA L3,
without changing what consumers install.

## Motivation

Today, plugin manifests (`manifest.signed.json`) are signed with a long-lived
ed25519 key held as the `STREET_PLUGIN_SIGNING_KEY` CI secret (public anchor
fingerprint `3ae9add0…`), verified by `npm run verify:signatures` /
`.github/workflows/verify-signatures.yml`. This works and is enforced, but:

- A long-lived signing key is the highest-value secret in the project; its
  compromise or mishandling (see the prior `ERR_OSSL_UNSUPPORTED` / clobbered-secret
  incident, OUTSTANDING-ACTIONS #29) is a standing risk.
- SLSA L3 and modern supply-chain expectations favor **short-lived, identity-bound**
  signing over long-lived keys.
- npm package publishing already carries SLSA provenance; plugin manifest signing is
  the remaining piece not yet keyless.

This is a **P3 / mid-term** item (Transition Report #12): valuable for enterprise
procurement and supply-chain leadership, not a defect.

## Guide-level explanation

Nothing changes for consumers of `street plugin install` / the registry: a plugin is
still verified before load. What changes is *how* the signature is produced and
verified.

- **Producing (CI, on publish):** the plugin's manifest digest is signed keyless via
  Sigstore using the workflow's OIDC identity — no key material on disk or in
  secrets. The resulting Sigstore bundle (cert + signature + Rekor inclusion proof)
  is attached to the manifest.
- **Verifying (install / CI / `verify:signatures`):** verification checks the
  Sigstore bundle: the signature, the Fulcio cert chain, the **expected workflow
  identity** (repo + workflow ref), and Rekor inclusion — instead of matching a
  fixed public-key fingerprint.

## Reference-level explanation

- **Signing identity policy:** pin the accepted OIDC identity to
  `https://github.com/hassanmubiru/StreetJS/.github/workflows/publish-plugins.yml@refs/tags/plugins-v*`
  (issuer `https://token.actions.githubusercontent.com`). Verification MUST reject
  any other identity.
- **Artifact format:** replace/augment `manifest.signed.json`'s key-signature block
  with a Sigstore bundle (`.sigstore`/bundle JSON). During transition, support
  **both** anchors (see Backward compatibility).
- **Producer:** `publish-plugins.yml` gains `id-token: write` permission and signs
  each manifest keyless (e.g. via `cosign sign-blob --yes --bundle` against the
  manifest digest, or the Sigstore JS SDK) — removing the
  `STREET_PLUGIN_SIGNING_KEY` secret dependency.
- **Verifier:** extend `scripts/verify-official-signatures.mjs` /
  `scripts/security/verify-release.mjs` to verify the Sigstore bundle + identity +
  Rekor proof. `verify-signatures.yml` stays a fatal gate.
- **Offline verification:** retain an offline path (bundled Rekor checkpoint / cached
  cert) so verification does not require network at install time, or document the
  network requirement explicitly.
- **KMS/HSM fallback:** if keyless proves impractical for some artifacts, a
  cloud-KMS-backed key (still short-lived-cert-wrapped where possible) is the
  fallback — the long-lived on-disk/secret key is removed either way.

## Backward compatibility

Consumer install/verify semantics are unchanged (a plugin is verified before use).
The on-wire signature format changes, so:

- **Dual-anchor transition window:** the verifier accepts EITHER the legacy ed25519
  anchor OR a valid Sigstore bundle, for one or more releases, so already-published
  plugins keep verifying while new ones move keyless.
- Once all official plugins are republished keyless and download telemetry supports
  it, drop legacy-key acceptance (a **2.0-era** cleanup) and retire the key.
- No public runtime API changes; this is packaging/CI + verification-tooling.

## Security considerations

- **Removes** the highest-value long-lived secret from the supply chain — the primary
  goal.
- **New trust roots:** Fulcio (cert issuance) + Rekor (transparency). Identity pinning
  is critical: verification must bind to the exact repo + workflow, or an attacker who
  can run *any* GitHub Actions workflow could obtain a Fulcio cert. This is the main
  new attack surface and must be tested.
- Transparency (Rekor) makes all signatures publicly auditable — a net positive.
- Threat model doc (`docs/security/…`) and `SLSA-ASSESSMENT.md` to be updated.

## Testing & verification

- Unit: identity-policy matcher accepts the pinned identity and **rejects** all
  others (including a valid Sigstore cert from a different repo/workflow).
- Integration: a real keyless sign→verify round trip in CI (the publish workflow
  signs; a separate job verifies bundle + identity + Rekor inclusion).
- Regression: `verify:signatures` remains green across the dual-anchor window on both
  legacy-signed and keyless-signed plugins.
- Negative: a tampered manifest and a wrong-identity bundle both FAIL the gate.
- "Done" = a plugin published by CI with no signing secret present, verified end to
  end by the fatal gate.

## Alternatives considered

- **Keep the long-lived ed25519 key:** status quo; rejected as the strategic direction
  (leaves the standing secret + caps SLSA level), though it remains the safe fallback
  if keyless blockers appear.
- **KMS/HSM only (no keyless):** removes on-disk key but keeps a long-lived identity
  and cloud-account dependency; acceptable fallback, less aligned with SLSA L3 than
  keyless.
- **Sigstore keyless (chosen):** best alignment with provenance already in use, no
  long-lived secret, public transparency.

## Unresolved questions

- Offline-install verification story (bundled Rekor checkpoint vs. documented network
  requirement).
- Exact bundle placement in the manifest and registry schema impact.
- Whether the framework release tarballs (already cosign-signed) should adopt the same
  identity-pinned keyless verification for symmetry.
- Operational: this depends on CI OIDC configuration and is partly an **operational
  dependency** (owner enables `id-token: write` + accepts the Sigstore trust model).
