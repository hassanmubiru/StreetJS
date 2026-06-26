# StreetJS Plugin-Signing Key Rotation Checklist

> Operator checklist for routine rotation of the official plugin-signing key.
> Full procedure + commands: `security/KEY-ROTATION-RUNBOOK.md`. Emergency
> (compromise) path: `security/KEY-EMERGENCY-RUNBOOK.md`.

## Pre-flight
- [ ] Maintainer with repo admin + npm publish rights available.
- [ ] Up-to-date `main`; CI green.
- [ ] Decide new key storage (GitHub secret + offline backup / KMS).

## Rotate
- [ ] Generate new Ed25519 keypair **outside** the repo tree (`openssl genpkey -algorithm ed25519 …`).
- [ ] Record new public key DER-SHA256 fingerprint; confirm it differs from the current anchor.
- [ ] Store private key as `STREET_PLUGIN_SIGNING_KEY` GitHub secret + offline backup.
- [ ] Update `OFFICIAL_PLUGIN_PUBLIC_KEY_PEM` in `packages/core/src/platform/plugins/official-key.ts`.
- [ ] `npm run build -w packages/core`; confirm embedded anchor fingerprint == new key.

## Re-sign & verify
- [ ] Re-sign all 21 plugins in CI (`publish-plugins.yml`) or locally with the new key.
- [ ] `npm run verify:signatures` → all 21 match the new anchor.
- [ ] Commit regenerated `manifest.signed.json` + `manifest.pub` for all plugins.

## Publish & announce
- [ ] Publish new signed releases (provenance on).
- [ ] Publish GitHub Security Advisory + changelog noting the new key fingerprint.
- [ ] Distrust the old public key with downstream consumers.

## Verify & clean up
- [ ] CI `verify-signing-anchor` + `security-baseline` green.
- [ ] Remove the new private key from any workstation; keep only in secret store.
- [ ] Update `security/TRUST-CENTER.md` anchor fingerprint.

## Cadence
- [ ] Schedule next rotation (recommended ≤ 12 months) and record the date.
