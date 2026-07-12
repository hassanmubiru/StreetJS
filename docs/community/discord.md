---
layout:      default
title:       "StreetJS Discord — Community Design & Operations Guide"
permalink:   /community/discord/
nav_exclude: true
description:  "The complete design and operations guide for the official StreetJS Discord: server structure, roles, onboarding, rules, FAQ, announcement templates, moderation, contributor journey, growth plan, and launch checklist."
---

# StreetJS Discord — Community Design & Operations Guide

Everything needed to run the official StreetJS community server. Copy-paste ready.

- **Project:** StreetJS — a TypeScript-first backend framework with a minimal,
  carefully curated dependency footprint, verified/signed releases, and an
  enterprise-oriented, security-focused engineering practice.
- **Repository (source of truth):** <https://github.com/hassanmubiru/StreetJS>
- **Discord invite:** <https://discord.gg/Wgazap3yv>

**Guiding principles:** keep it simple; few channels; documentation first; GitHub
is the source of truth; welcome beginners without lowering technical quality;
avoid unnecessary bots; prefer sustainability over rapid growth.

> **Voice & claims:** describe StreetJS as having a *minimal, carefully curated
> dependency footprint* (never "dependency-free"). Avoid unverifiable superlatives
> ("fastest", "best", "most secure", "widely adopted"). Let the engineering speak.

---

## 1. Server Structure

Deliberately small. Every channel earns its place; split only when a channel gets
consistently noisy. Recommended top-to-bottom order:

### 📌 START HERE
| Channel | Type | Description |
|---|---|---|
| `#welcome` | Text (read-only) | What StreetJS is, the invite rules, and where to go first. |
| `#rules` | Text (read-only) | Community rules + Code of Conduct link. |
| `#announcements` | Announcement | Releases, security notices, RFCs, events. Read-only; follow to your own server. |
| `#start-here` | Text (read-only) | Links: docs, quickstart, repo, "Get a role" onboarding. |

### 💬 COMMUNITY
| Channel | Type | Description |
|---|---|---|
| `#general` | Text | Introductions and general project conversation (keep support in `#help`). |
| `#showcase` | Text | Show what you built with StreetJS. Links + a sentence on what it does. |
| `#off-topic` | Text | Light, respectful non-project chatter. Optional; remove if unused. |

### 🛠 SUPPORT
| Channel | Type | Description |
|---|---|---|
| `#help` | Forum (preferred) | Ask usage questions. One thread per question; mark solved. |
| `#deploy-and-ops` | Text | Docker, Kubernetes, Postgres HA, Redis Cluster, observability, production. |

### 🧩 BUILDING STREETJS
| Channel | Type | Description |
|---|---|---|
| `#contributors` | Text | Coordinate PRs, good-first-issues, and reviews. |
| `#plugin-authors` | Text | Building/publishing plugins against the plugin architecture. |
| `#rfcs-and-design` | Text | Discuss RFCs and architecture. Decisions still land in GitHub RFCs. |
| `#ci-releases` | Text | Release engineering, signing/provenance, CI. Mostly maintainers. |

### 🔔 FEEDS (integrations, read-only)
| Channel | Type | Description |
|---|---|---|
| `#github-activity` | Text (read-only) | Curated GitHub events (releases, merged PRs, new issues). Low-noise. |
| `#ci-status` | Text (read-only) | Optional: release/publish workflow outcomes only. |

### 🛡 STAFF (private)
| Channel | Type | Description |
|---|---|---|
| `#maintainers` | Text | Maintainer coordination. |
| `#mod-log` | Text | Moderation actions + bot audit log. |
| `#staff-voice` | Voice | Ad-hoc maintainer calls / office hours prep. |

### 🔊 VOICE
| Channel | Type | Description |
|---|---|---|
| `Community Call` | Voice | Monthly community call / office hours. |
| `Pairing / Focus` | Voice | Optional pairing or co-working. |

> **Why a Forum channel for `#help`:** threads keep each question self-contained,
> searchable, and closeable ("solved" tag) — which makes them easy to convert into
> docs/issues later. If your server can't use Forum channels, use a plain `#help`
> text channel with a "one question = one thread" norm.

---

## 2. Roles

Keep the ladder short and meaningful. Colors are a suggestion.

| Role | Purpose | Key Discord permissions |
|---|---|---|
| **Founder** | Project owner / final say. | Administrator. |
| **Maintainer** | Trusted with merge rights on GitHub; runs the community. | Manage Channels/Messages/Roles (below Founder), Kick/Ban, Timeout, Manage Threads, Mention @everyone. |
| **Contributor** | Has merged a PR. | Send Messages, Create Threads, Embed Links, Attach Files, add reactions, connect to voice. Recognition role. |
| **Plugin Author** | Publishes a StreetJS plugin. | Same as Contributor + post in `#plugin-authors`; may share their plugin in `#showcase`/`#announcements` via a maintainer. |
| **Community Helper** | Consistently gives good help. | Contributor perms + Manage Messages in `#help` (mark solved, tidy threads), Manage Threads. Not a moderator. |
| **Community Member** | Verified regular member. | Standard: send messages, create threads, react, voice. |
| **New Member** | Just joined, pre-onboarding. | Read-only in most channels; can post in `#start-here`/onboarding only until they accept rules. |
| **Bots** | Integrations. | Scoped to exactly what each bot needs (see §10). No Administrator. |

**Permission guidance**
- Default `@everyone`: **deny** Send Messages in `#welcome`, `#rules`,
  `#announcements`, `#start-here`, and all FEEDS channels; allow reading.
- Grant Send/Thread perms at the **Community Member** level, not `@everyone`, so
  onboarding gates first-post behavior.
- Only **Founder** holds Administrator. Maintainers get explicit permissions, not
  Admin — least privilege keeps the server auditable.
- **Contributor / Plugin Author / Community Helper** are earned recognition roles;
  assign them by hand or via a maintainer command, not self-service.

---

## 3. Onboarding Flow

Fast, low-friction, and gently gated so the first message is intentional.

1. **Join** via the invite. Discord's built-in Membership Screening shows the
   rules; the member must accept to talk.
2. **`#welcome`** (read-only) states what StreetJS is and points to `#start-here`.
3. **`#start-here`** offers a lightweight **reaction-role** to self-select
   interests (e.g. 🧩 plugin author, 🚀 deploying to production, 🛠 want to
   contribute). This is optional and only adds visibility, not access.
4. **First question →** `#help` (Forum): "one question per thread, include your
   StreetJS version, Node version, and a minimal repro."
5. **Want to contribute? →** `#contributors` + the repo's `CONTRIBUTING.md` and
   `good first issue` label.
6. Roles like **Contributor** are granted after a first merged PR (see §12).

**Design intent:** a new member should reach "I asked my question in the right
place with the right details" within two minutes, without reading a wall of text.

---

## 4. Welcome Message

Pinned in `#welcome`.

```
👋 Welcome to the StreetJS community!

StreetJS is a TypeScript-first backend framework focused on developer
experience, enterprise-ready capabilities, security, verified/signed releases,
and a minimal, carefully curated dependency footprint.

This server is for real-time help, technical discussion, contributor
coordination, and release news. GitHub remains the source of truth for issues,
pull requests, RFCs, docs, and the roadmap.

Get started:
• 📖 Docs & quickstart → (link)
• 🧭 New here? → #start-here
• 🛠 Need help? → #help (one question per thread, include versions + a minimal repro)
• 🧩 Building a plugin? → #plugin-authors
• 🤝 Want to contribute? → #contributors + CONTRIBUTING.md

Please read #rules. Be kind, be precise, and help us keep the signal high.
Glad you're here. 🚀
```

---

## 5. Server Rules

Pinned in `#rules`.

```
StreetJS Community Rules

1. Be respectful. No harassment, hate speech, personal attacks, or discrimination.
2. Stay on topic. Keep support in #help and use the right channel.
3. Search first. Check the docs and existing threads before asking.
4. Ask well. One question per thread; include StreetJS + Node versions and a
   minimal reproduction. Use code blocks, not screenshots of text.
5. No spam or unsolicited self-promotion. Share your work in #showcase.
6. Keep it safe-for-work and professional.
7. Security issues are NOT reported here. Use the process in SECURITY.md
   (private disclosure) — never post exploit details in public channels.
8. No piracy, illegal content, or sharing others' private information.
9. English keeps threads searchable and helpable; other languages are welcome in
   #off-topic.
10. Maintainer decisions on moderation are final. Appeals via DM to a maintainer.

By participating you agree to our Code of Conduct: (CODE_OF_CONDUCT.md link)
```

---

## 6. Frequently Asked Questions

Pinned in `#start-here` (and mirrored in the repo).

```
❓ StreetJS FAQ

Q: What is StreetJS?
A: A TypeScript-first backend framework with a minimal, carefully curated
   dependency footprint, a modular plugin architecture, verified/signed releases,
   and enterprise-oriented features (Redis Cluster, PostgreSQL HA, Docker, a
   modern CLI). It follows an RFC-driven process and a stable 1.x line.

Q: How do I get started?
A: Read the quickstart in the docs (link) and scaffold an app with the CLI:
   `npx @streetjs/cli create my-app`. Then see the guides for auth, jobs,
   observability, and deployment.

Q: How can I contribute?
A: Read CONTRIBUTING.md, pick a `good first issue`, and open a PR. Say hi in
   #contributors if you'd like a pointer. First merged PR earns the Contributor role.

Q: Where do I report bugs?
A: On GitHub Issues (link). #help is for usage questions; confirmed bugs become
   issues so they're tracked in the source of truth.

Q: How do I write a plugin?
A: See the plugin authoring guide (link) and #plugin-authors. Plugins are separate
   packages built against the plugin architecture.

Q: Is StreetJS production-ready?
A: It ships a stable 1.x line with signed releases, HA data clients, and CI/CD
   automation. Start with the production deployment checklist in the docs and
   tell us about your experience — real-world feedback shapes the roadmap.

Q: How do I report a security vulnerability?
A: Follow SECURITY.md for private disclosure. Do not post vulnerabilities in public
   channels.

Q: Where does discussion become a decision?
A: Discord is for real-time discussion; decisions land on GitHub as Issues, RFCs,
   or docs so they're durable and searchable.
```

---

## 7. Pinned Messages (per channel)

Copy-ready. One pin per channel keeps intent obvious.

**`#announcements`**
```
📣 Official StreetJS announcements: releases, security notices, RFCs, and events.
Read-only. Click "Follow" to mirror these into your own server. Discussion of any
post goes in the linked thread or the relevant channel.
```

**`#general`**
```
👋 General StreetJS conversation and introductions. Keep support questions in #help
so they stay searchable and get answered faster. Be kind and precise.
```

**`#showcase`**
```
🚀 Built something with StreetJS? Share it here: a link + one or two sentences on
what it does and which StreetJS features you used. Feedback encouraged; keep it
constructive.
```

**`#help`** (Forum — set as the guidelines / post template)
```
🛠 Getting help fast:
1. One question per thread. Give the thread a clear title.
2. Include: StreetJS version, Node version, OS, and a MINIMAL reproduction.
3. Paste code/errors in code blocks (```), not screenshots of text.
4. Say what you expected vs. what happened.
5. Mark the thread solved (or react ✅) when it's resolved — it helps the next person.
Confirmed bugs get moved to GitHub Issues so they're tracked.
```

**`#deploy-and-ops`**
```
⚙️ Production topics: Docker, Kubernetes, PostgreSQL HA, Redis Cluster,
observability (/metrics, health probes, OpenTelemetry), scaling, and upgrades.
Start from the production deployment checklist in the docs (link).
```

**`#contributors`**
```
🤝 Coordinate contributions here. Start with CONTRIBUTING.md and the
`good first issue` label (link). Discuss approach before large PRs. First merged
PR earns the Contributor role. GitHub is where PRs and reviews happen.
```

**`#plugin-authors`**
```
🧩 Building a StreetJS plugin? See the plugin authoring guide (link). Share design
questions and WIP here; announce published plugins via a maintainer for
#announcements. Follow the plugin security expectations documented in the repo.
```

**`#rfcs-and-design`**
```
🧠 Architecture and RFC discussion. Explore ideas here, but proposals become real
as RFCs on GitHub (link) — that's where decisions are recorded. Link the RFC/PR
you're discussing.
```

**`#ci-releases`**
```
🔧 Release engineering: lockstep versioning, signing/provenance, CI/CD. Mostly
maintainer coordination. Release mechanics live in scripts/ and the workflows.
```

**`#github-activity`**
```
🔔 Curated GitHub activity (releases, merged PRs, notable issues). Read-only and
intentionally low-noise. Full history lives on GitHub.
```

---

## 8. Announcement Templates

Reusable, fill-in-the-blanks. Keep them short and link to GitHub for detail.

**Release**
```
🚀 StreetJS v{X.Y.Z} released

Highlights:
• {one-line highlight}
• {one-line highlight}

Install/upgrade: `npm i streetjs@{X.Y.Z}` (signed, with provenance)
Changelog: {link}   ·   Release: {link}

Questions or issues after upgrading? → #help / GitHub Issues.
```

**Security update**
```
🔒 Security update — StreetJS {package}@{version}

A {severity} issue has been fixed. Please upgrade to {version}.
Advisory: {GitHub Security Advisory link}

We follow coordinated disclosure — details are in the advisory. Report
vulnerabilities privately via SECURITY.md, never in public channels.
```

**RFC**
```
🧠 New RFC: {title} (RFC-{NNNN})

Summary: {one or two sentences}
We're gathering feedback before a decision. Read and comment on GitHub: {link}
Discuss here in #rfcs-and-design; the RFC thread on GitHub is where it's decided.
```

**Documentation update**
```
📖 Docs: {what changed}

New/updated: {page name} → {link}
Feedback welcome in #help or open a docs issue/PR on GitHub.
```

**Community event**
```
📅 {Event name} — {date, time with timezone / UTC}

{One-line description.} Where: {voice channel / link}
Add to calendar: {link}. No sign-up needed — just show up.
```

**Contributor recognition**
```
🌟 Thank you, {@user}!

For {merged PR / triage help / plugin / great answers in #help}: {link}.
Community contributions like this are how StreetJS gets better. 🙌
```

**New plugin**
```
🧩 New community plugin: {name}

{One line on what it does.}
Package: {npm link}   ·   Repo: {link}   ·   Author: {@user}
Community-maintained (not an official package). Try it and share feedback.
```

---

## 9. GitHub → Discord Integration

Goal: **useful signal, zero fatigue.** Route noisy events away from conversation
channels and curate hard.

**Recommended (post to `#github-activity`, read-only):**
| Event | Include? | Why |
|---|---|---|
| Releases published | ✅ | High-value; also cross-post to `#announcements`. |
| New GitHub Releases / tags | ✅ | Signed release visibility. |
| Merged PRs | ✅ (title only) | Shows momentum; low volume. |
| New issues opened | ◑ optional | Useful early; mute if it gets loud. |
| New RFC PRs (label `rfc`) | ✅ | Feed `#rfcs-and-design` awareness. |

**Do NOT pipe into Discord:**
- Every push/commit, every comment, CI logs, label changes, or per-check status.
  These drown conversation and train people to ignore the channel.

**How:** use the GitHub-maintained webhook or a single well-scoped bot, filtered to
the events above. Prefer **one** curated feed channel over many. For `#ci-status`,
post only the final result of the release/publish workflow, not every job.

**Announcements that matter (releases, security) are posted by a human** in
`#announcements` — a short, framed message beats a raw webhook.

---

## 10. Recommended Bots

Fewer, well-maintained bots. Each must justify its presence and its permissions.

| Bot | Use | Why it's worth it |
|---|---|---|
| **GitHub** (official webhook / GitHub bot) | The `#github-activity` feed. | First-party, reliable, no third-party trust needed. Scope to the few events in §9. |
| **Carl-bot** *or* **YAGPDB** (pick one) | Reaction roles, welcome/rules screening, autorole for New Member, simple automod. | Mature, well-documented, covers onboarding + light moderation without custom code. Use one, not both. |
| **MEE6-free / Statbot** *(optional)* | Lightweight membership/activity stats. | Only if you'll actually use the numbers; otherwise skip. |

**Deliberately avoided:** leveling/XP games, music bots, meme/economy bots, and
anything requesting Administrator. They add noise and attack surface with no
benefit to a technical community.

**Rules for bots:** least-privilege scopes (no Admin), enable their audit logging
into `#mod-log`, and review permissions whenever a bot updates.

---

## 11. Moderation Guidelines

Practical, proportionate, and documented.

**Principles**
- Assume good faith; most problems are newcomers not knowing norms.
- Moderate behavior, not disagreement. Technical debate is welcome; disrespect is not.
- Be transparent: log actions in `#mod-log`; explain removals briefly.

**Escalation ladder**
1. **Nudge** — a friendly public or DM pointer to the right channel/rule.
2. **Warn** — explicit warning referencing the rule; note it in `#mod-log`.
3. **Timeout** — short mute (e.g. 1–24h) for repeated or heated behavior.
4. **Kick** — for continued disruption after warnings.
5. **Ban** — for harassment, hate speech, spam/scams, doxxing, or safety threats
   (often immediate for these — no ladder required).

**Immediate-removal offenses:** hate speech, harassment, sexual content involving
minors, doxxing, scams/phishing, malware, and coordinated spam. Ban first, discuss
in `#maintainers` after.

**Operational norms**
- Two moderators should be reachable across primary time zones before growth.
- Keep a saved-response set for common cases (wrong channel, ask-to-ask, screenshot
  of code, security-in-public).
- Never handle security disclosures in public — redirect to SECURITY.md and delete
  any posted exploit details.
- Conflicts of interest: a maintainer involved in a dispute recuses; another handles it.

**Saved responses (examples)**
```
👋 Great question — could you move this to #help as a new thread with your StreetJS
+ Node versions and a minimal repro? You'll get a faster, more findable answer.
```
```
🔒 Please don't post security details here. Report privately via SECURITY.md so we
can fix and disclose responsibly. I'm removing the details above.
```

---

## 12. Contributor Journey

A clear, earned path. Recognition is explicit and tied to real contribution.

```
Community Member
   │  asks/answers in #help, joins discussions, files good issues
   ▼
Contributor            ← first merged PR (docs, tests, fix, or feature)
   │  keeps contributing; reliable PRs; helps triage; good reviews
   ▼
Regular Contributor    ← sustained, quality contributions over time; trusted judgment
   │  mentors newcomers; shapes RFCs; owns areas informally
   ▼
Maintainer             ← invited by existing maintainers; merge rights + release duties
```

| Stage | How you get there | What changes |
|---|---|---|
| **Community Member** | Join, participate. | Full chat access after onboarding. |
| **Contributor** | Land your first PR. | `Contributor` role; thanked in `#announcements`. |
| **Regular Contributor** | Sustained, high-quality contributions; helpful in reviews and `#help`. | Trusted voice in `#rfcs-and-design`; may get triage rights on GitHub. |
| **Maintainer** | Invitation after demonstrated trust, judgment, and consistency (per the project's governance/CHARTER). | GitHub merge rights, release/signing duties, `Maintainer` role, `#maintainers` access. |

**Principles:** promotion is by demonstrated trust, not volume alone. The path is
transparent and documented in `CONTRIBUTING.md`/governance so anyone can see how to
grow. Maintainer is a responsibility (reviews, releases, stewardship), not a badge.

---

## 13. Community Growth Plan

Bias toward **technical substance** over social chatter. Sustainable cadence.

**Weekly**
- **Triage sweep:** a maintainer converts resolved `#help` threads into docs/issues
  (see §14) and posts one "TIL / gotcha of the week" from real questions.
- Welcome new members in `#general`; point them to `#start-here`.
- Highlight one `good first issue` in `#contributors`.

**Monthly**
- **Community call / office hours** (voice): roadmap notes, demos, live Q&A. Post
  notes afterward in `#announcements` and the repo.
- **Showcase roundup:** feature a project or plugin from `#showcase`.
- **Contributor recognition** post for the month's merged PRs and top helpers.

**Quarterly**
- **RFC review:** surface open RFCs, invite structured feedback, summarize decisions.
- **Docs/examples sprint:** a themed push (e.g. "auth", "deploy", "observability")
  turning the quarter's most-asked questions into guides/examples.
- **State of StreetJS:** short written update — what shipped, what's next, how to
  help. Written, linkable, honest about what's not done.

**Encourage discussion, not noise:** prompts like "share a production gotcha you
hit and how you solved it", "post your `street.config` and get feedback", or
"what's one DX rough edge?" These generate issues and docs, not just reactions.

---

## 14. Documentation Workflow (Discord → durable knowledge)

Discord conversations are ephemeral; GitHub is durable. Convert the good stuff.

**The loop**
1. **Notice repetition.** If a question in `#help` appears 2–3 times, it's a docs gap.
2. **Classify the outcome:**
   | Signal in Discord | Convert to |
   |---|---|
   | "How do I do X?" answered well | **Docs** update or a new task-oriented guide |
   | "X is broken / behaves wrong" (confirmed) | **GitHub Issue** with the repro |
   | "X should work differently / new capability" | **RFC** (or a discussion that leads to one) |
   | "Here's a neat pattern" | **Example** in `examples/` or a short tutorial |
3. **Capture the source.** Link the Discord thread in the issue/PR for context
   (thread stays as the informal record; GitHub becomes the source of truth).
4. **Close the loop.** When the docs/issue/example lands, reply in the thread with
   the link and mark it solved. The next person finds the durable answer.

**Ownership:** the weekly triage sweep (see §13) makes this a habit, not heroics.
A `docs` and `good first issue` label on the resulting issue invites contributors
to write the fix — turning support load into contributor onboarding.

**Rule of thumb:** *answer once in Discord, then make sure no one has to ask again.*

---

## 15. Launch Checklist

**Before launch**
- [ ] Finalize channels, categories, and order (§1); delete anything speculative.
- [ ] Create roles with least-privilege permissions (§2); only Founder has Admin.
- [ ] Configure Membership Screening + `#rules`; set `@everyone` to read-only in
      START HERE / FEEDS.
- [ ] Pin welcome (§4), rules (§5), FAQ (§6), and per-channel pins (§7).
- [ ] Set up `#help` as a Forum with the post template (§7).
- [ ] Add + scope bots (§10); route the GitHub feed to `#github-activity` (§9).
- [ ] Verify links: docs, quickstart, repo, CONTRIBUTING.md, SECURITY.md,
      CODE_OF_CONDUCT.md, governance/CHARTER.
- [ ] Recruit at least 2 moderators/maintainers across time zones.
- [ ] Enable `#mod-log` + bot audit logging.
- [ ] Add the invite (https://discord.gg/Wgazap3yv) to README, docs site, and repo
      "Community" section.

**Launch day**
- [ ] Post the first `#announcements` message (what the server is for; link docs & repo).
- [ ] Seed `#help`, `#contributors`, and `#showcase` with 1–2 starter threads so
      they're not empty.
- [ ] Have maintainers present for the first several hours to greet and answer.
- [ ] Announce the server from the repo/README and any existing channels.

**First 30 days**
- [ ] Reply to every `#help` thread within ~24h; mark solved.
- [ ] Run the weekly triage sweep; ship at least a few docs/issue conversions (§14).
- [ ] Hold the first community call; publish notes.
- [ ] Grant the first `Contributor` roles and thank contributors publicly.
- [ ] Tune the GitHub feed if it's too noisy or too quiet.

**First 100 members**
- [ ] Confirm onboarding still lands people in the right channel quickly; refine pins.
- [ ] Identify 1–2 emerging **Community Helpers**; grant the role.
- [ ] Establish a predictable monthly call + recognition rhythm.
- [ ] Start the quarterly docs/examples sprint backlog from real questions.

**First 500 members**
- [ ] Re-evaluate channel split only where consistently noisy (e.g. split `#help`
      by topic, or add a language channel) — resist premature fragmentation.
- [ ] Grow the moderator/maintainer pool ahead of load; document rotation.
- [ ] Formalize contributor → maintainer pathway per governance.
- [ ] Review bot permissions and moderation norms; publish a short "how this
      community works" note.

---

*GitHub remains the source of truth for issues, PRs, RFCs, docs, and the roadmap.
Discord is where the community helps each other in real time and turns
conversations into durable improvements. Keep it simple, keep it kind, keep the
signal high.*
