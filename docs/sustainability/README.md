---
layout: default
title: Sustainability
nav_order: 60
description: "StreetJS sustainability: funding strategy, maintainer health, and bus-factor mitigation."
---

# Open Source Sustainability

A plan for StreetJS to remain healthy independent of any single person.

## Funding strategy

| Channel | Purpose | Status |
|---------|---------|--------|
| **GitHub Sponsors** | recurring individual/company sponsorship | `FUNDING.yml` present; enrollment pending |
| **Open Collective** | transparent expense ledger (infra, bounties) | to set up |
| **Consulting** | paid integration/migration help by maintainers | as demand appears |
| **Enterprise Support** | SLAs, priority fixes, advisory | offering to define |

Principle: funding pays for **maintenance capacity and infrastructure**, not
feature-for-pay that would distort the roadmap. Expenses are public (Open
Collective). Enterprise support is the primary path to fund dedicated maintainer
time.

## Maintainer health plan

Sustainable maintenance prevents burnout, which is the top risk to OSS longevity.

- **Review rotation:** a weekly "PR triage" owner so no one person is always
  on the hook; documented in the maintainer runbook.
- **Release rotation:** the release driver rotates among maintainers; the process
  is fully scripted (`docs/RELEASE_CHECKLIST.md` + provenance/SBOM gates) so any
  maintainer can cut a release.
- **Time off is normal:** maintainers may go inactive without guilt; emeritus
  status is explicit (see `docs/community/contributor-path.md`).
- **Scope discipline:** the RFC process and "no speculative features" norm keep
  the maintenance surface bounded.

## Bus-factor mitigation

Goal: **the project survives the loss of any single maintainer.**

- **Ownership distribution:** `CODEOWNERS` spreads area ownership; the Steering
  Committee (odd ≥3) holds no single point of decision authority.
- **Key management:** the plugin/release signing keys and npm/registry access are
  held by the org (not one individual); rotation procedure is documented; at
  least two people can perform a release.
- **Emergency procedures:** a documented runbook covers (1) revoking/rotating a
  compromised signing key or npm token, (2) granting emergency release access to
  a second maintainer, (3) shipping a security patch under coordinated disclosure.
- **Everything-as-code:** releases, signing, and verification are scripted and in
  CI, so institutional knowledge lives in the repo, not in one person's head.

## Health indicators (tracked in the adoption scorecard)

Bus factor (≥2 active release-capable maintainers), review latency, and release
cadence are tracked in `docs/adoption/adoption-scorecard.md`.
