# StreetJS Plugin Marketplace — Architecture & Status (Phase 18A)

> Tags: **VERIFIED** (built + live) · **IMPLEMENTED** (added this pass) · **GAP** ·
> **RECOMMENDATION**. Scoring per item: Impact (H/M/L) · Effort (H/M/L) ·
> Adoption/SEO/Community (0–5) · Priority (P0/P1/P2).
>
> **Headline:** the marketplace was largely built in earlier Phase-18 work and is
> **live**. This pass closes the per-page funnel gaps (Quick Start, Compatibility,
> Certification, Related Plugins) and documents the metadata schema, taxonomy,
> badge governance, and SEO model. No framework code added.

## What already ships — VERIFIED (live)

- **Discovery hub** at `/plugins/marketplace/` — server-rendered cards (indexable)
  + client-side search + category filter (vanilla JS; GitHub-Pages-safe). 
- **Build-time generator** `scripts/gen-plugins-data.mjs` → `docs/_data/plugins.json`,
  **wired into `pages.yml`** (regenerates on every deploy; trigger includes
  `packages/plugin-*/package.json`). Source of truth = the real packages.
- **9 category pages** `/plugins/category/<slug>/` and **20 detail pages**
  `/plugins/<slug>/`, all in the sitemap.
- **SEO**: `ItemList` JSON-LD on the hub, `SoftwareSourceCode` JSON-LD per plugin,
  internal linking, canonical URLs.
- **Discoverability wiring**: top-nav "Plugins" + homepage Ecosystem card.
- **Audit**: `ECOSYSTEM-PLUGINS-AUDIT.md` (Phase 1 inventory).

## Phase-by-phase status

| Phase | Spec | Status |
|---|---|---|
| 1 Ecosystem audit | inventory + classify | **VERIFIED** (`ECOSYSTEM-PLUGINS-AUDIT.md`) |
| 2 Marketplace IA | hub + categories | **VERIFIED** hub at `/plugins/marketplace/`; 9 data-driven categories |
| 3 Detail pages | Overview→Related | **IMPLEMENTED** — added Quick Start, Compatibility, Certification, Related Plugins |
| 4 Search | build-time, no infra | **VERIFIED** — client-side over generated data |
| 5 Badges | taxonomy + rules | **IMPLEMENTED** (taxonomy below); all official = Official+Signed |
| 6 Metadata standard | schema | **IMPLEMENTED** (schema below) |
| 7 SEO | JSON-LD/category/sitemap | **VERIFIED** + per-plugin JSON-LD |
| 8 Automation | build-time gen | **VERIFIED** (`gen-plugins-data.mjs` in CI) |
| 9 Adoption funnel | install→related | **IMPLEMENTED** — funnel sections on every detail page |

## Metadata schema (Phase 6)

Derived at build time from each `packages/plugin-*/package.json`; emitted into
`docs/_data/plugins.json`:

```jsonc
{
  "name": "@streetjs/plugin-stripe",   // npm name
  "slug": "stripe",                     // URL slug → /plugins/<slug>/
  "title": "Stripe",                    // display title
  "description": "…",                   // from package.json description
  "version": "1.0.2",                   // from package.json version
  "category": "Payments",               // inferred from keywords/name
  "catSlug": "payments",                // → /plugins/category/<catSlug>/
  "tier": "Official",                   // badge (see taxonomy)
  "npm": "https://www.npmjs.com/package/@streetjs/plugin-stripe",
  "keywords": ["stripe","payments",…]   // search index terms
}
```
**Source fields** (authored in `package.json`): `name`, `description`, `version`,
`keywords`. A package may set `"streetjs": { "unlisted": true }` to stay out of
the marketplace until published (used by the unpublished `@streetjs/plugin-htmx`).
**RECOMMENDATION (P2):** allow an optional `"streetjs": { "category": "…" }`
override for packages the keyword heuristic miscategorizes.

## Category taxonomy (Phase 2)

Active (data-driven, only categories with ≥1 plugin render): **Database ·
Cache & KV · Messaging · Storage · Payments · Auth & Identity · Communications ·
AI**. The spec also lists Observability, Developer Tools, Frontend Integrations,
Cloud, Security — **GAP**: these have no `plugin-*` packages yet (Observability is
in core, not a plugin). **RECOMMENDATION (P2):** add categories only when a real
plugin lands, to avoid empty pages (thin-content SEO risk).

## Verification badges (Phase 5) — governance

| Badge | Rule | Today |
|---|---|---|
| **Official** | Maintained by the core team in the monorepo, CI-tested | all 20 |
| **Signed** | Ships a verified Ed25519 manifest the host checks on load (derived from a committed `manifest.signed.json`) | 19/20 (`plugin-htmx` signing pending) |
| **Certified** | Passes the [certification checklist](/ecosystem/plugin-certification/) | program defined |
| **Verified** | Third-party, signed, passed security+compat+structure review | none yet (no community plugins) |
| **Community** | Third-party, well-formed signed manifest, unreviewed | none yet |
| **Experimental** | Pre-1.0 / unstable API | none yet |

**Governance:** badges are claims and must be earned — Verified/Certified require a
recorded review (see `docs/ecosystem/plugin-certification.md`). No self-asserted
Verified. This prevents misleading claims as community plugins arrive.

## Search strategy (Phase 4) — VERIFIED

Build-time `plugins.json` → server-rendered cards carry `data-cat` + `data-text`
(name+title+description+keywords). A ~20-line vanilla-JS filter does keyword +
category matching client-side. **No Algolia, no DB, no external API** — scales to
100+ plugins (static HTML + a tiny JSON). 

## SEO plan (Phase 7) — VERIFIED + RECOMMENDATION

- Hub: `ItemList` JSON-LD; detail: `SoftwareSourceCode` JSON-LD. — VERIFIED
- Category + detail pages each have a unique `title`/`description` and enter the
  sitemap. — VERIFIED
- Internal linking mesh: hub ⇄ category ⇄ detail ⇄ related. — VERIFIED/IMPLEMENTED
- **RECOMMENDATION (P1):** add a one-line unique intro per category page (reduce
  thin-content risk) — issue already seeded ("Marketplace: per-category SEO copy").

## Automation (Phase 8) — VERIFIED

`gen-plugins-data.mjs` runs in `pages.yml` before `jekyll build`; adding/bumping a
`plugin-*` package regenerates data + category + detail pages automatically. Clean
removal handled (output dirs are rebuilt each run).

## 30-day roadmap

| Initiative | Impact | Effort | Adopt | SEO | Comm | Priority |
|---|---|---|---|---|---|---|
| Detail funnel sections (done) | H | L | 4 | 4 | 2 | P0 ✓ |
| Per-category SEO intro copy | M | L | 2 | 5 | 1 | P1 |
| `streetjs.category` override field | L | L | 1 | 2 | 1 | P2 |
| Community/Verified badges (when 1st community plugin lands) | M | M | 2 | 2 | 5 | P1 |
| Downloads/last-release signal on cards (needs CI npm fetch) | M | M | 3 | 2 | 2 | P2 |

## Success metrics

- Marketplace + category + detail pages indexed in Search Console; ≥1 plugin page
  ranking for "streetjs <capability>".
- Plugin npm weekly downloads trend up; marketplace → npm referral clicks.
- ≥1 community plugin reaches Verified within 90 days.

## Go / No-Go

**GO — already shipped; this pass hardens it.** The marketplace converts the 20+
existing plugins into a discoverable, self-maintaining, SEO-indexed surface with a
full Discover→Install→Use→Related funnel on every page, entirely on GitHub Pages
with no external services. Remaining items (category copy, community badges,
download signals) are P1/P2 enhancements, not blockers.

| Overall | Impact | Effort | Adopt | SEO | Comm | Priority |
|---|---|---|---|---|---|---|
| Plugin Marketplace (live + hardened) | High | Low-Med | 5 | 5 | 3 | **P0 — GO** |
