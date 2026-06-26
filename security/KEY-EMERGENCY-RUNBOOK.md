# StreetJS Signing-Key Emergency Runbook

> For a **confirmed or suspected compromise** of the official plugin-signing key.
> Goal: revoke trust fast, re-establish a clean anchor, and remove exposure.
> Routine rotation: `security/KEY-ROTATION-CHECKLIST.md`. Commands: `KEY-ROTATION-RUNBOOK.md`.

## 0. Declare incident (first 1 hour)
- [ ] Open a private security incident; assign an incident lead.
- [ ] Treat the key as **fully compromised** — assume forgeries are possible now.
- [ ] Freeze plugin publishing (disable `publish-plugins.yml` trigger).

## 1. Revoke (same day)
- [ ] Publish a **GitHub Security Advisory**: which key (fingerprint), since when,
      and "do not trust plugins signed by `<old fingerprint>`".
- [ ] If the npm token may be involved, **revoke the npm automation token** and rotate it.
- [ ] Notify downstream/enterprise consumers via the security contact channel.

## 2. Re-anchor (same day)
- [ ] Generate a NEW keypair (offline) → new `STREET_PLUGIN_SIGNING_KEY` secret.
- [ ] Update `official-key.ts` anchor; rebuild core; `npm run verify:signatures` against the new anchor.
- [ ] Re-sign + re-publish all 21 plugins in CI with provenance.
- [ ] Bump affected package versions; consumers must upgrade to versions signed by the new key.

## 3. Contain exposure
- [ ] If the key reached git history, run the **history purge** (`KEY-ROTATION-RUNBOOK.md` §7)
      on a mirror clone + coordinated force-push + team re-clone.
- [ ] Quarantine/destroy all on-disk copies of the compromised key.
- [ ] Rotate any other secret that shared the exposure path (CI logs, caches).

## 4. Verify
- [ ] `npm run verify:signatures` → 21/21 against the new anchor.
- [ ] `git log --all -- street-signing.key.pem` empty (post-purge).
- [ ] CI `secrets-guard` + `verify-signing-anchor` + `secret-scan` green.
- [ ] Advisory updated to "resolved" with the new fingerprint.

## 5. Recovery & post-mortem
- [ ] Re-enable publishing.
- [ ] Write a post-mortem (root cause, timeline, gaps) → `audits/`.
- [ ] Action items: move to keyless/KMS signing (SLSA L3), enforce dual-control releases.

## Rollback
- The pre-rewrite mirror clone is retained until the team confirms the purge; if the
  force-push causes breakage, restore by force-pushing the mirror back. Rotation
  (steps 2) is **not** rolled back — the old key stays distrusted permanently.
