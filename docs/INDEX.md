# StreetJS Documentation Index

> **Purpose:** one-stop navigation for the StreetJS repository — everything
> discoverable in ≤ 2 clicks.
> **Audience:** contributors, adopters, maintainers, security reviewers.
> **Status:** Active · **Last Updated:** 2026-06 · **Related:** `README.md`, `audits/REPORT-INDEX.md`.

## Start here
| I want to… | Go to |
|---|---|
| Understand the project | [`README.md`](../README.md) |
| Read the enterprise audit (canonical) | [`audits/ENTERPRISE-AUDIT.md`](../audits/ENTERPRISE-AUDIT.md) |
| Report a vulnerability | [`SECURITY.md`](../SECURITY.md) |
| See the security trust page | [`security/TRUST-CENTER.md`](../security/TRUST-CENTER.md) |
| Contribute | [`CONTRIBUTING.md`](../CONTRIBUTING.md), [`governance/CONTRIBUTOR-GOVERNANCE.md`](../governance/CONTRIBUTOR-GOVERNANCE.md) |
| See what's outstanding | [`plans/OUTSTANDING-ACTIONS.md`](../plans/OUTSTANDING-ACTIONS.md) |

## Architecture & usage
- Framework docs: [`docs/`](./) (reference, guides, tutorials)
- Packages: [`packages/`](../packages/) — core, cli, 21 official plugins, frontends
- Examples: [`examples/`](../examples/) (incl. `scaffold-*`, `marzpay-*`)
- Demos: [`demos/`](../demos/) · RFCs: [`rfcs/`](../rfcs/)

## Security  ([`security/`](../security/))
| Topic | Canonical doc |
|---|---|
| Trust center (public) | `TRUST-CENTER.md` |
| Security audit | `SECURITY-AUDIT.md` |
| Threat model | `THREAT-MODEL-2026.md` |
| Security roadmap | `SECURITY-ROADMAP.md` |
| Classification | `SECURITY-CLASSIFICATION.md` |
| Plugin security | `PLUGIN-SECURITY-AUDIT.md`, `PLUGIN-SECURITY-STANDARD.md` |
| Key rotation / incident | `KEY-ROTATION-RUNBOOK.md`, `KEY-ROTATION-CHECKLIST.md`, `KEY-EMERGENCY-RUNBOOK.md` |
| Secret scanning | `SECRET-SCANNING-GUIDE.md` |
| Compliance | `SLSA-ASSESSMENT.md`, `NIST-SSDF-MAPPING.md`, `OWASP-ASVS-MAPPING.md` |
| Historical | [`security/archive/`](../security/archive/) |

## Governance  ([`governance/`](../governance/))
`CHARTER.md` · `REPOSITORY-ORGANIZATION.md` · `RELEASE-POLICY.md` · `CONTRIBUTOR-GOVERNANCE.md`
(+ root `GOVERNANCE.md`, `MAINTAINERS.md`, `CODE_OF_CONDUCT.md`)

## Audits  ([`audits/`](../audits/))
Canonical: `ENTERPRISE-AUDIT.md` · Index/classification: `REPORT-INDEX.md`
Companions: `OPENSSF-REVIEW.md`, `DOCKER-REVIEW.md`, `PLUGIN-SECURITY-REPORT.md`,
`PLUGIN-MATURITY-MATRIX.md`, `REPOSITORY-METRICS.md`, `SCORING-METHODOLOGY.md`,
`ENTERPRISE-READINESS-2026.md`, `PHASE-20-FINAL-REPORT.md`
Historical: [`audits/archive/`](../audits/archive/)

## Plans  ([`plans/`](../plans/))
`OUTSTANDING-ACTIONS.md` (register) · `REPOSITORY-CLEANUP-PLAN.md` · strategy/roadmap docs
Historical: [`plans/archive/`](../plans/archive/)

## Infrastructure  ([`infra/`](../infra/))
`docker/` (+ `compose/`) · `kubernetes/` · `helm/` · `examples/` · `monitoring/` — see [`infra/README.md`](../infra/README.md)

## CI & policy  ([`.github/`](../.github/))
Workflows (CI, CodeQL, Scorecard, secret-scan, publish, repository-policy, security-baseline,
block-private-keys) · `CODEOWNERS` · `dependabot.yml` · `repository-settings.json`
