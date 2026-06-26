# StreetJS Decision-Making Process

> **Purpose:** how decisions are proposed, debated, and ratified in StreetJS.
> **Audience:** maintainers + contributors. **Status:** Active. **Last Updated:** 2026-06.
> **Related:** [`CHARTER.md`](./CHARTER.md), [`CONTRIBUTOR-GOVERNANCE.md`](./CONTRIBUTOR-GOVERNANCE.md),
> [`RELEASE-POLICY.md`](./RELEASE-POLICY.md), [`../rfcs/`](../rfcs/), [`../MAINTAINERS.md`](../MAINTAINERS.md).
>
> This closes the foundation-readiness gap (a documented, neutral decision process)
> noted in `audits/ENTERPRISE-READINESS-PHASE-18.md`. It does not change any code.

## Roles
- **Contributors** — anyone opening issues/PRs under the Code of Conduct.
- **Code owners** — required reviewers per path (`.github/CODEOWNERS`).
- **Maintainers** — merge + release authority (`MAINTAINERS.md`).
- **Security team** — owns disclosure + signing-anchor changes (`SECURITY.md`).

## Decision types & mechanism
| Type | Examples | Mechanism |
|---|---|---|
| **Trivial** | bug fix, docs, dependency bump | PR + 1 code-owner approval (lazy consensus) |
| **Standard** | new feature within an existing area, plugin addition | PR + code-owner approval + required CI checks |
| **Substantial / breaking** | public API change, new subsystem, SemVer-MAJOR, governance change | **RFC** in [`rfcs/`](../rfcs/) + maintainer consensus before implementation |
| **Security-sensitive** | signing anchor, CI trust, payment/identity plugins | security-team (CODEOWNERS) approval required |
| **Release** | version cut, LTS designation | per [`RELEASE-POLICY.md`](./RELEASE-POLICY.md) |

## Lazy consensus
Most decisions proceed by **lazy consensus**: a proposal (issue/PR/RFC) that receives
the required approval(s) and no sustained, reasoned objection within the review window
is accepted. Silence is assent for Trivial/Standard changes.

## RFC workflow (Substantial/breaking)
1. Open an RFC PR in `rfcs/` (problem, proposal, alternatives, compatibility/migration impact).
2. Discussion period (≥ 1 week recommended) with code-owner + maintainer input.
3. **Acceptance** requires maintainer consensus (no unresolved maintainer objection).
4. Merged RFC → tracked to implementation; breaking changes require a migration guide + codemods.

## Voting & escalation (when consensus fails)
- If lazy consensus fails (a maintainer objects with reasons), maintainers seek
  resolution by discussion; if unresolved, a **simple majority vote of maintainers**
  decides, recorded in the issue/RFC thread.
- Ties or deadlock escalate to the **project lead** (per `MAINTAINERS.md`) as a
  tie-breaker, used sparingly.
- Security-critical decisions may be **fast-tracked** by the security team under the
  `SECURITY.md` SLAs, with a post-hoc record.

## Transparency & records
- Decisions are recorded in the relevant issue/PR/RFC thread (public).
- Architectural decisions are captured as ADRs (`docs/architecture-decision-records/`).
- Changes are reflected in `CHANGELOG.md`; security decisions in advisories.

## Neutrality & sustainability (foundation readiness)
- Decision authority is **role-based**, not individual; the goal is multiple
  maintainers across organizations (current bus-factor gap tracked in
  `plans/OUTSTANDING-ACTIONS.md`).
- No single contributor may unilaterally land Substantial/breaking or
  security-sensitive changes without the review gates above.
