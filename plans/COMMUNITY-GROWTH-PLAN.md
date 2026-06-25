# StreetJS — Community Growth Plan (Phase 18, Workstream G)

> **Scope:** Design-first audit of StreetJS community / governance / contribution
> readiness and a prioritized, designed program for Workstream G (Community Growth).
> **Constraints honored:** verify-from-source first; no assumptions; DESIGN, do not
> implement; no core framework changes; no marketing claims without evidence.
> **Tags:** every finding is exactly one of **VERIFIED** / **GAP** / **RISK** / **RECOMMENDATION**.
> This is a planning/design document only — no source files were modified.

---

## 1. Executive Summary

StreetJS has an unusually **strong governance and contribution paper-trail for a
pre-scale project**. The substantive finding, confirmed from source, is the same one
the project already states about itself: the scaffolding (governance, RFC process,
contributor ladder, certification gradient, issue templates, labels) **exists and is
high quality**, but the *active community machinery* (a real mentorship cadence, a
seeded good-first-issue backlog, a verified third-party plugin program with real
participants, a contributors wall) is either **not operationalized** or **depends on
external/runtime actions that cannot be verified from the repository**.

The dominant constraint — and the central RISK — is **maintainer capacity**. The
repository documents a single code owner (`@hassanmubiru`), no `MAINTAINERS` file,
and a Steering Committee design that requires an odd number ≥ 3 seats. The project is
candid about this (`docs/community/index.md`: growing to "2+ active maintainers" is
the top priority). Every Workstream-G recommendation below is therefore designed to
be **solo-maintainer-survivable**: mechanical, low-cadence, automation-first, and
explicitly degradable when capacity is zero.

Two prior documents already cover much of this ground — `COMMUNITY-ROADMAP.md`
(Phase 17 Workstream G) and `PHASE-18-EXECUTION-PLAN.md` (Workstream 3). This plan
**reconciles and builds on them** rather than duplicating: it promotes their bullet
plans into designed recommendations with evidence, flags where their claims are
unverifiable from source, and resolves inconsistencies between the docs and the
actual `.github/` assets.

---

## 2. VERIFIED Community-Asset Inventory

All paths below were read from source in this repo.

### 2.1 Root governance & contribution docs

| Asset | Status | Evidence (path) | Notes |
|---|---|---|---|
| Contribution guide | **VERIFIED** | `CONTRIBUTING.md` | 13.5 KB; full PR process, code style, test gates |
| Governance model | **VERIFIED** | `GOVERNANCE.md` | Roles, Steering Committee (odd seats ≥3, 12-mo terms), decision rules, maintainer responsibilities, **full RFC lifecycle** (Mermaid: Draft→Proposed→FCP→Accepted→Implemented→Deprecated/Declined/Withdrawn) |
| Code of Conduct | **VERIFIED** | `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1; private reporting via GitHub security advisories |
| Security policy | **VERIFIED** | `SECURITY.md` | CVSS v3.1 severity table, fix-window SLAs, private vulnerability reporting, scope |
| Community roadmap (Workstream G) | **VERIFIED** | `COMMUNITY-ROADMAP.md` | Existing 30/90/180/365-day plan + audit table |
| Phase-18 community spec | **VERIFIED** | `PHASE-18-EXECUTION-PLAN.md` (Workstream 3) | Contributor levels, 25 good-first-issue ideas, scoring |

### 2.2 Docs-site community surfaces (`docs/`)

| Asset | Status | Evidence (path) | Notes |
|---|---|---|---|
| Contributing (Pages) | **VERIFIED** | `docs/contributing.md` | Dev setup, testing, PR process, coverage gates (85% CLI / 60% core) |
| Community portal index | **VERIFIED** | `docs/community/index.md` | Ways to participate, ladder summary, **explicit "2+ maintainers is top priority"** statement |
| Community structure / Discussions design | **VERIFIED** | `docs/community/README.md` | 8 documented Discussions categories, moderation policy (two-maintainer concurrence), escalation routes |
| **Contributor ladder** | **VERIFIED** | `docs/community/contributor-path.md` | 4 explicit roles: First contribution → Contributor → Reviewer → Maintainer → Steering Committee, with bars/rights/nomination for each |
| Plugin author guide | **VERIFIED** | `docs/ecosystem/plugin-author-guide.md` | Package layout, plugin contract, Ed25519 manifest signing, CI hygiene, certification path |
| **Plugin certification gradient** | **VERIFIED** | `docs/ecosystem/plugin-certification.md` | Official / Verified / Community levels, 3 review checklists (structure/security/compat), scorecard, submission process |

### 2.3 RFC process (`rfcs/`)

| Asset | Status | Evidence (path) | Notes |
|---|---|---|---|
| RFC process doc | **VERIFIED** | `rfcs/README.md` | When-required rules, process steps, FCP, status lifecycle, decision rule |
| RFC template | **VERIFIED** | `rfcs/0000-template.md` | Front-matter status enum + full section skeleton (motivation, reference-level, backward-compat, security, testing) |
| Accepted RFCs (process is *used*) | **VERIFIED** | `rfcs/0001-orm-relations.md`, `rfcs/0002-fullstack-expansion.md` | Two real RFCs exist — the process is not just theoretical |
| RFC lifecycle governance | **VERIFIED** | `GOVERNANCE.md` ("RFC governance" section) | Authoritative lifecycle; `rfcs/` declared canonical |

### 2.4 GitHub process assets (`.github/`)

| Asset | Status | Evidence (path) | Notes |
|---|---|---|---|
| Bug report template | **VERIFIED** | `.github/ISSUE_TEMPLATE/bug_report.yml` | Labels `bug`, `triage` |
| Feature request template | **VERIFIED** | `.github/ISSUE_TEMPLATE/feature_request.yml` | Labels `enhancement`, `triage` |
| Issue template config | **VERIFIED** | `.github/ISSUE_TEMPLATE/config.yml` | Blank issues disabled; contact links → security advisories + Discussions |
| **Mentored-task template** | **VERIFIED** | `.github/ISSUE_TEMPLATE/mentored_task.yml` | **Exists.** Pre-labels `good-first-issue`+`help-wanted`; mentorship dropdown; acceptance-criteria field |
| Pull request template | **VERIFIED** | `.github/pull_request_template.md` | Summary/Changes structure |
| Code owners | **VERIFIED** | `.github/CODEOWNERS` | Sole owner `@hassanmubiru` (default + security/db paths) |
| Funding | **VERIFIED** | `.github/FUNDING.yml` | `github: [hassanmubiru]` (Sponsors button gated on account enablement) |
| Dependabot | **VERIFIED** | `.github/dependabot.yml` | Present |
| **Label manifest** | **VERIFIED** | `.github/labels.yml` | Defines **`good-first-issue`**, `help-wanted`, **`mentorship-available`**, `documentation`, `security`, `ecosystem`, `rfc`, `priority:critical`, `regression` |

**Net:** the *design and documentation layer* of community growth is essentially
complete and internally cross-referenced. The gaps are in *operation* and
*verification*, not authorship.

---

## 3. Gap Matrix vs Workstream-G Recommendation Areas

For each Workstream-G area, the table separates what is **already designed/documented
(VERIFIED)** from what is **not yet operational (GAP)**. Per the brief, recommendations
are *designed*, not asserted as flatly "missing."

| Workstream-G area | Design/Docs status | Operational status | Evidence | Designed action ref |
|---|---|---|---|---|
| **Contributor ladder** | **VERIFIED** — 4 roles fully specified | **VERIFIED (documented)**; advancement events not yet exercised at scale | `docs/community/contributor-path.md`, `GOVERNANCE.md` | R5 (light-touch) |
| **Good-first-issues** | **VERIFIED** — label defined; 25 candidate issues spec'd | **GAP** — no evidence issues are *seeded/curated* on the tracker; `labels.yml` is a manifest needing a sync action; seeding is flagged external in `PHASE-18-EXECUTION-PLAN.md` | `.github/labels.yml`, `PHASE-18-EXECUTION-PLAN.md` (WS3) | R1 |
| **Mentorship paths** | **VERIFIED** — template + `mentorship-available` label | **GAP** — no running cadence, no seeded mentored tasks, no mentor roster | `.github/ISSUE_TEMPLATE/mentored_task.yml`, `.github/labels.yml` | R2 |
| **Verified plugin author program** | **VERIFIED** — gradient, checklists, scorecard, submission flow all documented | **GAP** — no verified third-party authors/plugins exist yet; no author registry/recognition; submission relies on manual maintainer review | `docs/ecosystem/plugin-certification.md`, `docs/ecosystem/plugin-author-guide.md` | R3 |
| **GitHub Discussions** | **VERIFIED** — 8 categories + moderation/escalation designed | **RISK/GAP** — enablement is a repo setting (external); `COMMUNITY-ROADMAP.md` claims it is enabled+seeded (#66–69) but this is **not verifiable from source** | `docs/community/README.md`, `config.yml` | R4 |
| **Contributor recognition (wall)** | partial — `contributor-path.md` says "all-contributors" | **GAP** — no `.all-contributorsrc`, no generator, no wall page | absence of `.all-contributorsrc`; `docs/community/contributor-path.md` | R6 |
| **Maintainer roster / bus factor** | **GAP** — `GOVERNANCE.md` references a `MAINTAINERS` file "to be populated" | **GAP** — no `MAINTAINERS` file; sole CODEOWNER | `GOVERNANCE.md`, `.github/CODEOWNERS` | see RISK-1 / R7 |

### 3.1 Documentation/asset inconsistencies found (source-verified)

- **GAP (inconsistency):** `GOVERNANCE.md` (legacy "RFC process" section) tells authors
  to "Open an RFC issue from the `rfc` template," but there is **no
  `.github/ISSUE_TEMPLATE/rfc.yml`** — the real RFC flow is PR-based via
  `rfcs/0000-template.md`. The governance doc itself notes the later section is
  authoritative, but the stale instruction can mislead. → R8.
- **GAP (inconsistency):** issue templates reference labels `bug`, `triage`,
  `enhancement` that are **not defined in `.github/labels.yml`**. → R8.
- **RISK:** `labels.yml` is a *manifest* (header says apply via a label-sync action or
  `gh label create`); existence of the file does **not** prove the labels exist on the
  live repo. Treat label availability as unverified-from-source.

---

## 4. RISKs

- **RISK-1 (central): Designing community programs against ~zero maintainer capacity.**
  Source shows a single code owner (`.github/CODEOWNERS`), no `MAINTAINERS` file
  (`GOVERNANCE.md` says "to be populated"), and the project's own admission that 2+
  maintainers is the top priority (`docs/community/index.md`). Programs that assume
  recurring maintainer effort — mentorship cadence, two-maintainer moderation
  concurrence (`docs/community/README.md`), ~3-business-day triage and CVSS fix windows
  (`GOVERNANCE.md`, `SECURITY.md`) — are **structurally unfulfillable by one person**.
  Over-committing here damages trust more than having no program.

- **RISK-2: Governance is partly aspirational.** The Steering Committee requires an odd
  number ≥ 3 seats held by Maintainers (`GOVERNANCE.md`); with one maintainer the SC,
  elections, FCP votes, and two-maintainer mute/ban concurrence cannot operate as
  written. This is a credibility risk if external contributors test the process.

- **RISK-3: Unverifiable activity claims.** `COMMUNITY-ROADMAP.md` states Discussions
  are "enabled" and seeded (threads #66–69) and that 20 good-first-issues are to be
  curated. None of this is verifiable from repository source (it lives in GitHub
  runtime state). Presenting it as done in a marketing/adoption context would violate
  the "no claims without evidence" principle. Label such items "claimed, not
  source-verifiable."

- **RISK-4: Verified-author program implies a trust guarantee.** The certification
  gradient promises a "Verified" badge backed by security/compat review
  (`docs/ecosystem/plugin-certification.md`). If review is performed inconsistently by a
  single overloaded maintainer, the badge's trust value erodes — a *worse* outcome than
  not offering it. Operationalize only with a checklist gate that can run mostly in CI.

- **RISK-5: FUNDING button may render dead.** `FUNDING.yml` points to GitHub Sponsors
  for `hassanmubiru`; the file's own comment notes the button only renders once Sponsors
  is enabled. Unverifiable from source; a dead sponsor link is a minor trust ding.

---

## 5. Prioritized, Designed RECOMMENDATIONS

Each is a **RECOMMENDATION** with Implementation Order, ROI ranking, Adoption Impact,
and Maintenance Cost. ROI ranking is relative across this list (1 = best ROI).
"Maintenance Cost" is the ongoing burden on a solo maintainer — the binding constraint.

### R1 — Seed & curate a good-first-issue backlog from existing specs
**RECOMMENDATION.** The label (`good-first-issue`) and 25 scoped candidate tasks already
exist in source (`.github/labels.yml`, `PHASE-18-EXECUTION-PLAN.md` WS3). The missing
step is *operational*: sync labels to the repo, then file the top ~10 candidates using
the **existing** `mentored_task.yml` template (which already enforces
acceptance-criteria + area + mentorship fields). Start with the 10 lowest-effort,
self-contained items (CLI generators, single plugins, docs) so they survive zero-mentor
weeks.
- **Implementation Order:** 1 (do first — unblocks everything else; pure curation, no code).
- **ROI ranking:** 1
- **Adoption Impact:** High — converts a strong contributor funnel design into an actual entry ramp.
- **Maintenance Cost:** Low (one-time seeding ~1 day; ~1 hr/month top-up). Degrades gracefully if ignored.

### R2 — Operationalize mentorship as "batched, low-cadence," not always-on
**RECOMMENDATION.** The template + `mentorship-available` label exist; design the
*process* around capacity: tag only 2–3 issues `mentorship-available` at a time, with an
explicit "mentor responds within ~1 week" expectation (not the ~3-day triage SLA), and a
visible "mentorship currently paused" toggle for zero-capacity periods. Keep a tiny
mentor roster in the (new) `MAINTAINERS` file (see R7).
- **Implementation Order:** 3 (after R1 backlog and R7 roster).
- **ROI ranking:** 4
- **Adoption Impact:** Medium — high per-contributor retention, low volume.
- **Maintenance Cost:** Medium — the honest risk; design explicitly allows pausing.

### R3 — Stand up the Verified Plugin Author program as a CI-gated checklist
**RECOMMENDATION.** Criteria are fully designed (`plugin-certification.md`,
`plugin-author-guide.md`). Operationalize by making the three checklists
(structure/security/compat) **mostly machine-checkable** so a single maintainer can
grant "Verified" with confidence: reuse the existing `runtime-certification.yml` pattern
(referenced in the author guide) and the marketplace `tier` field
(`scripts/gen-plugins-data.mjs`, per `PHASE-18-EXECUTION-PLAN.md`) so Verified status is
data-driven, not a manual badge. Add an `ecosystem`-labeled submission issue type. Do
**not** advertise the program until at least one external plugin passes end-to-end.
- **Implementation Order:** 4
- **ROI ranking:** 3
- **Adoption Impact:** High (long-term ecosystem flywheel) — but slow to materialize.
- **Maintenance Cost:** Medium — bounded if checks run in CI; High if review stays manual (see RISK-4).

### R4 — Treat Discussions as the single live surface; verify before claiming
**RECOMMENDATION.** Categories + moderation are designed (`docs/community/README.md`).
Action: confirm Discussions are actually enabled (repo setting — external), add
`.github/DISCUSSION_TEMPLATE/` stubs matching the documented categories, and re-state any
"enabled/seeded" claims in `COMMUNITY-ROADMAP.md` as **verified** only once observable.
Pick Discussions over Discord first — async + indexable + zero new infra fits a solo
maintainer; defer real-time chat (Discord) until 2+ maintainers exist.
- **Implementation Order:** 2
- **ROI ranking:** 2
- **Adoption Impact:** Medium-High — the one place contributors actually gather.
- **Maintenance Cost:** Low-Medium — async; can be triaged weekly.

### R5 — Keep the contributor ladder; add lightweight advancement triggers
**RECOMMENDATION.** The ladder is VERIFIED and well-specified. Do not redesign. Add only
a tiny, mechanical trigger: a changelog/release-notes "new contributors / role changes"
section (the recognition hook `contributor-path.md` already promises) so advancement is
visible without ceremony. Reconcile with `GOVERNANCE.md` so role names match exactly
(the Phase-18 spec uses a slightly different "Plugin Author" rung — align or footnote).
- **Implementation Order:** 5
- **ROI ranking:** 5
- **Adoption Impact:** Medium — motivation/retention.
- **Maintenance Cost:** Low.

### R6 — Add a CI-generated contributors wall (static, Pages-safe)
**RECOMMENDATION.** `contributor-path.md` already promises all-contributors but no
`.all-contributorsrc` or generator exists. Implement as a **build-time static generator**
(git history → committed JSON → `/community/` page), mirroring the proven
`gen-plugins-data.mjs` pattern — no bot, no runtime infra, no new dependency surface.
- **Implementation Order:** 6
- **ROI ranking:** 6
- **Adoption Impact:** Low-Medium — cheap retention/recognition lever.
- **Maintenance Cost:** Low (regenerated in CI).

### R7 — Create `MAINTAINERS` and right-size governance to reality
**RECOMMENDATION.** `GOVERNANCE.md` references a `MAINTAINERS` file that does not exist.
Create it (even with one name) and add a short, honest "current state" note: the SC and
multi-maintainer quorum rules activate at N≥3; until then decisions are by the sole
maintainer via lazy consensus. This removes RISK-2's credibility gap without weakening
the long-term design. Pair with the active recruitment ask already in
`docs/community/index.md`.
- **Implementation Order:** 2 (cheap, unblocks R2 mentor roster and honesty of claims).
- **ROI ranking:** 4
- **Adoption Impact:** Medium (trust/transparency) — and a prerequisite for scaling.
- **Maintenance Cost:** Low.

### R8 — Fix the source inconsistencies (RFC issue path + label drift)
**RECOMMENDATION.** Either add an `rfc.yml` issue template or update the stale
`GOVERNANCE.md` line to point to the PR-based `rfcs/0000-template.md` flow; and add the
`bug`/`triage`/`enhancement` labels (used by templates) to `.github/labels.yml`. Pure
hygiene; prevents new-contributor confusion at the exact moment R1 drives traffic.
- **Implementation Order:** 1 (bundle with R1).
- **ROI ranking:** 3
- **Adoption Impact:** Low-Medium (removes friction precisely when funnel opens).
- **Maintenance Cost:** Very Low (one-time).

### Implementation order summary
1. **R1** (seed GFIs) + **R8** (fix inconsistencies) — same pass.
2. **R4** (verify/enable Discussions) + **R7** (MAINTAINERS + governance honesty).
3. **R2** (batched mentorship).
4. **R3** (Verified author program, CI-gated).
5. **R5** (ladder advancement triggers).
6. **R6** (contributors wall).

---

## 6. Reconciliation with existing plans (no duplication)

- `COMMUNITY-ROADMAP.md` already lays out a 30/90/180/365 plan and an audit table. This
  plan **adopts** its structure and **corrects** its verification posture: items it marks
  "IMPLEMENTED" (Discussions enabled/seeded #66–69) are re-classified here as
  **claimed / not source-verifiable** (RISK-3), per the no-claims-without-evidence rule.
- `PHASE-18-EXECUTION-PLAN.md` (Workstream 3) supplies the 25 good-first-issue candidates
  and the contributor-level model; R1/R5 **build on** these rather than re-inventing them,
  and align the rung names with `GOVERNANCE.md`/`contributor-path.md`.
- The contributor ladder and certification gradient are treated as **VERIFIED and kept**;
  this plan adds only operational glue, never a redesign.

---

## 7. Audit summary (for the master audit)

**Top VERIFIED facts**
1. Governance/contribution paper-trail is complete and cross-referenced: `CONTRIBUTING.md`, `GOVERNANCE.md` (full SC + RFC lifecycle), `CODE_OF_CONDUCT.md` (Covenant 2.1), `SECURITY.md` (CVSS SLAs).
2. RFC process is real and *used* — `rfcs/` has README, `0000-template.md`, and two accepted RFCs (`0001`, `0002`).
3. Contributor ladder is fully specified (`docs/community/contributor-path.md`: 4 roles) and the mentored-task path exists (`.github/ISSUE_TEMPLATE/mentored_task.yml`), with `good-first-issue` + `mentorship-available` labels defined in `.github/labels.yml`.
4. The plugin certification gradient (Official/Verified/Community) + author guide are fully documented (`docs/ecosystem/plugin-certification.md`, `plugin-author-guide.md`).

**Top 3 gaps**
1. **No operational good-first-issue backlog / mentorship cadence** — label + template + 25 candidates exist, but seeding is unverified/external and no mentor roster exists (R1, R2).
2. **Verified plugin author program is documented but has zero participants and a manual review bottleneck** — needs CI-gated operationalization before being advertised (R3, RISK-4).
3. **Bus factor = 1** — sole `CODEOWNER`, no `MAINTAINERS` file, SC design needs ≥3 seats; community programs risk over-committing nonexistent capacity (RISK-1/2, R7).

**Cross-cutting RISK:** several "done" community claims in `COMMUNITY-ROADMAP.md`
(Discussions enabled/seeded) are GitHub runtime state and **not verifiable from
source** — must not be presented as evidence-backed (RISK-3).
