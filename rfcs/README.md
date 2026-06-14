# StreetJS RFCs

Substantial changes to StreetJS — new public APIs, breaking changes, new core
subsystems, governance changes — go through a lightweight **Request for Comments
(RFC)** process so decisions are discussed in the open and recorded.

## When an RFC is required

- New or breaking public API in `streetjs` or an official plugin.
- A new core subsystem or a cross-cutting architectural change.
- Changes to governance, the release process, or plugin certification.

Small bug fixes, docs, and additive non-breaking changes do **not** need an RFC —
open a normal PR.

## Process

1. **Draft** — copy `0000-template.md` to `rfcs/0000-my-feature.md` (keep the
   `0000` until a number is assigned), fill it in, open a PR.
2. **Discuss** — the PR is the discussion thread. A maintainer labels it
   `rfc` and assigns the next number.
3. **Final Comment Period (FCP)** — when discussion settles, a maintainer
   proposes FCP (merge / close) with a 7-day window and lazy consensus.
4. **Disposition** — merged (accepted) or closed (declined), with a one-line
   rationale recorded in the RFC.
5. **Tracking** — an accepted RFC gets a tracking issue for implementation.

## Status lifecycle

`Draft → Proposed → FCP → Accepted → Implemented` (or `Declined` / `Withdrawn`).

## Decision rule

Lazy consensus among maintainers; unresolved disagreements are decided by a
steering-committee vote (see `GOVERNANCE.md`).
