# StreetJS — NIST SSDF (SP 800-218) Control Mapping

> Maps repository controls to the four NIST Secure Software Development Framework
> practice groups: **PO** (Prepare the Org), **PS** (Protect Software), **PW**
> (Produce Well-Secured Software), **RV** (Respond to Vulnerabilities).
> ✅ implemented · ◑ partial · ⬜ gap.

## PO — Prepare the Organization
| Practice | Status | Evidence |
|---|---|---|
| PO.1 Define security requirements | ✅ | `governance/CHARTER.md`, `security/SECURITY-CLASSIFICATION.md`, `PLUGIN-SECURITY-STANDARD.md` |
| PO.2 Roles & responsibilities | ◑ | `MAINTAINERS.md`, `CODEOWNERS` (single-owner — broaden) |
| PO.3 Supporting toolchains | ✅ | CI gates, gitleaks, CodeQL, Scorecard, Dependabot |
| PO.4 Define security check criteria | ✅ | `audits/SCORING-METHODOLOGY.md`, `repository-policy.yml` |
| PO.5 Secure dev environments | ◑ | hooks + CI gates; contributor env guidance in CONTRIBUTING |

## PS — Protect the Software
| PS.1 Protect code from unauthorized access | ✅ | branch model + CODEOWNERS (enforce via branch protection) |
| PS.2 Provide integrity verification | ✅ | signed plugin manifests + cosign release signing |
| PS.3 Archive & protect each release | ✅ | npm provenance + SBOM + tagged releases |

## PW — Produce Well-Secured Software
| PW.4 Reuse secure components | ✅ | dependency-free plugin design; Dependency Review |
| PW.5 Secure coding | ✅ | strict TS, no eval/exec/any in plugins (verified), input validation |
| PW.6 Build with hardened config | ✅ | least-privilege CI, pinned deps, distroless images |
| PW.7 Review/analyze code | ✅ | CodeQL SAST, zizmor workflow analysis, CODEOWNERS review |
| PW.8 Test executable code | ✅ | 355 test files, property-based tests, certification suites |
| PW.9 Secure default settings | ✅ | secure-by-default boot (CORS/secret requirements), fail-closed webhooks |

## RV — Respond to Vulnerabilities
| RV.1 Identify & confirm vulnerabilities | ✅ | Dependabot, secret scanning, private reporting (`SECURITY.md`) |
| RV.2 Assess, prioritize, remediate | ✅ | CVSS SLAs, GHSA/CVE process (`SECURITY.md`) |
| RV.3 Analyze root cause | ✅ | audits/runbooks (e.g. `KEY-ROTATION-RUNBOOK.md`) |

## Gaps → actions
- PO.2 ownership breadth → fill CODEOWNERS teams; grow MAINTAINERS.
- PS.1 enforcement → enable branch/push protection.
- Long-lived signing key → keyless/KMS (see `SLSA-ASSESSMENT.md`).
