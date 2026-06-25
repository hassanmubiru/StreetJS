# Website Evolution — StreetJS Phase 17 (Workstream E)

> Tags: **VERIFIED** · **GAP** · **RECOMMENDATION**. No SEO regressions allowed.

## Current state — VERIFIED

Live: https://hassanmubiru.github.io/StreetJS/ (Jekyll + just-the-docs, GitHub Pages).

- Homepage redesigned into a 6-section framework landing page (hero with copy
  command, code example + feature badges, Why StreetJS, Showcase, Ecosystem,
  Final CTA). — VERIFIED (this repo, `docs/index.md`)
- Premium dark theme, accessible (WCAG AA), site-wide dark code panels. — VERIFIED
- SEO foundation: sitemap (cleaned to public pages), `robots.txt`, JSON-LD
  (SoftwareApplication, Organization, FAQ, Breadcrumb, APIReference), canonical
  URLs, OpenGraph, Google Search Console **meta-tag verification on homepage**. — VERIFIED
- Existing IA: docs, examples, plugins, comparisons (`/compare/*`), security,
  showcase, community, roadmap, about. — VERIFIED

## Benchmark vs nextjs.org / react.dev / astro.build / nuxt.com

| Area | Leaders have | StreetJS | Verdict |
|---|---|---|---|
| Hero + value prop | ✓ | ✓ | VERIFIED |
| Live code example | ✓ | ✓ | VERIFIED |
| Feature grid | ✓ | ✓ | VERIFIED |
| **Ecosystem metrics** (downloads, stars, plugin count) | ✓ | partial (no live counters) | GAP |
| **Plugin marketplace** (searchable) | ✓ (Nuxt modules) | static list | GAP |
| **Starter catalog** | ✓ | none yet (Workstream B) | GAP |
| **Showcase gallery** (real apps w/ screenshots) | ✓ | 3 illustrative cards | GAP |
| **Testimonials** | ✓ | none (must stay factual) | GAP — only when real |
| Enterprise/trust hub | ✓ | security page exists | partial |
| Community hub | ✓ | `/community/` exists | partial |

## Plan (no SEO regression)

All additions are **new** pages/sections; **no existing URL is renamed**. Every
new page keeps front-matter (`permalink`, `description`), JSON-LD, and enters the
sitemap; internal-only pages stay `sitemap:false` + `noindex`.

### Homepage
- Stronger hero metric strip: **20+ official plugins · 2 runtime deps · MIT** —
  use only VERIFIED numbers (plugin count from repo, deps from package.json). RECOMMENDATION
- Real showcase section once Workstream C apps exist (replace illustrative covers).
- Enterprise trust strip linking the security/SBOM/provenance/OpenSSF signals.
- **No fabricated testimonials** — add a "Used by" section only when real adopters opt in.

### Ecosystem (`/ecosystem/`)
- **Plugin marketplace**: a generated, client-side-searchable index built from
  `packages/plugin-*/package.json` at build time (Jekyll data file → static JSON;
  no server, GitHub-Pages-safe). GAP → RECOMMENDATION
- **Starter catalog**: one card per `--starter` (Workstream B) with the
  one-command create snippet.
- **Showcase gallery**: real reference apps (Workstream C) with screenshots + source.

### Community (`/community/`)
- Surface contributors, Discussions, RFC index (`rfcs/` exists — VERIFIED), and
  the public roadmap (`docs/roadmap.md` exists — VERIFIED).

## SEO guardrails (must hold)
1. No page renames; add redirects via the existing custom `redirect` layout if a
   move is ever unavoidable.
2. Preserve `permalink`, canonical, JSON-LD, sitemap, OG on every touched page.
3. New marketplace/gallery JSON is a build artifact, not a route change.
4. Keep just-the-docs; no unsupported Jekyll plugins.

**RECOMMENDATION:** build the **plugin marketplace** page first — it converts the
already-shipped 20+ plugins (an under-marketed asset) into a discoverable,
SEO-indexable surface, with zero new framework code.
