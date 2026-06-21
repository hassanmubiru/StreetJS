# StreetJS Phase 18 — Ecosystem Expansion & Adoption Execution Plan

> Execution-focused. Workstream 1 is **IMPLEMENTED** in this commit; the rest are
> scoped specs with schemas, folder structures, and scoring. Constraints honored:
> GitHub Pages + npm + current monorepo, solo-maintainer realistic, no new infra,
> no framework rewrites. Tags: VERIFIED · GAP · IMPLEMENTED · RECOMMENDATION.
>
> Scoring legend per initiative — Impact (H/M/L), Effort (H/M/L), Adoption/
> Community/SEO/Enterprise effect (0–5), Priority (P0/P1/P2).

---

## Workstream 1 — Plugin Marketplace — IMPLEMENTED

Shipped in this commit (not just specified):

- **Data model / build-time generation** — `scripts/gen-plugins-data.mjs` reads
  every `packages/plugin-*/package.json` (name, description, version, keywords),
  infers a category, and writes `docs/_data/plugins.json` (19 plugins, 8
  categories). Dependency-free; re-runnable; safe in CI before `jekyll build`.
- **Marketplace page** — `docs/plugins/marketplace.md` at `/plugins/marketplace/`.
  Server-rendered cards from `site.data.plugins` (so content is in the HTML and
  **indexable**), plus client-side search + category filter (vanilla JS, no
  framework, GitHub-Pages-safe).
- **SEO** — JSON-LD `ItemList` of all plugins; descriptive `<title>`/meta;
  internal links to each npm package; entered the sitemap (public page).
- **Discoverability wiring** — added "Plugins" to the top-nav `aux_links`, pointed
  the homepage Ecosystem "Plugins" card at the marketplace, and linked it from the
  plugin-system page (`/plugins/`).

**Plugin metadata model** (per entry in `plugins.json`):
```
{ name, slug, title, description, version, category, tier, npm, keywords[] }
```
Categories: Database · Cache & KV · Messaging · Storage · Payments ·
Auth & Identity · Communications · AI.

**Verification/tier system:** every official plugin is `tier: "Official"` (signed
manifest — VERIFIED). When community plugins arrive, extend `tier` to
`Verified | Community` sourced from `docs/ecosystem/plugin-certification.md`.

**Folder structure (added):**
```
scripts/gen-plugins-data.mjs        # generator (source of truth = packages/)
docs/_data/plugins.json             # generated data (committed)
docs/plugins/marketplace.md         # /plugins/marketplace/ page
```

**Rollout / keep-fresh:** re-run `node scripts/gen-plugins-data.mjs` on any plugin
add/version change (RECOMMENDATION: add it as a step in `pages.yml` before build,
or to the release flow, so the data never drifts).

**Next iterations (RECOMMENDATION):** per-category landing pages
(`/plugins/category/<slug>/`) for long-tail SEO; per-plugin detail pages with
install snippet + scorecard; "community plugins" section once `street generate
plugin` (Phase 17 / CLI-EVOLUTION) lands.

| Initiative | Impact | Effort | Adopt | Comm | SEO | Ent | Priority |
|---|---|---|---|---|---|---|---|
| Marketplace page (done) | H | M | 5 | 3 | 5 | 3 | P0 |
| Category landing pages | M | M | 3 | 2 | 5 | 1 | P1 |
| Per-plugin detail + scorecard | M | M | 4 | 3 | 4 | 3 | P1 |

---

## Workstream 2 — SaaS Starter — SPEC (P0)

`street create my-app --starter saas` — additive, non-breaking (default template
unchanged). Composes existing generators + official plugins; no new framework code.

**Features:** email/password + sessions auth, organizations, teams, roles,
permissions (RBAC), invitations, dashboard, settings, **billing placeholders**
(Stripe webhook handler stubbed), audit logs, notifications.

**Database schema (PostgreSQL):**
```
users(id, email, password_hash, created_at)
organizations(id, name, slug, owner_id, created_at)
memberships(id, org_id, user_id, role)           -- role ∈ owner|admin|member
invitations(id, org_id, email, role, token, expires_at, accepted_at)
roles/permissions  -- code-defined RBAC (core guards), persisted overrides optional
subscriptions(id, org_id, plan, status, stripe_customer_id, current_period_end)
audit_logs(id, org_id, actor_id, action, target, meta_json, created_at)
notifications(id, user_id, type, payload_json, read_at, created_at)
```

**API structure (modules):** `auth`, `orgs`, `members`, `invitations`, `billing`,
`audit`, `notifications`, `settings` — each a controller + service + repository
(via `street generate`).

**Folder structure:**
```
my-app/
  src/{modules/*, entities/*, middleware/*, main.ts}
  web/                 # Next dashboard (reuses --frontend next scaffold)
  migrations/  seeds/
  .github/workflows/ci.yml
```

**Frontend (Next):** auth pages, org switcher, team/members, settings, billing
(placeholder), audit log viewer.

**Onboarding flow / tutorial roadmap:** (1) `create --starter saas` → (2) run +
sign up → (3) create org + invite → (4) wire Stripe test keys → (5) deploy
(Docker). Each step = one docs page; the series doubles as Content Engine material.

**Test gate:** scaffold → `npm install` → `npm run build` integration test added
to the explicit lists in `packages/cli/package.json` (coverage ≥85% branches).

| Initiative | Impact | Effort | Adopt | Comm | SEO | Ent | Priority |
|---|---|---|---|---|---|---|---|
| SaaS starter | H | L | 5 | 3 | 4 | 3 | P0 |
| AI starter | H | M | 5 | 2 | 3 | 1 | P1 |
| Realtime starter | M | M | 4 | 3 | 3 | 1 | P1 |

---

## Workstream 3 — Community Growth — SPEC (P0/P1)

**GitHub Discussions** (GAP → enable + seed): categories — Announcements (locked),
Q&A, Ideas, Show & Tell, Plugins, Help. Moderation: CODE_OF_CONDUCT applies;
maintainer triage rotation; spam auto-lock. Engagement: weekly triage, monthly
"what shipped" post, convert good Q&A → docs FAQ.

**Contributor program (levels):**
```
User           → uses StreetJS
Contributor    → ≥1 merged PR / accepted doc
Plugin Author  → published a Verified plugin (street generate plugin)
Maintainer     → review rights in an area (per GOVERNANCE)
Core Maintainer→ release + governance rights
```
Recognition: CI-generated contributors wall on `/community/` (static JSON, Pages-safe).

**Good First Issues — 25 ideas** (each maps to a real Phase-17/18 gap; mentorship =
maintainer assigned where noted):
1. `street generate module` (S, mentor) — DX parity
2. `street generate guard` (S)
3. `plugin search` CLI (M, mentor)
4. `plugin info` CLI (S)
5–10. OAuth presets: GitHub, Google, Microsoft, LinkedIn, Discord, Telegram (M each, mentor)
11. `@streetjs/plugin-resend` email (S)
12. `@streetjs/plugin-algolia` (S)
13. Marketplace category landing pages (M)
14. Per-plugin detail page generator (M)
15. Contributors wall generator (S)
16–18. Showcase write-ups for `01-rest-api`, `04-realtime-chat`, `06-multiplayer` (S each)
19. Todo/Blog/Notes beginner tutorials (S, mentor)
20. Migration guide: Express→StreetJS sample (M)
21. Docs: search adapter (Meili/Elastic) how-to (S)
22. Add `street generate plugin` scaffold (M, mentor)
23. OpenTelemetry quickstart doc (S)
24. K8s deploy walkthrough using existing manifests (M)
25. Accessibility/i18n pass on docs components (S)

| Initiative | Impact | Effort | Adopt | Comm | SEO | Ent | Priority |
|---|---|---|---|---|---|---|---|
| Enable + seed Discussions | M | L | 2 | 5 | 1 | 1 | P0 |
| 25 good-first-issues + labels | M | L | 2 | 5 | 1 | 1 | P0 |
| Contributors wall | L | L | 1 | 4 | 1 | 1 | P1 |
| Contributor ladder docs | L | L | 1 | 3 | 1 | 2 | P1 |

---

## Workstream 4 — Content Engine (12-month) — SPEC (P0)

Solo-maintainer-sustainable: **one deep piece/week**, atomized across channels.

| Platform | Pillars | Cadence | KPI | 12-mo target | Funnel role |
|---|---|---|---|---|---|
| Dev.to | how-to, internals | 2/mo | reads, follows | 10k reads | top-of-funnel → docs |
| Hashnode | deep technical | 1/mo | reads, devs | 6k reads | authority |
| Medium | cross-post canonical | 1/mo | reads | reach | syndication |
| Reddit (r/node, r/typescript) | show-and-tell, AMAs | 1–2/mo | upvotes, clicks | qualified clicks | discovery |
| LinkedIn | founder build-in-public | 1/wk | impressions | 200k impressions | trust/enterprise |
| X | release threads, micro-demos | 3/wk | clicks to docs | 5k clicks | launches |
| YouTube | tutorials, deep-dives | 2/mo | watch-time, subs | 1k subs | retention |

**Repurposing workflow:** 1 deep article → 1 video → 1 LinkedIn post → 5 X posts →
1 Reddit show-and-tell. Every asset links a canonical docs URL (indexed referral).
**Evidence rule:** only publish MEASURED numbers; never estimate performance.

| Initiative | Impact | Effort | Adopt | Comm | SEO | Ent | Priority |
|---|---|---|---|---|---|---|---|
| "2 deps / native drivers" series | H | L | 5 | 3 | 5 | 2 | P0 |
| Release-thread template (X/LinkedIn) | M | L | 3 | 3 | 2 | 1 | P1 |
| YouTube create→deploy | H | M | 5 | 2 | 3 | 1 | P1 |

---

## Workstream 5 — Enterprise Readiness — SPEC (P1)

**Security & Trust Center** (`/trust/` page — assembles VERIFIED artifacts):
SECURITY.md, THREAT-MODEL, CycloneDX SBOM, npm provenance, OpenSSF Scorecard,
CodeQL, signed plugin manifests, GOVERNANCE, RFC. Nav: top-level "Trust" link.

**Compatibility matrix** (new doc/table): Node 20/22 (VERIFIED in CI matrix);
PostgreSQL/MySQL/MongoDB/SQLite versions tested; plugin ↔ core version ranges.

**LTS strategy:** formalize `docs/lts-policy.md` into Active / Maintenance / EOL
columns per major; release channels (latest, next); support windows; upgrade paths
(`street upgrade` + codemods, VERIFIED).

**Enterprise adoption checklist:** procurement (license MIT, SBOM, provenance),
security (disclosure policy, CodeQL, OpenSSF score), compliance (data residency =
self-host story; audit logs in SaaS starter).

| Initiative | Impact | Effort | Adopt | Comm | SEO | Ent | Priority |
|---|---|---|---|---|---|---|---|
| Security & Trust Center page | M | L | 2 | 1 | 2 | 5 | P1 |
| Compatibility matrix | M | L | 2 | 1 | 2 | 4 | P1 |
| LTS table + support matrix | L | L | 1 | 1 | 1 | 4 | P1 |

---

## Workstream 6 — Ecosystem Metrics & Positioning — SPEC

**North Star:** weekly active projects created (`street create` runs) — proxied by
CLI npm weekly downloads + new-repo telemetry-free signals (npm + GitHub).

| Metric | Definition | Collection | Target (12mo) | Cadence |
|---|---|---|---|---|
| Adoption | `streetjs` weekly npm downloads | npm API | 5k/wk | weekly |
| Adoption | `@streetjs/cli` weekly downloads | npm API | 1k/wk | weekly |
| Community | GitHub stars | GitHub API | +2k | weekly |
| Community | Discussions MAU + PRs/mo | GitHub | 20 PRs/mo | monthly |
| Plugin | official + community plugins | repo + registry | 25 (incl. 3 community) | monthly |
| Content | docs organic sessions | Search Console | 10k/mo | monthly |
| Content | indexed keywords in top 20 | Search Console | 50 | monthly |
| Enterprise | trust-center views + inquiries | Pages + email | track | quarterly |

**Competitive positioning (evidence-based):**

| vs | Compete? | Why |
|---|---|---|
| Express | Avoid head-on (ubiquity); position as "typed, integrated upgrade path" | migration guide |
| Fastify | Compete on integration (DI/ORM/auth/realtime built-in) — VERIFIED | feature breadth |
| NestJS | Compete on **dependency minimalism + native drivers** — VERIFIED | 2 runtime deps vs heavy tree |
| AdonisJS | Compete on TS-native + plugin signing + supply-chain rigor | provenance/SBOM |
| Hono | Avoid edge-router race; differentiate as full backend, not a router | scope |

**Unique positioning (defensible, VERIFIED):** "The integrated TypeScript backend
with native protocol drivers and a signed, dependency-free plugin ecosystem —
self-host the whole stack with 2 runtime dependencies." Avoid performance claims
unless MEASURED.

| Initiative | Impact | Effort | Adopt | Comm | SEO | Ent | Priority |
|---|---|---|---|---|---|---|---|
| Metrics dashboard (manual sheet) | M | L | 3 | 2 | 2 | 2 | P1 |
| Positioning/messaging doc | M | L | 4 | 2 | 3 | 2 | P1 |

---

## Final deliverables

### Top 10 initiatives (by composite ROI)
1. Plugin marketplace — **IMPLEMENTED (P0)**
2. SaaS starter (`--starter saas`) — P0
3. "2 deps / native drivers" content series — P0
4. Enable + seed GitHub Discussions — P0
5. 25 good-first-issues + labels — P0
6. `street generate plugin` (+ `plugin search/info`) — P1
7. AI starter — P1
8. Security & Trust Center page — P1
9. Marketplace category + per-plugin pages — P1
10. Compatibility matrix + LTS table — P1

### Top 3 to execute immediately
1. **Plugin marketplace** — done this commit; verify live + add category pages.
2. **SaaS starter** — the acquisition funnel; compose existing parts.
3. **Content series + Discussions** — distribution + a live community surface.

### 30-day roadmap
Marketplace live (done) → category landing pages + per-plugin pages → enable
Discussions + 25 GFIs + contributors wall → publish "2 deps" + native-driver
articles → Security & Trust Center page.

### 90-day roadmap
SaaS + AI starters shipped with tests → `street generate plugin` + `plugin
search/info` → OAuth presets plugin → release-thread cadence on X/LinkedIn →
compatibility matrix + LTS table.

### 180-day roadmap
Realtime/marketplace/CMS starters → community plugins reaching Verified → YouTube
series → dating-platform showcase → triage rotation + support SLAs.

### 365-day roadmap
Marketplace is the discovery hub (official + community) → multi-tenant enterprise
reference → annual roadmap RFC → measurable adoption (downloads/stars/sessions) up
and to the right.

### Success criteria
- Marketplace indexed in Search Console; ≥1 plugin page ranking. 
- `--starter saas` used in the wild; CLI downloads trending up.
- ≥3 community-contributed plugins reach Verified.
- Docs organic sessions ≥10k/mo; ≥50 keywords in top 20.
- Trust Center cited in ≥1 enterprise evaluation.

### Risks & mitigations
- **Solo-maintainer bandwidth** → atomized content workflow; mechanical GFIs;
  automate marketplace/contributors data.
- **Data drift** (marketplace) → wire `gen-plugDeploy succeeded (with the generator step). Let me verify the new category and detail pages are live and indexed.

ins-data.mjs` into CI/release.
- **SEO regression** → strict URL/JSON-LD/sitemap guardrails on every new page.
- **Dependency-free erosion** → policy gate on new plugins.
- **Over-building features** → this plan funds ecosystem leverage, not framework
  features; review every initiative against the North Star.
