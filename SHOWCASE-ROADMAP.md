# StreetJS Phase 19 — Showcase Roadmap

> Per-app plan for the six prioritized capabilities. Each entry lists the six required artifacts
> (architecture diagram · screenshots · deployment path · source repository · documentation · learning path),
> the current VERIFIED state, the concrete work, and an effort/ROI tag.
> **No fake apps:** every entry maps to runnable, CI-tested source, or is explicitly roadmapped (CRM).
> Sequencing rationale lives in `SHOWCASE-AUDIT.md` §5; hosting in `DEMO-INFRA-PLAN.md`; assets in `ADOPTION-ASSETS.md`.

Legend — Status: ✅ runs today · ⚠ partial · ⛔ does not exist yet. Effort: S/M/L. ROI: 1 (highest) … 6.

---

## 1. SaaS Demo — ✅ runs · ROI 1

The flagship: it exercises auth + RBAC + multi-tenancy + audit in one app and maps to the highest-intent search ("typescript saas starter").

- **Architecture diagram** — VERIFIED: ASCII diagram authored in `docs/starters.md` (Phase 18). *Do:* reuse it on the per-app page; add a rendered version in `ADOPTION-ASSETS.md`.
- **Screenshots** — GAP. *Do:* capture dashboard, org switcher, members/RBAC, audit log (after hosting).
- **Deployment path** — VERIFIED artifacts (`deploy/` Docker/Helm/Cloud Run). *Do:* add a one-click Cloud Run/Fly button + the exact `--with-billing`/`--with-admin-ui` scaffold command.
- **Source repository** — VERIFIED: `examples/reference-apps/saas` (+ `street create --starter saas`). 
- **Documentation** — ⚠ GAP: `reference-apps/saas` has **no README**. *Do:* write one (run, env, endpoints, RBAC model, smoke test). **S, do first.**
- **Learning path** — *Do:* REST API → JWT Auth → SaaS (orgs/RBAC) → add billing (`--with-billing`).
- **Build work:** none (exists). **Backfill README + host + capture.** Effort **S–M**.

## 2. MarzPay Billing Demo — ✅ runs · ROI 2

Now backed by a genuinely published package (`@streetjs/plugin-marzpay@1.0.0`, provenance + signed).

- **Architecture diagram** — GAP. *Do:* author ASCII flow (checkout → MarzPay HTTPS client → webhook re-verification → org-scoped subscription record). In `ADOPTION-ASSETS.md`.
- **Screenshots** — GAP. *Do:* capture the HTMX checkout + subscription state (after hosting; **sandbox keys only, no real money**).
- **Deployment path** — VERIFIED `deploy/` artifacts. *Do:* document the required `MARZPAY_*` env + sandbox setup; one-click deploy.
- **Source repository** — VERIFIED: `examples/marzpay-{checkout, subscriptions, saas, htmx, next, react}` (all built, all have READMEs).
- **Documentation** — VERIFIED (6/6 READMEs) + `docs/integrations/marzpay-*`. *Do:* add a single "MarzPay demo" hub linking the variants.
- **Learning path** — *Do:* checkout (one-shot) → subscriptions (recurring) → SaaS billing overlay → frontend (next/react/htmx).
- **Build work:** none. **Host (sandbox) + diagram + screenshots.** Effort **M** (sandbox safety).

## 3. HTMX Dashboard — ⚠ partial · ROI 3

The strongest "no SPA build step" story, but today's HTMX demo is checkout-focused, not a dashboard.

- **Architecture diagram** — GAP. *Do:* ASCII (typed controller → `@streetjs/plugin-htmx` view engine → partial/fragment swaps → SSE live tiles).
- **Screenshots** — GAP.
- **Deployment path** — VERIFIED (`--frontend htmx` scaffold + `deploy/`). 
- **Source repository** — ⚠: `examples/marzpay-htmx` + `app-htmx` scaffold exist; **no dedicated HTMX *dashboard***. *Do (decision):* either (a) promote/extend `marzpay-htmx` into a small server-rendered **dashboard** (live metrics via SSE + a couple of HTMX-swapped panels) reusing `05-live-dashboard` patterns, or (b) scope a new `examples/reference-apps/htmx-dashboard`. Prefer (a) — smaller, reuses verified pieces.
- **Documentation** — VERIFIED for `marzpay-htmx`; *Do:* dashboard-specific README.
- **Learning path** — *Do:* Live Dashboard (SSE) → HTMX frontend → server-rendered dashboard.
- **RISK:** `@streetjs/plugin-htmx` is **unsigned** (Phase-18 X2 / X19-4). *Do:* sign + commit its manifest (CI has the key) before featuring. **S.**
- **Build work:** small extension (a) + sign plugin. Effort **M**.

## 4. Realtime Chat — ✅ runs · ROI 4

Benchmarked (~115k deliveries/s, MEASURED relative) and CI-tested — strong proof, but a doc drift to fix first.

- **Architecture diagram** — GAP. *Do:* ASCII (WS upgrade + auth → `ChannelHub` rooms → presence/typing → history; optional Redis fan-out for scale).
- **Screenshots** — GAP.
- **Deployment path** — VERIFIED, but the public host must be **WebSocket-capable** (rules out plain serverless; use a VPS/Fly/Cloud Run with WS). Note in `DEMO-INFRA-PLAN.md`.
- **Source repository** — VERIFIED: `examples/04-realtime-chat` + `examples/reference-apps/realtime-chat` (README + smoke).
- **Documentation** — ⚠ RISK: `/examples/websocket-chat/` doc describes a *different* impl than the backing app (Phase-18 C). *Do:* reconcile the doc to the real app. **S.**
- **Learning path** — *Do:* WebSocket basics → channels/presence → chat → multiplayer (`06`).
- **Build work:** none. **Fix doc drift + host (WS) + capture.** Effort **S–M**.

## 5. AI Assistant — ✅ runs · ROI 5

RAG + tool-calling on `@streetjs/ai`; the only one with a hard public-hosting constraint (model credentials/cost).

- **Architecture diagram** — GAP. *Do:* ASCII (ingest → embed → retrieve → prompt + tool-call loop → grounded answer).
- **Screenshots** — GAP.
- **Deployment path** — VERIFIED `deploy/`; **CONSTRAINT:** a public demo needs either a budget-capped key behind a strict rate limit **or** an offline/canned model mode. *Do:* add a demo-safe "fixture model" toggle so the public instance never spends unbounded tokens.
- **Source repository** — VERIFIED: `examples/reference-apps/ai-assistant` (README + smoke).
- **Documentation** — VERIFIED (README). *Do:* document the demo-safe mode + env.
- **Learning path** — *Do:* REST API → AI chat → embeddings/RAG → tool-calling.
- **Build work:** small (demo-safe model toggle) + host. Effort **M**.

## 6. Multi-tenant CRM — ⛔ does not exist · ROI 6

Only a use-case/roadmap mention today. **Must be built on the verified foundation or roadmapped — never faked.**

- **Decision:** build `examples/reference-apps/crm` on the **same verified base as the SaaS app** (orgs/RBAC/multi-tenant via `tenant.ts`/`orgScopedRepo`, ORM relations, audit log). Domain: contacts → companies → deals → pipeline stages → activity timeline. Reuses ~80% of the SaaS plumbing, so it is maintainable and non-fake.
- **Architecture diagram / screenshots / deployment / source / docs / learning path** — all produced as part of the build (mirror the SaaS app's structure: `server.mjs` + `smoke-test.mjs` + README + a `reference-apps.yml` matrix entry + a benchmark op).
- **Acceptance:** smoke test green in CI; org-scoping property test (reuse the SaaS tenant-isolation pattern); README; benchmark entry.
- **If capacity-constrained:** ship `docs/showcase/crm-roadmap.md` ("planned, built on the SaaS foundation") instead of a stub — honest, not fabricated.
- **Build work:** real, scoped. Effort **L**.

---

## Consolidated build/enrich order

| Order | Item | Type | Effort | Blocks the 5-min metric? |
|---|---|---|---|---|
| 1 | Demo hosting platform (SaaS + Realtime first) | infra | M | **Yes — primary** |
| 2 | `demos.json` + "Live demo" badges on showcase | generator/docs | S | Yes |
| 3 | READMEs for `reference-apps/{saas,ecommerce,dating}` | docs | S | No (trust) |
| 4 | Reconcile realtime-chat doc; sign `plugin-htmx` | docs/security | S | No (trust) |
| 5 | Host MarzPay (sandbox), HTMX, AI (demo-safe mode) | infra | M | Yes |
| 6 | Screenshots + architecture diagrams (all 6) | assets | M | No (presentation) |
| 7 | Per-app showcase pages (Live·Source·Deploy·Docs·Path) | docs | M | Yes (surfacing) |
| 8 | HTMX dashboard extension of `marzpay-htmx` | build | M | feature |
| 9 | CRM — build on SaaS base (or roadmap page) | build | L | feature |

## What this phase does NOT do

- No fabricated apps, no placeholder demo URLs, no claimed live instances until smoke-tested.
- No core framework changes; all work is examples/docs/generator/infra/CI.
- No unbounded public spend (AI) or real money/PII (billing, auth) — see `DEMO-INFRA-PLAN.md`.
