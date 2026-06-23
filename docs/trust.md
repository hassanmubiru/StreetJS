---
layout:      default
title:       "Security & Trust Center"
nav_order:   15
permalink:   /trust/
description:  "StreetJS Security & Trust Center — supply-chain evidence: SBOM, npm provenance, OpenSSF Scorecard, CodeQL, signed plugins, threat model, security policy and governance."
---

<div class="doc-header" markdown="0">
<span class="dh-label">Trust</span>
<h1>Security &amp; Trust Center</h1>
<p>One place for the evidence enterprise teams need to evaluate StreetJS — supply-chain integrity, security posture, and governance. Every item below links to a verifiable artifact.</p>
</div>

StreetJS is built for teams that have to answer security questionnaires. The
framework ships with a native-driver, dependency-light core (3 runtime
dependencies) and a signed plugin model, and every release is produced with
provenance attestations and a software bill of materials.

## Supply-chain integrity

| Signal | What it proves | Where |
|--------|----------------|-------|
| **npm provenance** | Each published package is built from this repo by CI, with a signed attestation | [npm: streetjs](https://www.npmjs.com/package/streetjs) |
| **CycloneDX SBOM** | A per-release software bill of materials is generated and committed | [sbom.json](https://github.com/hassanmubiru/StreetJS/blob/main/sbom.json) · [generator](https://github.com/hassanmubiru/StreetJS/blob/main/scripts/generate-sbom.mjs) |
| **Cosign release signing** | Release blobs are keyless-signed with Sigstore (no long-lived key) | [ci-cd.yml](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/ci-cd.yml) |
| **OpenSSF Scorecard** | Automated supply-chain best-practice scoring | [Scorecard](https://securityscorecards.dev/viewer/?uri=github.com/hassanmubiru/StreetJS) · [workflow](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/scorecard.yml) |
| **CodeQL** | Static analysis on every push | [Code scanning](https://github.com/hassanmubiru/StreetJS/security/code-scanning) · [workflow](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/codeql.yml) |
| **Secret scanning** | CI fails on committed secrets (Gitleaks + TruffleHog) | [secret-scan.yml](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/secret-scan.yml) |
| **Dependency review** | PRs are blocked on high-severity dependency advisories | [dependency-review.yml](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/dependency-review.yml) |
| **DAST** | Dynamic application security testing in CI | [dast.yml](https://github.com/hassanmubiru/StreetJS/blob/main/.github/workflows/dast.yml) |
| **Signed plugins** | Ed25519-signed manifests verified by the plugin host before load | [Plugin system](/StreetJS/plugins/) |
| **3 runtime dependencies** | Minimal third-party attack surface (`reflect-metadata`, `ws`, `zod`) | [package.json](https://github.com/hassanmubiru/StreetJS/blob/main/packages/core/package.json) · [sbom.json](https://github.com/hassanmubiru/StreetJS/blob/main/sbom.json) |

## Security posture

- **Security policy & disclosure** — [SECURITY.md](https://github.com/hassanmubiru/StreetJS/security/policy)
- **Threat model** — documented attacker model and mitigations — [THREAT-MODEL.md](https://github.com/hassanmubiru/StreetJS/blob/main/docs/THREAT-MODEL.md)
- **Compliance control mappings** — feature-to-control mappings for SOC 2, HIPAA, GDPR, PCI-DSS (capabilities vs operator responsibilities) — [control-mappings.md](https://github.com/hassanmubiru/StreetJS/blob/main/docs/compliance/control-mappings.md)
- **Built-in protections** — JWT, AES-256-GCM sessions, scrypt vault, sliding-window
  rate limiting, XSS sanitizer, CSRF, CORS, CSP, parameterized queries, SCRAM-SHA-256
  database auth, bounded memory on every component.

## Governance & process

| Area | Document |
|------|----------|
| Project governance | [GOVERNANCE.md](https://github.com/hassanmubiru/StreetJS/blob/main/GOVERNANCE.md) |
| Contributing | [CONTRIBUTING.md](https://github.com/hassanmubiru/StreetJS/blob/main/CONTRIBUTING.md) |
| Code of conduct | [CODE_OF_CONDUCT.md](https://github.com/hassanmubiru/StreetJS/blob/main/CODE_OF_CONDUCT.md) |
| RFC process | [rfcs/](https://github.com/hassanmubiru/StreetJS/tree/main/rfcs) |
| Release process | Versioned, provenance-signed, lockstep-verified `v*.*.*` tags |
| Support windows | [LTS policy](/StreetJS/lts-policy/) · [Compatibility matrix](/StreetJS/compatibility/) |

## Enterprise adoption checklist

- [x] OSI-approved license (MIT)
- [x] SBOM available per release (CycloneDX)
- [x] Build provenance / attestations (npm)
- [x] Automated security scanning (CodeQL, OpenSSF)
- [x] Documented security disclosure policy
- [x] Self-hostable — no mandatory managed services or external calls
- [x] Audit-log primitives (see the SaaS starter)
- [x] Defined support windows ([LTS policy](/StreetJS/lts-policy/))

> All claims on this page are evidence-based and link to a verifiable artifact.
> Found a gap? Open a [security advisory](https://github.com/hassanmubiru/StreetJS/security/policy).
