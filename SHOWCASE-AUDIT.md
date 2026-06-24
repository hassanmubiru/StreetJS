# StreetJS Phase 19 — Showcase & Adoption Engine — Master Audit

> **Type:** Audit + synthesis (planning). **No framework/core source modified by this deliverable.**
> **Goal:** turn "a framework with features" into "a framework with *visible proof*" — a developer should reach a live, real application for every major capability within ~5 minutes of landing on the site.
> **Method:** every finding verified from repository source before recording. Tags: **VERIFIED** (confirmed in source), **GAP** (absent), **RISK** (present but a trust/maintenance hazard), **RECOMMENDATION** (proposed, non-fabricating).
> **Hard rule honored:** *no fake applications.* Every showcased app must be deployable, documented, and maintainable. Where an app does not exist (CRM), it is a roadmap item, not a fabricated demo.

Companion deliverables: `SHOWCASE-ROADMAP.md` (what to build/enrich, in order), `DEMO-INFRA-PLAN.md` (how to host live demos cheaply and safely), `ADOPTION-ASSETS.md` (screenshots, diagrams, learning paths, per-app pages).

---

## 1. Executive summary

**The applications already exist and run; what's missing is *visible, hosted proof* and *presentation*.** This is the same shape as the Phase-18 finding: the substance is built, the surfacing is not.

- **VERIFIED — runnable apps exist and are CI-tested.** `examples/01-06` (six capability demos), `examples/reference-apps/{realtime-chat, ai-assistant, ecommerce, saas, dating}` (each with `server.mjs` + an executable `smoke-test.mjs`, wired into `.github/workflows/reference-apps.yml` and `scripts/benchmark-reference-apps.mjs`), and `examples/marzpay-{checkout, subscriptions, saas, htmx, next, react}` (each with `src/` + built `dist/` + a README).
- **VERIFIED — real deployment artifacts exist.** `deploy/` covers Docker, Helm/K8s (probes + HPA), Cloud Run, Cloudflare Workers, AWS ECS, Vercel, and Lambda/Azure via `@streetjs/edge`, with a single `scripts/deploy/smoke-test.sh` that works against any target.
- **GAP (the central one) — there is NO live, hosted demo.** No `*.fly.dev`/`*.run.app`/`demo.streetjs.*` URL appears anywhere in `docs/`. A developer can *clone and run*, but cannot *click and see* — which is exactly what the Phase-19 success metric requires. This is the single highest-leverage gap.
- **GAP — no real screenshots.** The showcase uses clearly-labeled *illustrative* SVG covers (`docs/assets/images/showcase/*.svg`). Real UI captures require running the apps.
- **GAP — uneven documentation.** Reference-apps `saas`, `ecommerce`, `dating` have **no README** (only `ai-assistant` and `realtime-chat` do).
- **GAP — no CRM application.** "CRM" appears only as a use-case/roadmap mention (`docs/use-cases/index.md`, `docs/examples/index.md`), never as code. Per the no-fake rule it must be **built on the verified SaaS+RBAC+multi-tenant foundation or roadmapped**, not faked.
- **VERIFIED — MarzPay is now real & published.** `@streetjs/plugin-marzpay@1.0.0` is live on npm (provenance + official signature) and listed in the marketplace, so the MarzPay billing demos reference a genuinely installable package.

**Net:** Phase 19 is primarily a **hosting + presentation** effort (live demos, screenshots, per-app pages, learning paths) plus **one honest documentation/coverage backfill** (reference-app READMEs) and **one net-new build decision** (CRM: build-on-SaaS or roadmap). Almost nothing requires core changes.

---

## 2. Verified inventory (source of truth)

### 2.1 Capability demos — `examples/01-06` (VERIFIED runnable)
| Example | Capability | Cover asset | Showcase card |
|---|---|---|---|
| `01-rest-api` | Controllers, repositories, validation, OpenAPI | `rest-api.svg` | yes (Beginner) |
| `02-jwt-auth` | Registration/login/sessions/RBAC | `jwt-auth.svg` | yes (Beginner) |
| `03-background-jobs` | Queue + scheduler + retries | `background-jobs.svg` | yes (Intermediate) |
| `04-realtime-chat` | WebSocket channels, presence, heartbeat | `realtime-chat.svg` | yes (Intermediate) |
| `05-live-dashboard` | SSE metrics streaming | `live-dashboard.svg` | yes (Advanced) |
| `06-multiplayer` | Low-latency state sync, rooms | `multiplayer.svg` | yes (Advanced) |

### 2.2 Reference apps — `examples/reference-apps/*` (VERIFIED, CI-tested)
| App | Built on | `server.mjs` | `smoke-test.mjs` | README | CI | Benchmarked |
|---|---|:--:|:--:|:--:|:--:|:--:|
| `realtime-chat` | core `ChannelHub` + WS | ✅ | ✅ | ✅ | ✅ `reference-apps.yml` | ✅ ~115k deliveries/s |
| `ai-assistant` | `@streetjs/ai` (RAG + tools) | ✅ | ✅ | ✅ | ✅ | ✅ |
| `ecommerce` | `@streetjs/commerce` | ✅ | ✅ | **GAP** | ✅ | ✅ |
| `saas` | `@streetjs/admin` (RBAC, audit) | ✅ | ✅ | **GAP** | ✅ | ✅ |
| `dating` | `@streetjs/dating-profiles` | ✅ | ✅ | **GAP** | ✅ | ✅ |

> Each exposes `GET /health/live` + `GET /health/ready`; all are validated by `scripts/verify-reference-apps.sh`. Benchmark numbers are MEASURED, relative, in-memory single-instance — keep them tagged as such.

### 2.3 MarzPay demos — `examples/marzpay-*` (VERIFIED, built)
| Example | Focus | src+dist | README |
|---|---|:--:|:--:|
| `marzpay-checkout` | One-shot collection/checkout | ✅ | ✅ 47L |
| `marzpay-subscriptions` | Recurring billing scaffolding | ✅ | ✅ 57L |
| `marzpay-saas` | Billing inside the SaaS overlay | ✅ | ✅ 65L |
| `marzpay-htmx` | Server-rendered checkout (HTMX) | ✅ | ✅ 63L |
| `marzpay-next` | Next.js client integration | ✅ | ✅ 89L |
| `marzpay-react` | React (Vite) client integration | ✅ | ✅ 76L |

### 2.4 Deployment artifacts — `deploy/*` (VERIFIED authored)
Docker (builds + boots, verified) · Helm/`k8s` (probes + HPA) · Cloud Run (`service.yaml`) · Cloudflare (`wrangler.toml` + edge adapter) · AWS ECS (`task-definition.json`) · Vercel (`vercel.json`) · Lambda/Azure (`@streetjs/edge`, unit-tested). Shared smoke: `scripts/deploy/smoke-test.sh`.

---

## 3. The six prioritized capabilities — current state

| # | Capability | Status | Backing (VERIFIED) | What's missing for "5-minute live proof" |
|---|---|---|---|---|
| 1 | **SaaS Demo** | **VERIFIED (runs)** | `reference-apps/saas`, `examples/marzpay-saas`, CLI `--starter saas` (orgs, RBAC, audit, multi-tenant) | Live host; README for `reference-apps/saas`; screenshots; per-app page |
| 2 | **MarzPay Billing** | **VERIFIED (runs)** | `marzpay-checkout/subscriptions/saas` + published `@streetjs/plugin-marzpay@1.0.0` | Live host (sandbox keys); screenshots; deploy button |
| 3 | **HTMX Dashboard** | **PARTIAL** | `marzpay-htmx` + `app-htmx` scaffold + `@streetjs/plugin-htmx`; htmx is a real `--frontend` | A dedicated *dashboard* demo (current htmx demo is checkout-focused); plugin-htmx still **unsigned** (RISK); live host |
| 4 | **Realtime Chat** | **VERIFIED (runs)** | `examples/04-realtime-chat` + `reference-apps/realtime-chat` (benchmarked) | Live host (WS-capable); screenshots; align the `/examples/websocket-chat/` doc with the backing app (it currently describes a different impl) |
| 5 | **AI Assistant** | **VERIFIED (runs)** | `reference-apps/ai-assistant` (RAG + tool-calling, README, smoke) | Live host (needs a model key or a canned/offline mode for the public demo); screenshots |
| 6 | **Multi-tenant CRM** | **GAP (does not exist)** | none (CRM is only a use-case mention) | **Build on the verified SaaS+RBAC+multi-tenant base** (contacts/deals/pipeline/activity) **or roadmap it** — do NOT fabricate |

---

## 4. Cross-cutting findings

- **X19-1 — RISK (highest, = the success metric): no live demos.** Everything is "clone & run." The metric demands "click & see." Closing this is the whole point of Phase 19 → see `DEMO-INFRA-PLAN.md`.
- **X19-2 — GAP: missing reference-app READMEs** (`saas`, `ecommerce`, `dating`). Cheap, high-trust backfill; these are CI-tested apps with zero docs.
- **X19-3 — GAP: no real screenshots / architecture images.** Showcase covers are illustrative SVGs (correctly labeled). Real captures require running the apps once live (chicken-and-egg with X19-1 → host first, then capture).
- **X19-4 — RISK: `plugin-htmx` unsigned** (carried from Phase 18 X2). The HTMX dashboard demo would feature a plugin the marketplace honestly marks "signing pending." Sign + commit its manifest (CI has the key) before featuring it as flagship.
- **X19-5 — RISK: doc/impl drift.** `/examples/websocket-chat/` describes a different implementation than `reference-apps/realtime-chat` (Phase-18 finding C). Reconcile before promoting realtime as flagship proof.
- **X19-6 — GAP: no per-app showcase pages or deploy buttons.** Showcase cards deep-link to source/generic docs, not to a "Live demo · Source · Deploy · Docs" quadrant per app.
- **X19-7 — CONSTRAINT: public demos must be safe.** Auth, AI keys, and payments demos need sandboxed credentials, rate limits, reset-on-cron, and no real money/PII. Designed in `DEMO-INFRA-PLAN.md`.

---

## 5. Implementation order (trust + ROI first)

**Phase A — Hosting foundation (unlocks the success metric):**
1. Stand up the demo platform (one cheap VPS or Fly.io/Cloud Run) per `DEMO-INFRA-PLAN.md`, starting with **SaaS** and **Realtime Chat** (the two strongest, lowest-risk demos).
2. Add a `demos.json` data file + a "Live demo" badge to each showcase card (data-driven, like `plugins.json`).

**Phase B — Documentation/accuracy backfill (cheap, high-trust):**
3. Write READMEs for `reference-apps/{saas, ecommerce, dating}` (mirror the `realtime-chat`/`ai-assistant` format).
4. Reconcile the realtime-chat doc with its backing app (X19-5); sign `plugin-htmx` (X19-4).

**Phase C — Per-app proof assets (after hosting; needs live apps):**
5. Capture real screenshots + author architecture diagrams for the 6 priorities (`ADOPTION-ASSETS.md`).
6. Build per-app showcase pages with the "Live · Source · Deploy · Docs · Learning path" quadrant.

**Phase D — Net-new build (scoped, non-fake):**
7. **CRM:** build a multi-tenant CRM on the verified SaaS+RBAC+ORM foundation (contacts → companies → deals → pipeline → activity log + audit), with a `server.mjs` + `smoke-test.mjs` + README + CI entry — *or* ship a roadmap page until it can be maintained. Decision and scope in `SHOWCASE-ROADMAP.md`.

---

## 5b. Source-safe execution status (APPLIED)

Implemented this pass — docs/examples/generator/CI only, no fabrication, no hosting:

- **Reference-app READMEs (X19-2) — DONE.** Wrote `examples/reference-apps/{saas, ecommerce, dating}/README.md` (mirrors the realtime-chat/ai-assistant format; accurate to each `server.mjs`). All five reference apps are now documented.
- **Demo registry — DONE.** `docs/_data/demos.json` (6 capabilities; `source-only`/`roadmap`, empty URLs — no false "live" claims).
- **Per-app showcase pages — DONE.** `docs/showcase/{saas, marzpay-billing, htmx-dashboard, realtime-chat, ai-assistant, crm-roadmap}.md`, each with Live·Source·Deploy·Docs quadrant + a VERIFIED ASCII architecture diagram + learning path. CRM is an honest roadmap page, not a stub demo.
- **Data-driven badges — DONE.** `docs/showcase.md` renders a "Capability demos" grid and the homepage (`docs/index.md`) a "See it in action" grid, both from `site.data.demos` (Liquid). A green **Live demo** badge renders only for `status: live` + URL — so flipping a demo live is a one-line `demos.json` edit.
- **Uptime automation — DONE.** `scripts/check-demos.mjs` (dependency-free `/health/ready` probe; `--write` updates statuses) + `.github/workflows/demos-uptime.yml` (scheduled, report-only, pinned). Not wired into the Pages build (a network probe there could break deploys).
- **Doc-drift fix (X19-5) — DONE.** `docs/examples/websocket-chat.md` now clearly distinguishes the from-scratch tutorial from the canonical `ChannelHub` reference app, with links.

**Now done (previously "external"):**
- **`plugin-htmx` signed (X19-4) — DONE.** Signed with the official key via the `sign-htmx.yml` CI workflow (the key is CI-only; `main` is protected so the workflow uploads the signed manifest as an artifact, applied through the normal flow). Marketplace is now **21/21 signed**; the htmx detail page shows the Signed badge.
- **HTMX dashboard built — DONE.** `examples/reference-apps/htmx-dashboard` (ViewEngine + HTMX `/tiles` fragment + SSE `/events`); `smoke-test.mjs` 12/12; registered in `verify-reference-apps.sh` + `reference-apps.yml`; per-app page + `demos.json` updated.
- **Multi-tenant CRM built — DONE.** `examples/reference-apps/crm` on `@streetjs/admin` RBAC + org-scoped `CrmStore` (companies→contacts→deals→pipeline→activity); `smoke-test.mjs` 16/16 proving **tenant isolation** + **RBAC** + pipeline + activity; registered everywhere; the roadmap page now points to the built app.

**Still external (cannot be done from the repo without fabrication/credentials):**
- **Live hosting** (the success metric) — the demo stack is now **built + boot-verified** (`demos/` — Docker Compose + Caddy; all five demos return 200 on `/health/ready` in containers). Remaining step is host + DNS + (sandbox/demo-safe) secrets, then `demos.json` status → `live` (or `check-demos.mjs --write`). This is the one infra/credential action only the maintainer can take.
- **Real screenshots** — capture from the live demos (never fabricated).

## 6. Success-criteria mapping

| Phase-19 metric | Current state | Gap to close |
|---|---|---|
| Live app for every major capability | 0 hosted (all run locally) | Host SaaS, MarzPay, HTMX, Realtime, AI (+CRM when built) — `DEMO-INFRA-PLAN.md` |
| Visible within 5 minutes | source links only | "Live demo" badges + per-app pages on the showcase |
| Architecture diagram per app | 1 (SaaS, ASCII, from Phase 18) | 5 more, accurate from source — `ADOPTION-ASSETS.md` |
| Screenshots per app | 0 real (SVG covers) | capture after hosting |
| Deployment path per app | shared `deploy/` artifacts exist | per-app one-click deploy button |
| Source repo per app | ✅ all in-repo | surface the link prominently |
| Documentation per app | 6/6 marzpay, 2/5 reference-apps | backfill 3 READMEs |
| Learning path | global showcase learning path (Phase 18) | per-capability learning path |

---

## 7. Guardrails (carry into execution)

- **No fake apps.** Every showcased demo maps to runnable, CI-tested source. CRM is built-or-roadmapped, never faked.
- **No live URL without a real deployment.** Do not print a demo link until the instance is up and smoke-tested.
- **MEASURED-only performance.** Reuse the benchmark harness numbers with their "relative, in-memory" caveat.
- **Public demos are sandboxed.** No real payments, no real PII, no unbounded AI spend; reset on a schedule; rate-limited; auth-gated where needed.
- **Keep it data-driven.** Demos surfaced via a `demos.json` + generator, like the plugin marketplace, so the showcase self-corrects.
- **Respect maintenance cost (bus factor = 1).** Prefer few, automated, self-resetting demos over many hand-tended ones.

---

## 8. Evidence index (primary sources read)

`examples/` (01-06, `marzpay-*`, `reference-apps/*` incl. `server.mjs`/`smoke-test.mjs`/READMEs), `examples/reference-apps/README.md`, `scripts/{verify-reference-apps.sh, benchmark-reference-apps.mjs, deploy/smoke-test.sh}`, `deploy/` (all targets + `README.md`), `docs/showcase.md`, `docs/index.md`, `docs/examples/index.md`, `docs/use-cases/index.md`, `docs/assets/images/showcase/*.svg`, `docs/_data/plugins.json` (MarzPay now listed), npm (`@streetjs/plugin-marzpay@1.0.0` live).
