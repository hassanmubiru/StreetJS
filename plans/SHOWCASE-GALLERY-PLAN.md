# Showcase Gallery Plan — StreetJS Phase 18, Workstream C

> Planning document only. No source files were modified.
> Every finding is tagged **VERIFIED** / **GAP** / **RISK** / **RECOMMENDATION**.
> All claims cite real files/paths verified from source in this repo.

---

## Executive Summary

StreetJS already has a **stronger-than-expected** showcase foundation. The
showcase page (`docs/showcase.md`) features **6 reference-app cards**, and all 6
map to **real, runnable source** under `examples/01-rest-api` … `examples/06-multiplayer`
(41–192 lines of working code each). Every card has a working GitHub **Source**
link and an **illustrative SVG cover** that exists on disk
(`docs/assets/images/showcase/*.svg`). This is a credible, evidence-backed
gallery — not vaporware. — **VERIFIED**

The gap is **not** missing examples; it is **presentation maturity**. Measured
against Workstream C's "premium gallery" requirements, the showcase lacks:
real screenshots (covers are explicitly illustrative), architecture diagrams,
per-app stack breakdowns, difficulty filtering (Beginner/Intermediate/Advanced),
and a structured learning path. Two of the six cards also link to **generic docs
pages** rather than example-specific docs, and one card's docs page describes a
**different implementation** than its backing app. — **GAP / RISK**

A second, richer tier of runnable apps already exists but is **not featured on
the showcase**: `examples/reference-apps/` (ai-assistant, dating, ecommerce,
saas, realtime-chat), each with executable smoke tests and benchmarks. Surfacing
these is the single highest-ROI move available. — **VERIFIED / RECOMMENDATION**

The prior roadmap (`SHOWCASE-ROADMAP.md`, Phase 17) already proposed tiers and a
"repackage, don't rebuild" strategy but was **never implemented in the showcase
page itself**. This plan operationalizes that, using only examples that exist. — **VERIFIED**

**Bottom line:** the raw material for a premium gallery is present and verifiable.
The work is curation, presentation, and honest difficulty/learning-path framing —
not building new demos and not making unbacked claims.

---

## 1. VERIFIED Showcase / Example Inventory

### 1a. Showcase cards in `docs/showcase.md` (the 6 featured entries)

| Showcase card | Runnable source (verified path) | Source link | Docs link target | Cover image | Screenshot | Arch diagram | Stack breakdown | Feature list |
|---|---|---|---|---|---|---|---|---|
| REST API | ✅ `examples/01-rest-api/src/main.ts` (41 LOC) + `package.json`, `tsconfig.json`, README | ✅ GitHub `examples/01-rest-api` | ✅ `/examples/rest-api/` (`docs/examples/rest-api.md`) | ✅ `rest-api.svg` | ❌ illustrative only | ❌ (file-tree text only) | ⚠️ README endpoints only | ✅ in card + docs |
| JWT Authentication | ✅ `examples/02-jwt-auth/src/main.ts` (121 LOC) + README | ✅ GitHub `examples/02-jwt-auth` | ⚠️ `/security/` (generic page, not example-specific) | ✅ `jwt-auth.svg` | ❌ illustrative only | ❌ | ⚠️ README "Key Concepts" | ✅ in card + README |
| Background Jobs | ✅ `examples/03-background-jobs/src/main.ts` (192 LOC) + README | ✅ GitHub `examples/03-background-jobs` | ⚠️ `/examples/` (generic index, no dedicated page) | ✅ `background-jobs.svg` | ❌ illustrative only | ❌ | ⚠️ README "Key Concepts" + table | ✅ in card + README |
| Realtime Chat | ✅ `examples/04-realtime-chat/main.mjs` (98 LOC) + README | ✅ GitHub `examples/04-realtime-chat` | ⚠️ `/examples/websocket-chat/` (exists, but describes a DIFFERENT impl — see RISK-3) | ✅ `realtime-chat.svg` | ❌ illustrative only | ❌ | ⚠️ README inline code | ✅ in card + README |
| Live Dashboard | ✅ `examples/05-live-dashboard/main.mjs` (70 LOC) + README | ✅ GitHub `examples/05-live-dashboard` | ⚠️ `/realtime-channels/` (generic page) | ✅ `live-dashboard.svg` | ❌ illustrative only | ❌ | ⚠️ README inline code | ✅ in card + README |
| Multiplayer | ✅ `examples/06-multiplayer/main.mjs` (81 LOC) + README | ✅ GitHub `examples/06-multiplayer` | ⚠️ `/realtime-channels/` (generic page) | ✅ `multiplayer.svg` | ❌ illustrative only | ❌ | ⚠️ README inline code | ✅ in card + README |

**Verification notes:**
- All 6 example directories exist and contain real code (line counts confirmed via `wc -l`). — **VERIFIED**
- All 6 cover SVGs exist at `docs/assets/images/showcase/`. — **VERIFIED**
- `docs/showcase.md` explicitly states: *"Cover graphics are illustrative — run any app to see the real thing."* So there are **no real screenshots**. — **VERIFIED (GAP for screenshot requirement)**
- Both generic docs link targets exist (`docs/security.md`, `docs/realtime-channels.md`). The links are not broken — they are just not example-specific. — **VERIFIED**

### 1b. Doc-only examples under `docs/examples/` (no runnable app dir)

These have documentation pages but **no corresponding runnable directory** under
`examples/` — they are code-snippet walkthroughs, not clonable apps. — **VERIFIED**

| Docs page | Runnable source dir? | Status |
|---|---|---|
| `docs/examples/todo-api.md` | ❌ none | Doc-only (snippets) |
| `docs/examples/user-api.md` | ❌ none | Doc-only (snippets) |
| `docs/examples/file-upload.md` | ❌ none | Doc-only (snippets) |
| `docs/examples/streaming-query.md` | ❌ none | Doc-only (snippets) |
| `docs/examples/rest-api.md` | ✅ `examples/01-rest-api` | Backed by app |
| `docs/examples/websocket-chat.md` | ⚠️ `examples/04-realtime-chat` (different impl) | Partial match (RISK-3) |

> Note: `docs/examples/index.md` references templates like `ecommerce`, `saas`,
> `realtime-chat`, `dating-app` via `street create --template`. Those correspond
> to `examples/reference-apps/*` (see 1c), not to scaffolding verified in this audit.

### 1c. Runnable reference apps NOT featured on the showcase (`examples/reference-apps/`)

Per `examples/reference-apps/README.md`, each is runnable, has an executable
smoke test, and is wired into CI (`.github/workflows/reference-apps.yml`). These
directories exist on disk. — **VERIFIED (existence + README claims; smoke tests/benchmarks not re-run in this audit)**

| App (dir) | Built on | Stated smoke test | On showcase? |
|---|---|---|---|
| `reference-apps/realtime-chat` | `streetjs` (ChannelHub, WS) | 8 checks + benchmark | ❌ not featured |
| `reference-apps/ai-assistant` | `@streetjs/ai` | 5 checks (RAG, tools) | ❌ not featured |
| `reference-apps/ecommerce` | `@streetjs/commerce` | 3 checks | ❌ not featured |
| `reference-apps/saas` | `@streetjs/admin` | 3 checks (RBAC, audit) | ❌ not featured |
| `reference-apps/dating` | `@streetjs/dating-profiles` | 3 checks (matching) | ❌ not featured |

### 1d. MarzPay examples (separate workstream, exist on disk)

`examples/marzpay-checkout`, `-htmx`, `-next`, `-react`, `-saas`,
`-subscriptions` all exist with `src/`, `dist/`, `package.json`, README. — **VERIFIED**
These belong to the MarzPay integration workstream and are **out of scope** for
the Workstream C showcase gallery, but represent additional real demo material.

---

## 2. Gap Matrix vs Workstream C Requirements

| Workstream C requirement | Status | Evidence |
|---|---|---|
| **Screenshots** (real UI/output) | **GAP** | Covers are SVG illustrations; `docs/showcase.md` explicitly labels them "illustrative." No screenshots on disk. |
| **Architecture diagrams** | **GAP** | No diagram assets. `docs/examples/rest-api.md` has a text file-tree only; no rendered diagram for any app. |
| **Stack breakdowns** (packages/deps per app) | **GAP (partial)** | READMEs list "Key Concepts"/endpoints, but no structured per-card stack breakdown (packages used, deploy target). `SHOWCASE-ROADMAP.md` has draft stack columns, not surfaced on the page. |
| **Feature lists** | **VERIFIED (partial)** | Each card has a 1-line description; READMEs list endpoints/concepts. Adequate but not standardized. |
| **Source links** | **VERIFIED** | All 6 cards link to real GitHub `examples/0X-*` paths; all dirs exist. |
| **Difficulty filtering (Beginner/Intermediate/Advanced)** | **GAP** | `docs/showcase.md` has no difficulty badges or filter UI. Tiers exist only as a proposal in `SHOWCASE-ROADMAP.md`. |
| **Learning path** | **GAP** | No ordered learning path on the showcase. Tutorials exist (`docs/tutorials/`: first-api, auth, postgresql, realtime, fullstack-react) but are not linked into a showcase progression. |
| **Runnable source backing each entry** | **VERIFIED** | All 6 featured cards have real runnable code (1a). |

**Summary:** 2 of 8 requirements fully met (source links, feature lists),
1 partial (stack breakdown), 5 are gaps (screenshots, diagrams, difficulty
filtering, learning path, standardized stack breakdowns).

---

## 3. RISKs

- **RISK-1 — "Illustrative" covers can read as stock/marketing.** The covers are
  SVGs, not screenshots, and the page says so. For a *premium gallery* claim this
  is a credibility risk: a reviewer expecting real output sees generated art.
  *Severity: Medium.* Mitigation: capture real terminal/HTTP output or a minimal
  UI screenshot per app (the apps run and assert output, so capture is feasible).

- **RISK-2 — Two cards link to generic docs, implying depth that isn't there.**
  JWT Auth → `/security/`, Live Dashboard & Multiplayer → `/realtime-channels/`,
  Background Jobs → `/examples/`. A visitor clicking "Docs" lands on a general
  page, not a walkthrough of that specific app. *Severity: Medium.* This is an
  honesty/UX gap, not a broken link.

- **RISK-3 — Docs/code mismatch for Realtime Chat.** The card links to
  `docs/examples/websocket-chat.md`, which documents a **manual `rooms` Map +
  `chatHandler` gateway** implementation. The backing app
  `examples/04-realtime-chat/main.mjs` uses the **`ChannelHub`** abstraction.
  Same domain, different API surface. A user cloning the app and reading the doc
  gets divergent code. *Severity: Medium — credibility/confusion risk.*

- **RISK-4 — Featured set understates real capability.** The 6 featured apps are
  small (41–192 LOC); the richer `reference-apps/*` (with smoke tests +
  benchmarks) are **not** on the showcase. The gallery looks less mature than the
  codebase actually is. *Severity: Low (opportunity cost, not a defect).*

- **RISK-5 — Unverified performance claims if surfaced.** `reference-apps/README.md`
  cites throughput figures (e.g. "~115,000 deliveries/s"). These were **not
  re-run** in this audit. If promoted to the showcase, they must be labeled as
  machine-relative baselines (the README already does this) and not as marketing
  absolutes. *Severity: Medium if mishandled.*

---

## 4. Prioritized RECOMMENDATIONS

Each recommendation uses **only examples/tutorials that already exist**. None
fabricate demos. Ordering, ROI, adoption impact, and maintenance cost are noted.

### REC-1 — Add difficulty tiers + a learning path to the showcase page
Map existing assets into Beginner → Intermediate → Advanced and add an ordered
"start here → next" path. Proposed mapping using **only existing content**:

| Tier | Showcase entry (existing) | Backing source (verified) | Paired tutorial (existing) |
|---|---|---|---|
| **Beginner** | REST API | `examples/01-rest-api` | `docs/tutorials/first-api.md` |
| **Beginner** | JWT Authentication | `examples/02-jwt-auth` | `docs/tutorials/auth.md` |
| **Intermediate** | Background Jobs | `examples/03-background-jobs` | `docs/tutorials/postgresql.md` (PG-backed queue) |
| **Intermediate** | Realtime Chat | `examples/04-realtime-chat` | `docs/tutorials/realtime.md` |
| **Intermediate** | Live Dashboard | `examples/05-live-dashboard` | `docs/tutorials/realtime.md` |
| **Advanced** | Multiplayer | `examples/06-multiplayer` | `docs/tutorials/realtime.md` |

- **Implementation Order:** 1 (do first — pure presentation, zero new code).
- **ROI:** High — directly satisfies two Workstream C gaps (difficulty filtering + learning path) with markup-only changes to `docs/showcase.md`.
- **Adoption Impact:** High — newcomers get an obvious on-ramp.
- **Maintenance Cost:** Low — static metadata on existing cards.

### REC-2 — Standardize a per-card "stack breakdown" block
For each of the 6 cards add a small, factual block: packages used, runtime,
persistence, deploy target. Source the facts from each README (verified) — e.g.
Background Jobs → PostgreSQL `street_jobs` + DLQ tables; Realtime Chat → `ChannelHub` + `StreetWebSocketServer`.

- **Implementation Order:** 2.
- **ROI:** High — closes the stack-breakdown gap; reuses facts already in READMEs.
- **Adoption Impact:** Medium-High — buyers/evaluators scan stacks fast.
- **Maintenance Cost:** Low-Medium — must stay in sync with READMEs.

### REC-3 — Fix the docs links + the Realtime Chat docs/code mismatch (RISK-2, RISK-3)
Point JWT Auth, Background Jobs, Live Dashboard, and Multiplayer cards to
example-specific docs (create dedicated pages, or at minimum deep-link to the
relevant section). For Realtime Chat, either (a) update
`docs/examples/websocket-chat.md` to the `ChannelHub` approach the app actually
uses, or (b) point the card to the app README, which already matches the code.

- **Implementation Order:** 3.
- **ROI:** High — removes credibility risks at low effort.
- **Adoption Impact:** Medium — prevents confusion for users who clone + read.
- **Maintenance Cost:** Medium — writing/maintaining new example docs pages.

### REC-4 — Promote `reference-apps/*` into an "Advanced / Production-shaped" gallery row (RISK-4)
Surface ecommerce, saas, dating, ai-assistant, and reference realtime-chat as a
second showcase section. They are runnable, smoke-tested, and CI-wired
(`.github/workflows/reference-apps.yml`). This is the highest-capability content
currently hidden from the gallery.

- **Implementation Order:** 4.
- **ROI:** Very High — turns existing, tested apps into flagship demos with no new app-building.
- **Adoption Impact:** High — these are the "can it build a real product?" proof points.
- **Maintenance Cost:** Medium — covers/screenshots + keeping smoke tests green.

### REC-5 — Replace illustrative covers with real captured output/screenshots (RISK-1)
The 6 apps run and assert real output; capture terminal/HTTP/WS output (and a
minimal UI shot where a browser client exists, e.g. the websocket-chat HTML
client in the docs). Keep SVGs as fallback only.

- **Implementation Order:** 5.
- **ROI:** Medium — biggest lift toward "premium," but highest effort.
- **Adoption Impact:** Medium-High — visual credibility.
- **Maintenance Cost:** Medium-High — screenshots drift as apps change.

### REC-6 — Add architecture diagrams (close the diagram gap)
Add one simple diagram per featured app (request → controller → service →
repository → PG for REST; client ↔ WS ↔ ChannelHub fan-out for realtime). Derive
strictly from verified code structure (e.g. `docs/examples/rest-api.md` file tree).

- **Implementation Order:** 6.
- **ROI:** Medium — satisfies the diagram requirement; aids comprehension.
- **Adoption Impact:** Medium.
- **Maintenance Cost:** Medium — diagrams must track architectural changes.

### Guardrail (applies to all)
Do **not** add any showcase entry without runnable backing source. If a future
card lacks code, tag it GAP and keep it off the gallery until real code exists —
consistent with `docs/examples/index.md`: *"We add runnable examples incrementally
rather than shipping stubs."* — **VERIFIED principle already stated in repo.**

---

## Appendix — Files verified for this audit

- `docs/showcase.md` (6 cards, illustrative-cover disclaimer, source/docs links)
- `docs/examples/index.md`, `rest-api.md`, `websocket-chat.md`, `todo-api.md` (+ existence of `user-api.md`, `file-upload.md`, `streaming-query.md`)
- `examples/` listing: `01-rest-api` … `06-multiplayer`, `reference-apps/`, `marzpay-*`
- Example READMEs: `01`–`06` and `reference-apps/README.md`
- Source confirmed: `examples/01-rest-api/src/main.ts`, `02-jwt-auth/src/main.ts`, `03-background-jobs/src/main.ts`, `04/05/06 main.mjs` (line counts via `wc -l`)
- Covers: `docs/assets/images/showcase/{rest-api,jwt-auth,background-jobs,realtime-chat,live-dashboard,multiplayer}.svg`
- Link targets: `docs/security.md`, `docs/realtime-channels.md`
- Tutorials: `docs/tutorials/{first-api,auth,postgresql,realtime,fullstack-react}.md`
- Prior roadmap: `SHOWCASE-ROADMAP.md`
