---
layout: default
title: Tutorials & Examples Program
nav_order: 71
permalink: /adoption/tutorials-and-examples-program/
description: "StreetJS developer-education program — the tutorial curriculum, example-app catalog, full-stack examples, SEO strategy, and measurable 90/180/365-day adoption targets."
sitemap:     false
noindex:     true
---

{% include doc-styles.html %}

<div class="doc-header">
<span class="dh-label">Adoption</span>
<h1>Tutorials & Examples Program</h1>
<p>The plan, curriculum, and honest status for StreetJS developer education — built to grow adoption, stars, and production usage.</p>
</div>

This program targets the biggest remaining gap for StreetJS:
**adoption and developer education**. The framework is technically mature; what
moves the needle now is clear learning paths, runnable examples, and discoverable
content.

> **Honesty first.** This page distinguishes **Published** (live and verified
> against current APIs) from **Planned** (scheduled, not yet written). We add real,
> runnable content incrementally — we do not ship stub pages to inflate counts.
> See the [Adoption Scorecard](/adoption/adoption-scorecard/) for measured signals.

---

## Objectives

Grow developer adoption, GitHub stars, community contributions, production usage,
search visibility, and framework trust — by making StreetJS fast to learn,
evaluate, and ship with.

## Principles

- **Real APIs only.** Every snippet compiles against the current packages. No
  invented methods.
- **Runnable over theoretical.** Prefer `street create`-scaffoldable examples a
  reader can run in minutes.
- **Beginner-to-advanced ladder.** Each tutorial states level, time, and
  prerequisites, and links forward.
- **SEO-aware.** Every page has a unique title, meta description, and (for
  comparisons/FAQs) structured data.

---

## Part 1 — Tutorial curriculum

### Published

| Tutorial | Path |
|----------|------|
| Your First StreetJS API | [/tutorials/first-api/](/tutorials/first-api/) |
| Building a REST API (CRUD, pagination, OpenAPI) | [/examples/rest-api/](/examples/rest-api/) |
| PostgreSQL Integration | [/tutorials/postgresql/](/tutorials/postgresql/) |
| Authentication & Authorization (JWT, RBAC, MFA) | [/tutorials/auth/](/tutorials/auth/) |
| WebSockets & Realtime | [/tutorials/realtime/](/tutorials/realtime/) |
| Full-Stack with React | [/tutorials/fullstack-react/](/tutorials/fullstack-react/) |

### Planned (intermediate)

Multi-Tenant SaaS · Background Jobs & Queues · Event-Driven Architecture ·
Search with Meilisearch · File Uploads & Storage · AI Assistant with RAG ·
GraphQL API · Microservices.

### Planned (advanced)

High-Traffic API Design · Zero-Trust Security Architecture · Distributed Systems ·
Observability & Monitoring · Kubernetes Deployment · Enterprise RBAC & Audit
Logging · Building a Full Dating Platform.

Each planned tutorial currently routes readers to the closest existing
[guide](/), so no link is a dead end while standalone walkthroughs are written.

---

## Part 2 — Example application catalog

### Published / scaffoldable today

- **Reference pages:** [Todo API](/examples/todo-api/),
  [REST API](/examples/rest-api/), [WebSocket Chat](/examples/websocket-chat/),
  [File Upload](/examples/file-upload/).
- **One-command starters** via `street create --template`:
  `app`, `saas`, `ecommerce`, `realtime-chat`, `dating-app` — each adds domain
  packages + a starter module.

### Planned catalog

- **Starter:** Blog API · Notes App · URL Shortener · File Manager
- **Business:** CRM · ERP backend · Project Management · Booking System
- **Social:** Social Network · Dating Platform · Messaging · Community Forum · Live Streaming backend
- **Commerce:** Marketplace · Subscription Billing · Food Delivery backend
- **AI:** ChatGPT clone · AI Knowledge Base · AI Customer Support · AI Agent Platform

Priority order favors the most-requested, highest-traffic searches (Todo, Blog,
URL Shortener, SaaS, Chat) first.

---

## Part 3 — Full-stack examples

`street create --frontend <react|next>` scaffolds a backend + a typed frontend in
`web/`, wired with the published packages:

| Frontend | Package | Status |
|----------|---------|--------|
| React (Vite) | `@streetjs/client` + `@streetjs/react` | Published |
| Next.js (App Router) | + `@streetjs/next` | Published |
| Vue | `@streetjs/vue` | Published (scaffold planned) |
| Nuxt | `@streetjs/nuxt` | Published (scaffold planned) |

Each example demonstrates auth, API consumption, realtime, search, file uploads,
and AI — see [Full-Stack with React](/tutorials/fullstack-react/). UI kits
([`auth-ui`](https://www.npmjs.com/package/@streetjs/auth-ui),
[`ai-ui`](https://www.npmjs.com/package/@streetjs/ai-ui),
[`admin-ui`](https://www.npmjs.com/package/@streetjs/admin-ui)) provide
ready-made, accessible, dark-mode components.

---

## Part 4 — Documentation structure

The docs site already covers most sections (getting-started, guides, examples,
architecture, deployment, security, observability, enterprise, plugins,
migration, api-reference). This program adds **tutorials/** and **compare/** and
backfills tutorial-style depth. Page template:

> Overview · Prerequisites · Step-by-step · Code examples · Best practices ·
> Troubleshooting · Production considerations.

---

## Part 5 — SEO & discoverability

- **Comparison pages** (high-intent search): [vs Express](/compare/streetjs-vs-express/),
  [Fastify](/compare/streetjs-vs-fastify/), [NestJS](/compare/streetjs-vs-nestjs/),
  [Laravel](/compare/streetjs-vs-laravel/), [Django](/compare/streetjs-vs-django/) —
  each with an `FAQPage` JSON-LD block.
- **Per-page SEO:** unique `title` + `description` front-matter; `jekyll-seo-tag`
  and `jekyll-sitemap` are already enabled site-wide.
- **Indexes:** tutorial index, example index, and comparison index act as hubs for
  internal linking and crawlability.

---

## Part 6 — Measurable targets

Content volume targets. Progress is tracked against the
[Adoption Scorecard](/adoption/adoption-scorecard/); counts reflect
**published, runnable** content only.

| Horizon | Tutorials | Example apps | Migration / case studies |
|---------|-----------|--------------|--------------------------|
| 90 days | 20 | 15 | 5 migration guides |
| 180 days | 50 | 25 | 10 case studies |
| 12 months | 100 | 50 | 25 community examples |

### Current baseline (this program kickoff)

| Metric | Count | Notes |
|--------|-------|-------|
| Published tutorials | 6 | Beginner track complete |
| Comparison pages | 5 | Express, Fastify, NestJS, Laravel, Django |
| Runnable example pages | 4 | Todo, REST, Chat, File Upload |
| Scaffold templates | 5 | via `street create --template` |
| Migration guides | 3 | Express, Fastify, NestJS |
| Case studies | 0 | none verifiable yet (see scorecard) |

We will report progress honestly each quarter rather than claim targets met
prematurely.

---

## Contributing

Tutorials and examples are among the **highest-leverage contributions** to
StreetJS. Pick a Planned item above, follow the page template, ensure every
snippet runs against the current packages, and open a PR. See
[Contributing](/contributing/) and the [community path](/community/).
