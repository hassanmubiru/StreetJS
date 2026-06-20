# Requirements Document

## Introduction

The StreetJS documentation site (GitHub Pages, Jekyll + just-the-docs) needed a
homepage that reads like a modern framework website, a premium dark theme that no
longer feels harsh, code panels that render as a real editor surface in dark mode
across the whole site, and clean search-engine signals (sitemap + Search Console
verification). This spec captures the requirements for that body of work.

All changes are constrained to remain fully compatible with GitHub Pages and the
just-the-docs theme: no unsupported Jekyll plugins, no build that can only run
locally, and existing public URLs / SEO must be preserved.

## Glossary

- **Theme token**: a CSS custom property (e.g. `--bg`, `--text-secondary`) defined
  for `:root` (light) and `html[data-theme="dark"]` (dark).
- **Code panel**: any rendered code block surface (homepage hero example and all
  documentation code blocks, including line-number `rouge-table` blocks).
- **Internal doc**: a working report/audit/readme that exists in the repo but is
  not intended to be surfaced in search results.

## Requirements

### Requirement 1: Homepage redesign

**User Story:** As a first-time visitor, I want the homepage to present StreetJS
like a modern backend framework, so that I can quickly understand what it is and
how to start.

#### Acceptance Criteria
1. THE homepage SHALL present six sections in order: Hero, Code Example, Why
   StreetJS, Showcase, Ecosystem, and Final CTA.
2. THE hero SHALL show the headline "The TypeScript Framework for Modern Backend
   Applications", a subheadline covering APIs/auth/realtime/jobs/AI, and three
   CTAs: Get Started, Documentation, and GitHub.
3. THE hero SHALL include a `npx @streetjs/cli create my-app` command block with a
   copy-to-clipboard button that works on static GitHub Pages (inline JS).
4. THE code-example section SHALL show a `@Controller('/users')` TypeScript example
   accompanied by feature badges (Routing, Validation, ORM, Authentication, Realtime).
5. THE "Why StreetJS" section SHALL show six capability cards (Authentication,
   Realtime, Database & ORM, Background Jobs, AI Integrations, TypeScript First),
   each linking to a page that returns HTTP 200.
6. THE redesign SHALL NOT use marketing buzzwords or the phrase "batteries included",
   and SHALL NOT fabricate adopters, metrics, or unverifiable claims.
7. WHEN the redesign is published THE homepage front-matter (`permalink: /`, title,
   description) SHALL be preserved so the URL and SEO metadata do not change.

### Requirement 2: Premium dark theme

**User Story:** As a reader in dark mode, I want a soft, low-glare theme, so that
the site is comfortable and consistent with modern framework sites.

#### Acceptance Criteria
1. THE dark theme SHALL use cool-neutral surfaces (`--bg: #0B0F19`, `--surface:
   #111827`, `--surface-2: #1F2937`) and translucent borders/cards.
2. THE dark theme SHALL NOT use pure-white body text; body SHALL be `#9CA3AF`,
   primary text `#E5E7EB`, and headings `#F9FAFB` (a distinct `--heading` token).
3. THE filled (primary) buttons SHALL use a saturated accent fill with white text,
   not a light/white fill, and SHALL meet contrast requirements.
4. ALL foreground/background text pairs in dark mode SHALL meet WCAG AA (≥ 4.5:1).
5. THE theme SHALL continue to respect `prefers-color-scheme` and the existing
   `data-theme` toggle, and the light theme SHALL be visually unchanged.

### Requirement 3: Code panels in dark mode (site-wide)

**User Story:** As a reader, I want every code block to look like a dark editor in
dark mode, so that no light rectangle breaks the page.

#### Acceptance Criteria
1. WHEN dark mode is active THE code panels SHALL render on a dark surface
   (`#111827`, homepage hero frame `#0B1220`) with text `#D1D5DB`; no light/white
   rectangle SHALL remain.
2. THE fix SHALL cover all code-block structures: kramdown
   (`div.highlighter-rouge > div.highlight > pre.highlight`), Jekyll
   `{% highlight %}` (`figure.highlight > pre`), and line-number `rouge-table` blocks.
3. THE line-number `rouge-table` SHALL NOT inherit the site's data-table styling
   (borders, padding, zebra, hover); the gutter SHALL be a muted, unselectable rail.
4. THE syntax palette in dark mode SHALL be editor-grade and consistent site-wide:
   comments `#94A3B8`, keywords `#60A5FA`, decorators `#22C55E`, strings `#FBBF24`.
5. Existing syntax highlighting (functions, types, numbers) SHALL be preserved, and
   light-mode code SHALL be unchanged.

### Requirement 4: No light-gray leaks in dark mode

**User Story:** As a reader, I want no element stuck light in dark mode, so the
experience is cohesive.

#### Acceptance Criteria
1. THE top nav bar (`.main-header`), search field, search dropdown, and site-title
   hover SHALL follow the dark theme (no hardcoded light backgrounds/borders).
2. Data-table cells SHALL NOT render with a hardcoded white background in dark mode.
3. Theme defaults that hardcode light values (`.btn`, `.search-button`, `div.opaque`,
   skip-link, grey utility classes, `hr`) SHALL be bound to theme tokens.
4. THE generic `.btn` override SHALL NOT change the appearance of `.btn-primary` or
   colored button variants.

### Requirement 5: Clean sitemap

**User Story:** As a site owner, I want the sitemap to list only public pages, so
that search engines index the right content.

#### Acceptance Criteria
1. THE sitemap SHALL exclude internal docs (audits, reports, gap analyses,
   certification/hardening/readiness/verification docs, READMEs, SEO strategy,
   case-study templates, threat model) via `sitemap: false`.
2. Excluded internal docs SHALL also emit `<meta name="robots" content="noindex,
   follow">` so they are not indexed if crawled, while remaining reachable by URL.
3. THE sitemap SHALL remain valid (correct domain, `lastmod`, no duplicates) and be
   referenced by `robots.txt`.
4. Genuine public documentation (including plugin certification docs) SHALL remain
   in the sitemap.

### Requirement 6 — Google Search Console meta-tag verification

**User Story:** As a site owner, I want meta-tag verification on the homepage, so I
can verify the property in Search Console without relying only on the HTML file.

#### Acceptance Criteria
1. THE homepage SHALL emit `<meta name="google-site-verification" content="…">`
   using a configurable token.
2. WHEN the token is empty THE site SHALL emit no verification meta tag (no empty-tag
   bug), and the tag SHALL NOT appear on non-homepage pages.
3. THE verification key SHALL be configured so that `jekyll-seo-tag` does not also
   emit a duplicate tag site-wide.

### Requirement 7 — GitHub Pages compatibility (cross-cutting)

**User Story:** As a maintainer, I want all changes to build on GitHub Pages, so the
site keeps deploying.

#### Acceptance Criteria
1. THE changes SHALL NOT add unsupported Jekyll plugins and SHALL keep the
   just-the-docs theme.
2. THE changes SHALL preserve existing public URLs, permalinks, canonical tags,
   structured data, and the sitemap reference.
3. WHEN changes are pushed THE GitHub Pages deploy workflow SHALL succeed and the
   live site SHALL serve the updated output.
