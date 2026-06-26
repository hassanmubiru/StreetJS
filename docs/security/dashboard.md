---
layout:    default
title:     "Security Dashboard"
parent:    "Security"
nav_order: 9
permalink: /security/dashboard/
description: "Live security posture for StreetJS — OpenSSF Scorecard, CodeQL, CI, supply-chain, secret scanning, and signing — with links to the canonical evidence."
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Security</span>
<h1>Security Dashboard</h1>
<p>A single status surface for the StreetJS security posture. Live badges below
reflect the latest CI / scanner state; the table links each control to its
canonical evidence.</p>
</div>

> This page is a **status surface**, not a policy document. The authoritative
> public security page is the
> [Trust Center](https://github.com/hassanmubiru/StreetJS/blob/main/security/TRUST-CENTER.md);
> scoring methodology lives in
> [audits/SCORING-METHODOLOGY.md](https://github.com/hassanmubiru/StreetJS/blob/main/audits/SCORING-METHODOLOGY.md)
> and the OpenSSF review in
> [audits/OPENSSF-REVIEW.md](https://github.com/hassanmubiru/StreetJS/blob/main/audits/OPENSSF-REVIEW.md).

---

## Live badges

[![CI](https://github.com/hassanmubiru/StreetJS/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/hassanmubiru/StreetJS/actions/workflows/ci-cd.yml)
[![CodeQL](https://github.com/hassanmubiru/StreetJS/actions/workflows/codeql.yml/badge.svg)](https://github.com/hassanmubiru/StreetJS/actions/workflows/codeql.yml)
[![OpenSSF Scorecard](https://api.securityscorecards.dev/projects/github.com/hassanmubiru/StreetJS/badge)](https://securityscorecards.dev/viewer/?uri=github.com/hassanmubiru/StreetJS)
[![npm provenance](https://img.shields.io/badge/npm-provenance-2563EB?logo=npm)](https://www.npmjs.com/package/streetjs)

The badges above are rendered live by their providers — they always show the
**current** state, not a snapshot baked into this page.

---

## Control posture

Each row links to the workflow that enforces the control and the canonical
document that describes it. "Live status" items can only be confirmed from the
GitHub Security tab or the provider badge above — they are marked **UNVERIFIED**
here because a static page cannot assert a runtime value without fabricating it.

| Control | Enforced by | Evidence / canonical doc | Live status |
|---|---|---|---|
| Static analysis (SAST) | [`codeql.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/codeql.yml) | [Code scanning alerts](https://github.com/hassanmubiru/StreetJS/security/code-scanning) | Badge above |
| Secret scanning + push protection | GitHub setting + [`secret-scan.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/secret-scan.yml), [`.gitleaks.toml`](https://github.com/hassanmubiru/StreetJS/blob/main/.gitleaks.toml) | [Secret scanning alerts](https://github.com/hassanmubiru/StreetJS/security/secret-scanning) · [SECRET-SCANNING-GUIDE.md](https://github.com/hassanmubiru/StreetJS/blob/main/security/SECRET-SCANNING-GUIDE.md) | UNVERIFIED (operator setting) |
| Private-key block (pre-merge) | [`block-private-keys.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/block-private-keys.yml), [`secrets-guard` in `ci-cd.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/ci-cd.yml) | [KEY-ROTATION-RUNBOOK.md](https://github.com/hassanmubiru/StreetJS/blob/main/security/KEY-ROTATION-RUNBOOK.md) | CI-enforced |
| Plugin signature + anchor verification | [`verify-signatures.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/verify-signatures.yml) (`npm run verify:signatures`) + `verify-signing-anchor` | [PLUGIN-SECURITY-STANDARD.md](https://github.com/hassanmubiru/StreetJS/blob/main/security/PLUGIN-SECURITY-STANDARD.md) | 21/21 manifests verify |
| Supply-chain provenance (npm) | publish gate in [`ci-cd.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/ci-cd.yml) (`--provenance` + attestation check) | [SLSA-ASSESSMENT.md](https://github.com/hassanmubiru/StreetJS/blob/main/security/SLSA-ASSESSMENT.md) | Per-release |
| Signed GitHub releases (cosign keyless) | release job in [`ci-cd.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/ci-cd.yml) | [NPM-PUBLISH-SECURITY-REVIEW.md](https://github.com/hassanmubiru/StreetJS/blob/main/security/NPM-PUBLISH-SECURITY-REVIEW.md) | Per-release |
| Dependency review / Dependabot | [`dependency-review.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/dependency-review.yml), [`dependabot.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/dependabot.yml) | [Dependabot alerts](https://github.com/hassanmubiru/StreetJS/security/dependabot) | UNVERIFIED (live count) |
| OpenSSF Scorecard | [`scorecard.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/scorecard.yml) | [audits/OPENSSF-REVIEW.md](https://github.com/hassanmubiru/StreetJS/blob/main/audits/OPENSSF-REVIEW.md) | Badge above (live score) |
| DAST | [`dast.yml`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/dast.yml) | [docs/dast]({{ '/dast/' | relative_url }}) | Scheduled |
| Branch protection / required reviews | [`repository-settings.json`](https://github.com/hassanmubiru/StreetJS/blob/main/.github/repository-settings.json) (settings-as-code) | [BRANCH-PROTECTION-REVIEW.md](https://github.com/hassanmubiru/StreetJS/blob/main/security/BRANCH-PROTECTION-REVIEW.md) | UNVERIFIED (operator setting) |

---

## Reporting a vulnerability

See [`SECURITY.md`](https://github.com/hassanmubiru/StreetJS/blob/main/SECURITY.md)
for the coordinated-disclosure process and contact. Do **not** open a public
issue for a suspected vulnerability.

---

## How to read this dashboard

- **Badge above** — the provider renders the current state in real time.
- **CI-enforced / Per-release / Scheduled** — the control runs automatically in
  the linked workflow; consult the run history for the latest result.
- **UNVERIFIED (operator setting / live count)** — the value depends on a GitHub
  platform setting or a live alert count that a static page must not assert.
  Follow the linked Security-tab URL for the authoritative current value.
