# StreetJS Audit & Report Index (Canonical Map)

> Resolves report sprawl: declares the **single canonical report** and classifies
> every audit/security/governance document as **Canonical**, **Active companion**
> (current, referenced for detail), **Historical** (point-in-time, immutable), or
> **Superseded** (archive candidate). Per the modernization brief: *merge overlapping,
> identify obsolete, recommend consolidation* — without deleting evidence.

## Canonical
- **`audits/ENTERPRISE-AUDIT.md`** — the single authoritative, publishable enterprise
  audit (formerly `STREETJS-MASTER-REPORT.md`; exec summary, metrics, organization,
  security, compliance, plugin/docker/supply-chain/docs/governance, scores, risk,
  outstanding actions, validation). **Start here.**

## Active companions (current — keep, referenced for depth)
| Doc | Role |
|---|---|
| `security/TRUST-CENTER.md` | Canonical public security page |
| `security/SECURITY-CLASSIFICATION.md` | Public/Internal/Confidential/Secret tiers |
| `security/{SLSA-ASSESSMENT,NIST-SSDF-MAPPING,OWASP-ASVS-MAPPING}.md` | Compliance mappings |
| `audits/{OPENSSF-REVIEW,SCORING-METHODOLOGY,REPOSITORY-METRICS}.md` | Reproducible scoring inputs |
| `audits/{DOCKER-REVIEW,PLUGIN-SECURITY-REPORT,PLUGIN-MATURITY-MATRIX}.md` | Domain reviews |
| `audits/ENTERPRISE-READINESS-PHASE-18.md` | **Current** enterprise-readiness assessment (A–M, evidence-tagged) |
| `audits/ENTERPRISE-READINESS-2026.md` | Prior readiness + framework benchmark (companion) |
| `audits/PHASE-20-FINAL-REPORT.md` | Latest phase deliverable record |
| `security/{KEY-ROTATION-RUNBOOK,KEY-ROTATION-CHECKLIST,KEY-EMERGENCY-RUNBOOK,SECRET-SCANNING-GUIDE}.md` | Operator runbooks |
| `security/{SECURITY-AUDIT,PLUGIN-SECURITY-AUDIT,PLUGIN-SECURITY-STANDARD,MARZPAY-SECURITY-REVIEW,SECRET-EXPOSURE-REPORT,BRANCH-PROTECTION-REVIEW,NPM-PUBLISH-SECURITY-REVIEW,INFRASTRUCTURE-SECURITY-REVIEW,THREAT-MODEL-2026,SECURITY-ROADMAP}.md` | Security detail |
| `governance/{CHARTER,REPOSITORY-ORGANIZATION,RELEASE-POLICY,CONTRIBUTOR-GOVERNANCE}.md` | Governance |
| `plans/{OUTSTANDING-ACTIONS,REPOSITORY-CLEANUP-PLAN}.md` | Action registers |

## Historical (point-in-time records — kept IN PLACE, do not edit)
`audits/ENTERPRISE-READINESS.md` (Phase 17 — retained in place, heavily referenced),
`security/{PLUGIN-SIGNING-REVIEW,PAYMENTS-SECURITY-REVIEW,PRIVACY-POLICY-FOR-REPO}.md`,
`security/SECURITY-AUDIT.md` (evidence). Everything else point-in-time has been moved
to `*/archive/` (see "Superseded → archived" below).

## Superseded → archived
Historical/superseded reports now live under `*/archive/` (git history preserved):
- **`audits/archive/`** — `STREETJS-FULL-AUDIT-REPORT.md` (→ ENTERPRISE-AUDIT), `ENTERPRISE-READINESS-COMPARISON.md` (→ ENTERPRISE-READINESS-2026), `REPOSITORY-HARDENING-REPORT.md` (→ ENTERPRISE-AUDIT), `SECURITY-AUDIT-2026.md`, `PHASE-18-AUDIT.md`, `REPO-ORGANIZATION-PLAN.md` (→ governance/REPOSITORY-ORGANIZATION), `SHOWCASE-AUDIT.md`, `LANGUAGE-STATS-AUDIT.md`, `ECOSYSTEM-PLUGINS-AUDIT.md`, `MARZPAY-INTEGRATION-REPORT.md`, `PHASE-20-COMPLETION-REPORT.md` (→ PHASE-20-FINAL-REPORT).
- **`security/archive/`** — `SECURITY-HARDENING-SPRINT.md` (completed), `SECURITY-SCORECARD.md` (→ SCORING-METHODOLOGY + OPENSSF-REVIEW), `THREAT-MODEL-UPDATE.md` (→ THREAT-MODEL-2026), `PHASE-19-MASTER-AUDIT.md` (→ ENTERPRISE-AUDIT).
- **`plans/archive/`** — `SECURITY-ROADMAP.md` (→ security/SECURITY-ROADMAP), `PHASE-18-EXECUTION-PLAN.md` (completed).

> Archived docs are frozen historical evidence — internal backtick path-mentions may
> be stale by design; they are never edited. Active docs link only to active docs.

## Document classification table (deliverable)
| Class | Meaning | Examples |
|---|---|---|
| Canonical | single source of truth | `audits/ENTERPRISE-AUDIT.md`, `security/TRUST-CENTER.md`, `governance/CHARTER.md` |
| Companion | current, referenced for detail | OPENSSF-REVIEW, DOCKER-REVIEW, PLUGIN-SECURITY-REPORT, compliance mappings, runbooks |
| Historical | point-in-time, kept in place | `audits/ENTERPRISE-READINESS.md` (Phase 17), `security/SECURITY-AUDIT.md` evidence |
| Archived | superseded → `*/archive/` | the lists above |
| Superseded | replaced; archived | same as Archived |

## Consolidation recommendations (remaining)
- `plans/SECURITY-ROADMAP.md` archived; `security/SECURITY-ROADMAP.md` is authoritative.
- `audits/ENTERPRISE-READINESS.md` (Phase 17) retained in place (heavily backtick-referenced);
  `ENTERPRISE-READINESS-2026.md` is the active version.

## Rule
New audit phases append to the **canonical** `audits/ENTERPRISE-AUDIT.md` + the relevant
domain companion. Do not create new top-level "full report" docs — that is the sprawl
this index exists to prevent. Historical snapshots go to `*/archive/`, never deleted.
