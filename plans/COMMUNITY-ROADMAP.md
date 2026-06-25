# Community Roadmap — StreetJS Phase 17 (Workstream G)

> Tags: **VERIFIED** · **GAP** · **RECOMMENDATION**.

## Audit — VERIFIED / GAP

| Asset | State |
|---|---|
| `CONTRIBUTING.md` | VERIFIED (root) |
| `CODE_OF_CONDUCT.md` | VERIFIED (root) |
| `GOVERNANCE.md` | VERIFIED (root) |
| `SECURITY.md` | VERIFIED (root) |
| RFC process | VERIFIED — `rfcs/` with `0000-template.md`, `0001-orm-relations.md`, `0002-fullstack-expansion.md`, `README.md` |
| `/community/` portal | VERIFIED (docs) — contributor path, governance, RFC, good first issues |
| Public roadmap | VERIFIED — `docs/roadmap.md` |
| GitHub Discussions | GAP — not confirmed enabled/seeded |
| Discord / chat | GAP — none |
| Mentorship program | partial — issue template `mentored_task.yml` exists (VERIFIED); no running program |
| Contributor recognition | GAP — no automated contributors wall |

**Finding:** governance scaffolding is strong; the gap is *active* community
surfaces (real-time chat, discussions, recognition, mentorship cadence).

## Plan

### 30 days
- Enable + seed **GitHub Discussions** (Q&A, Ideas, Show-and-tell); pin a
  "start here" post linking docs/community + RFC index. GAP→fix
  **— IMPLEMENTED:** Discussions enabled; seeded a "Start here" welcome
  (#66, Announcements) + Q&A (#67), Ideas (#68) and Show-and-tell (#69) threads.
  (Pinning the welcome post is a one-click UI action — not exposed via API.)
- Add a **contributors wall** to `/community/` (all-contributors or CI-generated
  from git history — GitHub-Pages-safe static JSON). GAP→fix
- Label and curate **20 good-first-issues** mapped to Workstream A/D gaps
  (each new plugin/CLI command = a scoped first issue).
- Publish a **support matrix** stub (channels + response expectations).

### 90 days
- Launch **Discord** with channels mirroring docs sections; bridge releases via
  `@streetjs/plugin-discord` (dogfoods Workstream A gap #2).
- Run the **mentored-task** program for real (the template already exists):
  2–3 mentored issues/month with a maintainer assigned.
- Monthly **community call** + release notes readout.
- First **external RFC** accepted end-to-end (proves the process scales).

### 180 days
- **Plugin authors program**: `street generate plugin` (Workstream D) + Verified
  certification path + listing in the marketplace (Workstream E).
- Triage rotation + published SLAs for issues/security.
- Contributor ladder (Contributor → Reviewer → Maintainer) documented in GOVERNANCE.

### 365 days
- Community-maintained plugins reach **Verified** tier at scale.
- Annual roadmap RFC; transparent maintainer elections per GOVERNANCE.
- Showcase of community-built apps (Workstream C) on the site.

## RECOMMENDATIONS
1. **Turn governance docs into activity.** The paperwork exists; the missing
   ingredient is recurring cadence (Discussions, Discord, monthly call).
2. **Make contributing mechanical:** every Phase-17 gap (plugins, CLI commands,
   starters, showcases) becomes a labelled, scoped issue with a generator.
3. **Recognize early and often** — a visible contributors wall and changelog
   shout-outs are the cheapest retention lever.
