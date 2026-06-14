---
layout: default
title: Community
nav_order: 40
description: "StreetJS community structure: GitHub Discussions categories, guidelines, moderation, and escalation."
---

# StreetJS Community

How we collaborate, get help, and make decisions in the open.

## GitHub Discussions categories

| Category | Purpose | Format |
|----------|---------|--------|
| **Announcements** | Releases, roadmap, governance updates | maintainers post; comments open |
| **General** | Open discussion about StreetJS | open thread |
| **Help** | Usage questions and troubleshooting | Q&A (accepted answer) |
| **Plugins** | Building, publishing, and discovering plugins | open thread |
| **RFCs** | Early socialization of RFC ideas before a PR (see `rfcs/`) | open thread |
| **Showcase** | Projects built with StreetJS | open thread |
| **Security** | General security topics. **Do not report vulnerabilities here** — use the private process in `SECURITY.md` | open thread |
| **Enterprise** | Procurement, compliance, and deployment-at-scale questions | Q&A |

## Discussion guidelines

1. **Search first** — your question may be answered.
2. **One topic per thread** — keeps answers findable.
3. **Provide a reproduction** for bugs (versions, minimal code, expected vs actual).
4. **Confirmed bugs become issues** — a maintainer converts the thread to an issue.
5. **Be respectful** — the [Code of Conduct](../../CODE_OF_CONDUCT.md) applies everywhere.

## Moderation policy

Moderation enforces the Code of Conduct. Actions escalate proportionally:

1. **Edit/label** — off-topic or mis-categorized content is moved/relabeled.
2. **Warning** — a public or private note citing the specific guideline.
3. **Temporary mute** — for repeated violations after a warning.
4. **Ban** — for severe or persistent violations.

Mutes and bans require **two maintainers** to concur (recorded in a private
moderation log). Appeals go to the Steering Committee (see `GOVERNANCE.md`).

## Escalation process

| Situation | Route |
|-----------|-------|
| Security vulnerability | **Private** — `SECURITY.md` disclosure process (never a public thread) |
| Code of Conduct violation | email the maintainers listed in `CODE_OF_CONDUCT.md` |
| Disputed technical decision | open/ągreference an RFC; unresolved → Steering Committee vote |
| Urgent production-impacting bug | open an issue labeled `priority:critical` + post in Help |

## Where to go

- **Question?** → Discussions · Help
- **Bug?** → an issue (use the bug template)
- **Idea/feature?** → Discussions, then an RFC if substantial
- **Want to contribute?** → [Contributor Path](contributor-path.md)
