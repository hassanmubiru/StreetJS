# StreetJS Audit & Report Index (Canonical Map)

> Resolves report sprawl: declares the **single canonical report** and classifies
> every audit/security/governance document as **Canonical**, **Active companion**
> (current, referenced for detail), **Historical** (point-in-time, immutable), or
> **Superseded** (archive candidate). Per the modernization brief: *merge overlapping,
> identify obsolete, recommend consolidation* — without deleting evidence.

## Canonical
- **`audits/STREETJS-MASTER-REPORT.md`** — the single authoritative enterprise audit
  (exec summary, metrics, organization, security, compliance, plugin/docker/supply-chain/
  docs/governance, scores, risk, outstanding actions, validation). **Start here.**

## Active companions (current — keep, referenced for depth)
| Doc | Role |
|---|---|
| `security/TRUST-CENTER.md` | Canonical public security page |
| `security/SECURITY-CLASSIFICATION.md` | Public/Internal/Confidential/Secret tiers |
| `security/{SLSA-ASSESSMENT,NIST-SSDF-MAPPING,OWASP-ASVS-MAPPING}.md` | Compliance mappings |
| `audits/{OPENSSF-REVIEW,SCORING-METHODOLOGY,REPOSITORY-METRICS}.md` | Reproducible scoring inputs |
| `audits/{DOCKER-REVIEW,PLUGIN-SECURITY-REPORT,PLUGIN-MATURITY-MATRIX}.md` | Domain reviews |
| `audits/ENTERPRISE-READINESS-2026.md` | Current readiness + framework benchmark |
| `audits/PHASE-20-FINAL-REPORT.md` | Latest phase deliverable record |
| `security/{KEY-ROTATION-RUNBOOK,KEY-ROTATION-CHECKLIST,KEY-EMERGENCY-RUNBOOK,SECRET-SCANNING-GUIDE}.md` | Operator runbooks |
| `security/{SECURITY-AUDIT,PLUGIN-SECURITY-AUDIT,PLUGIN-SECURITY-STANDARD,MARZPAY-SECURITY-REVIEW,SECRET-EXPOSURE-REPORT,BRANCH-PROTECTION-REVIEW,NPM-PUBLISH-SECURITY-REVIEW,INFRASTRUCTURE-SECURITY-REVIEW,THREAT-MODEL-2026,SECURITY-ROADMAP}.md` | Security detail |
| `governance/{CHARTER,REPOSITORY-ORGANIZATION,RELEASE-POLICY,CONTRIBUTOR-GOVERNANCE}.md` | Governance |
| `plans/{OUTSTANDING-ACTIONS,REPOSITORY-CLEANUP-PLAN}.md` | Action registers |

## Historical (point-in-time records — keep, do not edit)
`audits/PHASE-19-MASTER-AUDIT.md`*, `audits/SECURITY-AUDIT-2026.md`,
`audits/{ECOSYSTEM-PLUGINS-AUDIT,LANGUAGE-STATS-AUDIT,MARZPAY-INTEGRATION-REPORT,SHOWCASE-AUDIT,PHASE-18-AUDIT,REPO-ORGANIZATION-PLAN,REPOSITORY-HARDENING-REPORT}.md`,
`audits/ENTERPRISE-READINESS.md` (Phase 17), `audits/ENTERPRISE-READINESS-COMPARISON.md`,
`audits/STREETJS-FULL-AUDIT-REPORT.md` (14-phase detail behind the master report),
`security/{PHASE-19-MASTER-AUDIT,THREAT-MODEL-UPDATE,SECURITY-HARDENING-SPRINT,SECURITY-SCORECARD,PLUGIN-SIGNING-REVIEW,PAYMENTS-SECURITY-REVIEW,PRIVACY-POLICY-FOR-REPO}.md`.
<br>(*`PHASE-19-MASTER-AUDIT.md` lives under `security/`.)

## Superseded → archived
| Archived | Superseded by |
|---|---|
| `audits/archive/PHASE-20-COMPLETION-REPORT.md` | `audits/PHASE-20-FINAL-REPORT.md` |

## Consolidation recommendations (not yet executed — low value vs link churn)
- `plans/SECURITY-ROADMAP.md` (strategic) vs `security/SECURITY-ROADMAP.md` (execution P0–P3):
  keep both; the security/ one is authoritative for security execution (noted in its header).
- `audits/ENTERPRISE-READINESS{,-COMPARISON}.md` are folded into `ENTERPRISE-READINESS-2026.md`;
  retained as historical. Archive only if link references are updated first
  (`ENTERPRISE-READINESS.md` has ~13 inbound links — do not move without fixing them).
- `security/THREAT-MODEL-UPDATE.md` is folded into `THREAT-MODEL-2026.md` (addendum).

## Rule
New audit phases append to the **canonical master report** + the relevant domain
companion. Do not create new top-level "full report" docs — that is the sprawl this
index exists to prevent.
