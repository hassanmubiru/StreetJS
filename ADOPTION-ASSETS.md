# StreetJS Phase 19 — Adoption Assets

> The per-app proof assets that make capabilities *visible*: architecture diagrams, screenshots,
> per-app showcase pages, and learning paths. Architecture diagrams here are authored from VERIFIED
> source and are safe to ship now. Screenshots are specified precisely but must be **captured from the
> live demos** (`DEMO-INFRA-PLAN.md`) — they are never fabricated.

Asset conventions:
- Diagrams: ASCII in code fences (the site has no Mermaid config; matches `docs/use-cases/index.md` + the Phase-18 SaaS diagram). Render-independent, diffable, zero build risk.
- Screenshots: real PNGs captured from a running demo, stored at `docs/assets/images/showcase/<slug>/*.png`, replacing the illustrative `*.svg` covers only once real captures exist.
- Per-app page: `docs/showcase/<slug>.md` with a **Live · Source · Deploy · Docs** quadrant + diagram + screenshots + learning path. Surfaced from `docs/_data/demos.json`.

---

## 1. SaaS Demo

**Architecture (VERIFIED — from `examples/reference-apps/saas` + the SaaS starter overlay):**
```
HTTP request
  ├─ authMiddleware (JWT)              core
  ├─ requireRoles(owner|admin|member) core (RBAC)
  ├─ apiKeyAuth (X-API-Key)           src/middleware/apiKeyAuth.ts
  └─ tenant scoping                   src/middleware/tenant.ts → orgScopedRepo(org_id)
        └─ modules: orgs · members · invitations · apikeys · settings · audit · notifications · dashboard(SSR)
              └─ PostgreSQL (organizations, memberships, invitations, api_keys, audit_logs, notifications, subscriptions)
```
- **Screenshots to capture:** (1) dashboard home, (2) org switcher, (3) members + role assignment, (4) audit-log viewer.
- **Deployment:** `deploy/` Docker/Cloud Run + one-click button; scaffold via `street create my-saas --starter saas --with-admin-ui`.
- **Source:** `examples/reference-apps/saas` · `street create --starter saas`.
- **Docs:** **write `reference-apps/saas/README.md`** (run, env, endpoints, RBAC model). Property test: `saas-tenant-isolation.pbt`.
- **Learning path:** REST API → JWT Auth → SaaS (orgs/RBAC) → billing (`--with-billing`).

## 2. MarzPay Billing Demo

**Architecture (VERIFIED — from `packages/plugin-marzpay` + `examples/marzpay-*`):**
```
Customer ─▶ checkout controller ─▶ @streetjs/plugin-marzpay (dependency-free node:https client)
                                        │  initialize payment (SANDBOX)
                                        ▼
                              MarzPay API ──(async)──▶ webhook controller
                                                          ├─ server-side RE-VERIFY (no published sig scheme — verify by re-query)
                                                          └─ persist org-scoped SubscriptionRecord (PostgreSQL)
```
- **Screenshots:** (1) HTMX checkout page, (2) payment status, (3) subscription record/state. **Sandbox only — no real money.**
- **Deployment:** `deploy/` + required `MARZPAY_*` sandbox env documented.
- **Source:** `examples/marzpay-{checkout, subscriptions, saas, htmx, next, react}`; package `@streetjs/plugin-marzpay@1.0.0` (npm, signed + provenance).
- **Docs:** 6/6 example READMEs (VERIFIED) + `docs/integrations/marzpay-*`; add a demo hub page.
- **Learning path:** checkout → subscriptions → SaaS billing overlay → frontend (next/react/htmx).

## 3. HTMX Dashboard

**Architecture (VERIFIED base — `@streetjs/plugin-htmx` + `marzpay-htmx` + `05-live-dashboard` SSE):**
```
Browser (HTMX, no SPA build) ─▶ typed @Controller
                                   ├─ @streetjs/plugin-htmx view engine (layouts/partials)
                                   ├─ returns HTML fragments (hx-get/hx-post → swap)
                                   └─ SSE channel ─▶ live-updating tiles (no client framework)
```
- **Screenshots:** (1) dashboard with live tiles, (2) an HTMX fragment swap, (3) form post + inline validation.
- **Deployment:** `--frontend htmx` scaffold + `deploy/`.
- **Source:** `examples/marzpay-htmx` + `app-htmx` (extend into a dashboard per `SHOWCASE-ROADMAP.md` #3).
- **Docs:** dashboard README. **RISK:** sign + commit `plugin-htmx`'s manifest before featuring (X19-4).
- **Learning path:** Live Dashboard (SSE) → HTMX frontend → server-rendered dashboard.

## 4. Realtime Chat

**Architecture (VERIFIED — `examples/reference-apps/realtime-chat`, README):**
```
Client ──WS upgrade + JWT auth──▶ StreetWebSocketServer
                                     └─ ChannelHub: rooms · presence · typing · history (bounded conns, heartbeat)
                                          └─ (scale-out) optional Redis pub/sub in front of ChannelHub
MEASURED: ~115k deliveries/s (relative, in-memory single instance)
```
- **Screenshots:** (1) chat room with presence, (2) typing indicator, (3) two-client live delivery.
- **Deployment:** **WebSocket-capable host required** (VPS/Fly; Cloud Run with min-instances≥1). See `DEMO-INFRA-PLAN.md`.
- **Source:** `examples/04-realtime-chat` + `examples/reference-apps/realtime-chat`.
- **Docs:** **RISK** — reconcile `/examples/websocket-chat/` with the real app (X19-5) before featuring.
- **Learning path:** WebSocket basics → channels/presence → chat → multiplayer (`06`).

## 5. AI Assistant

**Architecture (VERIFIED — `examples/reference-apps/ai-assistant`, README):**
```
Docs ─▶ ingest ─▶ embeddings ─▶ vector store
User question ─▶ retrieve (grounded) ─▶ prompt + tool-calling loop (@streetjs/ai) ─▶ grounded answer
DEMO-SAFE: DEMO_MODE serves budget-capped or canned/fixture responses (never unbounded spend)
```
- **Screenshots:** (1) RAG answer with citations, (2) a tool-call step, (3) ingest/knowledge view.
- **Deployment:** `deploy/` + `DEMO_MODE` toggle for the public instance.
- **Source:** `examples/reference-apps/ai-assistant`.
- **Docs:** README (VERIFIED) + document demo-safe mode.
- **Learning path:** REST API → AI chat → embeddings/RAG → tool-calling.

## 6. Multi-tenant CRM — ROADMAP (not built; do not fabricate)

**Planned architecture (to be built on the VERIFIED SaaS base):**
```
Reuse SaaS plumbing (orgs/RBAC/multi-tenant via tenant.ts + orgScopedRepo, ORM relations, audit)
  └─ CRM domain: contacts ─▶ companies ─▶ deals ─▶ pipeline stages ─▶ activity timeline
```
- Until built, ship `docs/showcase/crm-roadmap.md` ("planned, built on the SaaS foundation") — honest, not a stub demo.
- When built (`examples/reference-apps/crm`): include `server.mjs` + `smoke-test.mjs` + README + a `reference-apps.yml` matrix entry + an org-scoping property test, then add all six assets above.

---

## Screenshot capture procedure (when demos are live)

1. Boot the demo locally or hit its live URL (`DEMO-INFRA-PLAN.md`).
2. Seed the demo dataset (deterministic seed → consistent screenshots).
3. Capture at 1280×720 (16:9, matches the showcase card aspect), light + dark if the demo themes.
4. Optimize (pngquant/svgo) and store at `docs/assets/images/showcase/<slug>/`.
5. Update the showcase card/page to use the real capture; keep the SVG as a fallback `srcset`.
6. **Never** hand-draw or AI-generate a "screenshot" of UI that wasn't actually rendered.

## Per-app showcase page template (`docs/showcase/<slug>.md`)

```
# <Capability> — built with StreetJS
[ Live demo ]  [ Source ]  [ Deploy ]  [ Docs ]      ← quadrant, sourced from demos.json
<one-line value prop>
## Architecture        (ASCII diagram above)
## Screenshots         (real captures)
## Run it locally      (clone + commands, verified)
## Deploy it           (deploy/ artifact + one-click)
## Learning path       (ordered prerequisite trail)
## How it's built      (key files + the property/smoke tests that prove it)
```

## Data model (`docs/_data/demos.json`) — drives badges + pages

```jsonc
{ "slug":"saas", "title":"SaaS", "capability":"Auth · RBAC · Multi-tenant",
  "url":"", "source":"examples/reference-apps/saas",
  "deploy":"deploy/cloud-run/service.yaml", "docs":"/showcase/saas/",
  "status":"source-only", "sandbox":true }
```
`status` flips to `live` only when the build-time `/health/ready` probe passes (`DEMO-INFRA-PLAN.md` §5) — so a "Live demo" badge never points at a dead instance.

---

## Asset production order (after hosting)

| Order | Asset | Source-safe now? |
|---|---|---|
| 1 | 5 architecture diagrams (SaaS done; author MarzPay/HTMX/Realtime/AI from this doc) | ✅ yes |
| 2 | `reference-apps/{saas,ecommerce,dating}` READMEs | ✅ yes |
| 3 | `demos.json` + per-app page scaffolds | ✅ yes |
| 4 | Real screenshots (all 6) | ❌ needs live demos |
| 5 | "Live demo" badges flipped on | ❌ needs live demos |
| 6 | CRM assets | ❌ needs the CRM build |

Items 1–3 can ship immediately from source; 4–6 unlock once `DEMO-INFRA-PLAN.md` is executed. The architecture diagrams above are ready to drop into per-app pages today.
