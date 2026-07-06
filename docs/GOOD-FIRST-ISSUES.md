---
layout: default
title: "Good First Issues — curated backlog"
nav_exclude: true
description: "Good First Issues — curated backlog — StreetJS, the production-grade, memory-safe TypeScript backend framework for Node.js."
sitemap:     false
noindex:     true
---

# Good First Issues — curated backlog

A curated, **ready-to-file** backlog of scoped first contributions, derived from
the candidate list in `PHASE-18-EXECUTION-PLAN.md` (Workstream 3) and reconciled
against the **current** source state (stale candidates that have since shipped —
e.g. marketplace category pages and per-plugin detail pages — are removed).

> **How to use this file (the operational half of community recommendation R1):**
> 1. Sync the label manifest to the repo: apply `.github/labels.yml` with a
>    label-sync action or `gh label create`.
> 2. File each task below as an issue using the existing
>    [`mentored_task.yml`](.github/ISSUE_TEMPLATE/mentored_task.yml) template
>    (it pre-applies `good-first-issue` + `help-wanted` and enforces
>    acceptance-criteria, area, and mentorship fields).
> 3. Start with the lowest-effort, self-contained items so they survive
>    zero-mentor weeks (bus factor = 1 — see `MAINTAINERS.md`).

Effort: **S** ≈ a few hours · **M** ≈ a day or two. All are additive and require
no core framework changes.

## CLI

### 1. `street plugin info <name>` (S)
- **Now:** `packages/cli/src/commands/plugin.ts` implements `plugin:install` and
  `plugin:list` only.
- **Do:** add a read-only `plugin:info <name>` that prints a locally-installed
  plugin's manifest summary (name, version, capabilities, permissions, signature
  status).
- **Accept:** unit test over a fixture manifest; no network calls; `--help` text.

## Plugins (dependency-free HTTPS clients — follow the existing plugin pattern)

### 2. `@streetjs/plugin-resend` — transactional email (S)
- **Now:** no `packages/plugin-resend`. Email providers present: `sendgrid`.
- **Do:** mirror `packages/plugin-sendgrid` for Resend's REST API using
  `node:https` (no SDK). Include a signed `manifest.signed.json` per the plugin
  signing flow so the marketplace lists it as signed.
- **Accept:** send + error-path unit tests with a mocked HTTPS layer.

### 3. `@streetjs/plugin-algolia` — search (S)
- **Now:** no `packages/plugin-algolia`.
- **Do:** dependency-free index/query client for Algolia's REST API, following the
  established plugin structure + signed manifest.
- **Accept:** index + search unit tests with mocked HTTPS.

> Adding either plugin auto-appears in `/plugins/marketplace/` on the next
> `node scripts/gen-plugins-data.mjs` run — no manual marketplace edits.

## Docs & examples

### 4. Per-example walkthroughs (S, ×3)
- **Now:** `/showcase/` cards for REST API, Realtime Chat, and Multiplayer link to
  generic docs.
- **Do:** one focused walkthrough page each for `examples/01-rest-api`,
  `examples/04-realtime-chat`, `examples/06-multiplayer` (what it builds, how to
  run, key files). File as three separate issues.
- **Accept:** page builds in Jekyll; linked from the showcase card.

### 5. Beginner tutorials: Todo / Notes API (S)
- **Do:** a step-by-step "build a Todo API" tutorial on the SQLite default (zero
  config), reusing the `street create` scaffold.
- **Accept:** runnable end-to-end; commands copy-paste cleanly.

### 6. OpenTelemetry quickstart (S)
- **Do:** a short doc showing how to wire the built-in telemetry/observability to
  an OTLP collector, from existing core capabilities.
- **Accept:** config snippets verified against the current API.

### 7. Express → StreetJS migration guide (M)
- **Do:** a side-by-side guide mapping common Express patterns (routing,
  middleware, body parsing) to StreetJS equivalents, with a small runnable sample.
- **Accept:** sample builds; claims checked against current APIs.

### 8. Search adapter how-to (S)
- **Do:** document the PG full-text default and how to plug a Meilisearch/Elastic
  adapter behind the search interface.
- **Accept:** accurate to the current search surface.

### 9. Docs accessibility / i18n pass (S)
- **Do:** audit the docs components (color contrast, alt text, heading order,
  keyboard focus) and fix the low-hanging issues.
- **Accept:** documented before/after; no regressions to the Jekyll build.

## Community tooling

### 10. Contributors wall generator (S)
- **Now:** no `.all-contributorsrc`, no generator, no wall page (per
  `COMMUNITY-GROWTH-PLAN.md`).
- **Do:** a build-time script that reads contributor data (GitHub API or a static
  JSON) and renders a wall onto `/community/` — Pages-safe, mirroring the
  `gen-plugins-data.mjs` static-generation pattern.
- **Accept:** deterministic output committed; no runtime API dependency at serve time.

---

*Keep this list reconciled with source: before filing, confirm the "Now" line
still holds (some items may ship via other PRs). Remove an item once its issue is
filed and link the issue number here.*
