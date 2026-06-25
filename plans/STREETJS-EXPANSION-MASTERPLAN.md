# StreetJS Expansion Masterplan — Phase 17

> Synthesis of Workstreams A–H. Every claim is grounded in the repo audit; tags:
> **VERIFIED · GAP · RECOMMENDATION**. Companion docs: `ECOSYSTEM-PLUGINS-AUDIT.md`,
> `STARTERS-ROADMAP.md`, `SHOWCASE-ROADMAP.md`, `CLI-EVOLUTION.md`,
> `WEBSITE-EVOLUTION.md`, `CONTENT-ROADMAP.md`, `COMMUNITY-ROADMAP.md`,
> `ENTERPRISE-READINESS.md`.

## Headline finding

StreetJS has **already built most of the ecosystem assets** competitors lack:
20+ signed, dependency-free official plugins (incl. Meilisearch, Elasticsearch,
OpenTelemetry, Kafka, RabbitMQ, Stripe, S3/R2), a 21-command CLI, a redesigned
SEO-optimized website, provenance + SBOM + OpenSSF release rigor, governance +
RFC process, and 6 runnable examples. The bottleneck is **not building more — it
is packaging, surfacing, and distributing what exists.**

## Current ecosystem score

Scores are relative to mature TS/backend ecosystems (Next/Nest/Nuxt/Laravel/Django).

| Dimension | Score /100 | Basis |
|---|---|---|
| Framework completeness | 90 | VERIFIED: core, ORM, auth, realtime, jobs, AI, OpenAPI |
| Plugin ecosystem (breadth) | 75 | VERIFIED 20+ official; GAP discovery/marketplace |
| Plugin ecosystem (community) | 25 | GAP: few/no external authors yet |
| CLI / DX | 80 | VERIFIED broad; small generate/plugin gaps |
| Starters | 30 | GAP: no domain starters (`--frontend` only) |
| Showcase | 45 | VERIFIED 6 examples; GAP tiered/advanced apps |
| Website / SEO | 80 | VERIFIED redesigned + verified GSC; GAP marketplace/gallery |
| Content / distribution | 25 | GAP: roadmap only, low cadence |
| Community activity | 35 | VERIFIED governance; GAP live surfaces |
| Enterprise readiness | 60 | VERIFIED supply-chain; GAP support/compat policy |
| **Overall** | **~55** | "framework built, ecosystem nascent" |

## Top opportunities
1. **Surface the 20+ plugins** as a searchable marketplace (huge under-marketed asset).
2. **SaaS starter** — highest-intent funnel; composes existing parts.
3. **`street generate plugin`** — compounds community ecosystem growth.
4. **Content engine on "2 deps / native drivers"** — defensible, searchable.
5. **Enterprise trust hub** — assembles already-VERIFIED artifacts.

## Top risks
1. **Marketing/code drift** — claiming "missing" features that already exist (this
   audit corrects several). Mitigation: VERIFIED-only messaging.
2. **Solo-maintainer bus factor** — community activity is the real gap; ecosystem
   growth depends on contributors, not features.
3. **Over-building** — adding framework features instead of ecosystem leverage.
4. **SEO regressions** from website expansion. Mitigation: strict URL/JSON-LD guardrails.
5. **Dependency-free invariant erosion** under plugin pressure. Mitigation: policy gate.

## Top 20 initiatives (ranked by composite ROI)

Impact axes scored L/M/H; Effort S/M/L. Composite = (Adoption+SEO+Community+Enterprise) ÷ Effort.

| # | Initiative | WS | Adoption | SEO | Community | Enterprise | Effort |
|---|---|---|---|---|---|---|---|
| 1 | Plugin marketplace page (build-time index) | E | H | H | M | M | M |
| 2 | SaaS starter (`--starter saas`) | B | H | H | M | M | L |
| 3 | `street generate plugin` | D | M | L | H | M | M |
| 4 | Content: "2 deps" + native-driver series | F | H | H | M | L | S |
| 5 | Enterprise trust hub page | H | M | M | L | H | S |
| 6 | OAuth presets plugin (GitHub/Google/MS) | A | H | M | M | M | M |
| 7 | Enable + seed GitHub Discussions | G | M | L | H | L | S |
| 8 | AI starter (`--starter ai`) | B | H | M | M | L | M |
| 9 | Tiered showcase learning path (repackage 6 examples) | C | M | H | M | L | S |
| 10 | Realtime starter | B | M | M | M | L | M |
| 11 | Starter catalog page | E | M | H | L | L | S |
| 12 | Contributors wall + good-first-issues (20) | G | L | L | H | L | S |
| 13 | LTS table + support matrix + compat policy | H | L | M | L | H | S |
| 14 | `street plugin search`/`info` | D | M | L | M | L | M |
| 15 | Dating-platform showcase (uses existing dating-* pkgs) | C | M | M | M | M | M |
| 16 | Discord + release bridge (plugin-discord) | A/G | M | L | H | L | M |
| 17 | `generate module/guard` | D | L | L | M | L | S |
| 18 | YouTube create→deploy + auth + realtime | F | H | M | M | L | M |
| 19 | Marketplace/CMS starters | B | M | M | L | L | L |
| 20 | Multi-tenant enterprise reference app | C/H | M | M | L | H | L |

## Roadmaps

### 30 days (surface & seed — mostly zero new framework code)
- Plugin marketplace page (#1), starter catalog stub (#11)
- Enable Discussions + 20 good-first-issues + contributors wall (#7, #12)
- Publish "2 deps" + native-driver content (#4); start X release threads
- Enterprise trust hub page (#5); LTS/support/compat docs (#13)
- Repackage 6 examples into a tiered showcase path (#9)

### 90 days (build the funnel)
- SaaS starter (#2) + AI starter (#8) shipped with integration tests
- `street generate plugin` (#3) + `plugin search/info` (#14)
- OAuth presets plugin (#6); Discord + release bridge (#16)
- First mentored RFC accepted; monthly community call

### 180 days (ecosystem flywheel)
- Plugin authors program + Verified certification at scale
- Realtime/marketplace/CMS starters (#10, #19); dating showcase (#15)
- YouTube series (#18); contributor ladder live
- Support SLAs + triage rotation

### 365 days (platform)
- Community plugins reach Verified tier in volume; marketplace is the discovery hub
- Multi-tenant enterprise reference (#20) + enterprise trust pack mature
- Annual roadmap RFC; maintainer elections; measurable adoption growth

## If StreetJS can only do 3 things next — highest ROI

1. **Ship the plugin marketplace page (Workstream E #1).** It converts the
   already-built, under-marketed 20+ plugins into a discoverable, SEO-indexable
   surface — maximum adoption + SEO + trust for the least new engineering.
2. **Ship the SaaS starter (`--starter saas`, Workstream B #2).** It is the
   highest-intent acquisition funnel and exercises auth + billing + teams +
   dashboard by composing parts that already exist.
3. **Launch the "2 dependencies / native drivers" content engine (Workstream F #4)
   + enable GitHub Discussions (Workstream G #7).** Distribution + a live
   community surface are the true bottleneck; this is the cheapest, most
   defensible growth lever and seeds contributor flow.

> Everything else is sequenced behind these three. The strategic shift for
> Phase 17 is explicit: **stop building the framework; start compounding the
> ecosystem around what is already VERIFIED to exist.**
