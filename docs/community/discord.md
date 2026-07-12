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
