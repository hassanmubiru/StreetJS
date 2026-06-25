# StreetJS HTMX Ecosystem Expansion — Architecture & Implementation Plan

> ## Execution log
> **30-day P0 slice — IMPLEMENTED (this commit):** `@streetjs/plugin-htmx`
> scaffolded as a self-contained, dependency-free package
> (`packages/plugin-htmx/`):
> - Dependency-free **view engine** (`ViewEngine`, `renderTemplate`) — layouts,
>   partials, `{{ }}` escaping, `{{{ }}}` raw, `{{> partial }}`, bounded cache.
> - **HTMX helpers** — `isHtmxRequest`, `hxHeaders` (HX-Redirect/Trigger/Retarget/
>   Reswap/…), `csrfField`.
> - **Context glue** — `HtmxPlugin.middleware({ viewsDir, layout })` attaches
>   `ctx.htmx.view/partial/fragment/hx`; full page on navigation, fragment on
>   HX-Request (progressive enhancement).
> - **16 unit tests pass**, `tsc` build green, end-to-end render verified, no
>   diagnostics. Marked `unlisted` so it stays out of the live marketplace until
>   published (the generator skips `streetjs.unlisted`).
> **Remaining:** sign + publish via the keyed plugin-publish flow (needs the org
> signing key); then `--frontend htmx` starter (Phase 4, P1) and `/docs/htmx/`
> (Phase 6, P1).
>
> **Phase 4 `--frontend htmx` starter — IMPLEMENTED in source (this commit):**
> `street create <app> --frontend htmx` scaffolds a server-rendered views tree
> (`src/views/{layouts,partials,pages}`), `public/app.css`, a `ViewsController`
> (todos CRUD via HTMX fragments), `HTMX.md` wiring guide, and adds the
> `@streetjs/plugin-htmx` dependency — no `web/` SPA, and CI gets no web job.
> 121 CLI tests pass; coverage 92.4% branches. **NOT released to npm yet** because
> the generated app depends on the still-unpublished `@streetjs/plugin-htmx`
> (a generated `npm install` would fail until the plugin ships). Gate the CLI
> release on publishing the plugin.
>
> **Phase 6 `/docs/htmx/` — IMPLEMENTED & LIVE (this commit):** an 8-page docs
> section (Getting Started, Rendering Views, Partials & Fragments, Forms & CSRF,
> Authentication, Realtime, Deployment + landing) under `/htmx/`, nested in the
> sidebar, all returning 200 and in the sitemap. No npm dependency — shippable now.
>
> **SHIPPED (2026-06-22):** the full HTMX ecosystem is live.
> - **`@streetjs/plugin-htmx@1.0.0` PUBLISHED to npm** via `publish-plugins.yml`
>   (run 27917833990) — signed manifest verified against the official key,
>   provenance attested (sigstore logIndex 1902539622). Confirmed live:
>   `npm view @streetjs/plugin-htmx version` → `1.0.0`.
> - **`unlisted` flag removed** from `packages/plugin-htmx/package.json`; marketplace
>   regenerated → **20 plugins**, htmx listed under a new **"Frontend & Views"**
>   category (`scripts/gen-plugins-data.mjs`). Pages redeploys with the new entry.
> - **CLI release `v1.0.23` cut** (core + cli + compat bumped, lockfile + `_config.yml`
>   synced, CHANGELOG entry, tag pushed → CI publishes). Now `street create
>   --frontend htmx` works end-to-end: the generated app's `@streetjs/plugin-htmx`
>   dependency resolves. 130 CLI tests + 51 integration tests pass.




> Evidence-based, repo-grounded. Tags: **VERIFIED** (confirmed in repo) ·
> **RECOMMENDATION** · **RISK**. Per-recommendation scoring uses: Impact (H/M/L),
> Effort (H/M/L), Adoption (0–5), Maintenance cost (0–5), Priority (P0/P1/P2).
>
> **Guardrail honored throughout:** StreetJS stays frontend-agnostic. HTMX support
> ships as an **official plugin** + a **starter** + **docs** — never in core.

## Verified starting point

- **`ctx.html(data, status?)`, `ctx.json()`, `ctx.send()`, `ctx.text()`** already
  exist (`packages/core/src/core/context.ts`). The plugin builds on `ctx.html()`. — VERIFIED
- **No runtime view/template engine in core.** — VERIFIED (GAP the plugin fills)
- The CLI's `.hbs` codegen templates are rendered by a **custom, dependency-free
  template compiler** — the CLI's only dependency is `streetjs` (no `handlebars`
  npm package). — VERIFIED (sets the precedent: dependency-free templating)
- **Signed, dependency-free plugin system** + 20+ official plugins. — VERIFIED
- **WebSocket server + SSE + CSRF** exist in core. — VERIFIED (realtime + forms reuse them)
- `--frontend` supports `none|react|next`; **no `htmx`**. — VERIFIED (GAP)
- **No `@streetjs/plugin-htmx`.** — VERIFIED (GAP)

---

## Phase 1 — Strategic fit

**Why HTMX matters for StreetJS.** HTMX returns HTML fragments over HTTP and swaps
them into the DOM — the server does the rendering. That is exactly what StreetJS
already is good at (typed controllers, `ctx.html`, auth, sessions, CSRF, realtime).
HTMX lets StreetJS power complete, interactive apps **without a SPA build step**,
positioning it next to Laravel+Blade, Django, and Rails+Hotwire.

| Dimension | Assessment | Tag |
|---|---|---|
| Adoption potential | High — HTMX is a fast-growing, low-barrier audience underserved in the TS/Node world | RECOMMENDATION |
| Learning curve | Low — HTML attributes + server fragments; no client build/bundler | VERIFIED (HTMX design) |
| Developer experience | Strong — one language/stack, typed controllers returning HTML | RECOMMENDATION |
| Enterprise use cases | Internal tools, admin dashboards, CRUD apps, low-JS surfaces | RECOMMENDATION |
| Performance | Smaller payloads than hydrating a SPA; server-rendered first paint | RECOMMENDATION |
| SEO | Server-rendered HTML is natively crawlable (a SPA's weak point) | RECOMMENDATION |

**Why a backend framework should support HTMX:** HTMX pushes rendering and state
to the server. A backend with typed routing, auth, CSRF, and realtime is the whole
app — so first-class HTMX support is high-leverage and on-brand.

**Why HTMX must NOT be in core:** core is dependency-light and frontend-agnostic;
baking in a view engine and HTMX helpers would bloat it and break that promise.
A plugin keeps core clean and lets non-HTMX users ignore it. — **RISK if violated.**

| Recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| Pursue HTMX as a plugin+starter+docs (not core) | High | Med | 5 | 2 | **P0** |

---

## Phase 2 — Official plugin: `@streetjs/plugin-htmx`

Dependency-free (own minimal renderer), signed manifest, `PluginModule` SDK shape
(mirrors existing `@streetjs/plugin-*`). Augments `ctx` with view helpers.

**Features:** layout rendering, page rendering, partial/fragment rendering,
`HX-Request` detection, response helpers (`HX-Redirect`, `HX-Trigger`,
`HX-Reswap`, `HX-Retarget`), CSRF token injection into forms (reuses core CSRF),
form helpers, SSE helper, WebSocket helper, progressive-enhancement fallback
(full-page render when the request is **not** an HTMX request).

**Public API (illustrative):**
```typescript
// Full page (layout + page), or just the fragment when it's an HX request.
return ctx.view('dashboard', { user });          // smart: full vs partial by HX-Request
return ctx.partial('users/row', { user });       // a named partial, no layout
return ctx.fragment('<li>…</li>');                // raw HTML fragment

// HTMX response controls (typed wrappers over response headers)
ctx.hx.redirect('/login');                        // HX-Redirect
ctx.hx.trigger('userCreated', { id });            // HX-Trigger
ctx.hx.retarget('#list').reswap('beforeend');

// Request detection
if (ctx.hx.isHtmx) { /* return a fragment */ }    // reads HX-Request header
```

`isHtmx` reads the `HX-Request` header; `ctx.view` automatically returns the
fragment for HX requests and the full layout otherwise — that single behavior is
the progressive-enhancement story.

**Configuration / registration / lifecycle:**
```typescript
import { HtmxPlugin } from '@streetjs/plugin-htmx';
app.use(HtmxPlugin.middleware({ viewsDir: 'src/views', layout: 'layouts/main', csrf: true }));
```
- **register** → resolves `viewsDir`, compiles/caches templates (LRU-bounded, like
  the rest of the framework's memory discipline).
- **onRequest** → attaches `ctx.view/partial/fragment/hx`.
- CSRF → pulls the token from the core session/CSRF layer and exposes a
  `{{ csrf_field }}` helper.

| Recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| Build `@streetjs/plugin-htmx` (dependency-free) | High | Med-High | 5 | 3 | **P0** |
| CSRF form helper (reuse core CSRF) | Med | Low | 3 | 1 | P0 |
| `ctx.hx.*` response helpers | Med | Low | 4 | 1 | P0 |
| SSE/WS helpers | Med | Med | 3 | 2 | P1 |

---

## Phase 3 — Template engine strategy

| Option | Performance | Ecosystem | Complexity | Maintenance | Verdict |
|---|---|---|---|---|---|
| A. Native template literals | Excellent (just JS) | n/a | Low | Low | Good for tiny apps; weak for layouts/partials |
| B. Handlebars (npm) | Good | Large | Low | **Adds a runtime dep + helpers** | Off-brand (dep) |
| C. Nunjucks | Good | Med | Med | Adds a heavy dep | Off-brand |
| D. Eta | Very good (tiny) | Small | Low | One small dep | Acceptable fallback |
| **E. Custom StreetJS view engine** | Very good | n/a | Med (build once) | **Owned, dependency-free** | **RECOMMENDED** |

**Recommendation: Option E — a tiny, dependency-free view engine**, reusing the
in-house template-compile approach the CLI already uses for `.hbs` codegen
(VERIFIED: the CLI renders templates with **no** `handlebars` dependency). This
keeps the "2 runtime dependencies" brand intact and gives layouts + partials +
escaping + a small helper set. **Pragmatic fallback:** support **Eta** as an
optional adapter for teams that want a battle-tested engine — adapter pattern, not
a hard dependency.

| Recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| Dependency-free view engine (Option E) | High | Med | 4 | 3 | **P0** |
| Optional Eta adapter | Low | Low | 2 | 1 | P2 |

---

## Phase 4 — HTMX starter (`--frontend htmx`)

Add `htmx` to `FRONTENDS` in `packages/cli/src/commands/create.ts` (currently
`none|react|next`). Composes the base app + `@streetjs/plugin-htmx` + a views tree.

**Generated structure:**
```
src/
  views/
    layouts/main.html          # base layout (loads htmx from CDN or /public)
    partials/                  # nav, flash, user-row, etc.
    pages/                     # home, login, register, dashboard, crud
  controllers/                 # typed controllers returning ctx.view/partial
public/                        # htmx.min.js (vendored), css
migrations/                    # CRUD example schema
```

**Starter pages:** Home, Login, Register, Dashboard, CRUD example (list + inline
create/edit/delete via partials), Notifications.
**Realtime example:** HTMX `ws-ext` connected to the StreetJS WebSocket server.
**Auth example:** HTMX login/register wired to StreetJS auth (sessions + CSRF),
with `HX-Redirect` on success and fragment errors on failure.

A scaffold→`npm install`→`npm run build` integration test is added to the explicit
list in `packages/cli/package.json` (coverage gate 85% branches), mirroring the
existing `create-*` tests.

| Recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| `--frontend htmx` starter | High | Med-High | 5 | 3 | **P0** |
| CRUD + auth + realtime examples | High | Med | 5 | 2 | P1 |

---

## Phase 5 — Realtime integration

```html
<div hx-ext="ws" ws-connect="/ws">
  <div id="messages"></div>
  <form ws-send><input name="msg"></form>
</div>
```

**Evaluation:** HTMX's native `ws` extension speaks plain WebSocket and swaps
incoming HTML into the DOM. StreetJS already ships a bounded WebSocket server with
heartbeat + auth-on-upgrade (VERIFIED), so the server just renders HTML fragments
(via the view engine) and pushes them to subscribed sockets.

**Recommended architecture:** controller renders the initial page → HTMX opens the
WS to `/ws` → server broadcasts rendered **HTML partials** (not JSON) to channel
members → HTMX swaps them in. SSE is the simpler alternative for one-way streams
(notifications, live dashboards) and reuses core SSE. Multi-instance fan-out uses
`@streetjs/plugin-redis`.

| Recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| HTMX `ws-ext` + StreetJS WS (render HTML, not JSON) | Med | Med | 4 | 2 | P1 |
| SSE helper for one-way streams | Med | Low | 3 | 1 | P1 |

---

## Phase 6 — Documentation `/docs/htmx/`

GitHub-Pages-safe (just-the-docs, nav_order under a parent). Roadmap:

1. **Getting Started** — `create --frontend htmx`, request lifecycle.
2. **Rendering Views** — layouts, pages, `ctx.view`.
3. **Partials & Fragments** — `ctx.partial`, `ctx.fragment`, HX-Request.
4. **Forms** — CSRF, validation errors as fragments.
5. **Authentication** — login/register with sessions + `HX-Redirect`.
6. **Realtime** — `ws-ext`, SSE, rendering HTML over the wire.
7. **Deployment** — Docker/VPS; serving `public/` + the view engine.

Each page: code example + link to the starter + JSON-LD. Add an HTMX comparison to
`/compare/`. — RECOMMENDATION.

| Recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| `/docs/htmx/` section (7 pages) | High | Med | 4 | 2 | P1 |

---

## Phase 7 — Marketing (evidence-based only)

Topics tie to real capabilities (server-rendered HTML, CSRF, sessions, WS, 2 deps):

- **Dev.to / Hashnode:** "Server-rendered apps in TypeScript with StreetJS + HTMX";
  "Typed controllers that return HTML"; "Realtime with HTMX over StreetJS WebSockets".
- **Reddit (r/htmx, r/node, r/typescript):** Show-and-tell of the HTMX starter.
- **LinkedIn:** "Full-stack without a SPA — the case for HTMX on a typed backend."
- **X:** thread + GIF of `create --frontend htmx` to a working CRUD app.

Claim only what's verifiable (no perf claims unless MEASURED). Reuse the
repurposing workflow in `CONTENT-DRAFTS.md` / `CONTENT-ROADMAP.md`.

| Recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| HTMX content series + launch posts | Med | Low | 4 | 1 | P1 |

---

## Phase 8 — Competitive positioning

| Stack | Strength | StreetJS stance |
|---|---|---|
| Laravel + Blade + HTMX | Mature, batteries, huge community | Compete on **TypeScript-native** + dependency minimalism |
| Django + HTMX | Mature, admin | Compete on TS + realtime built in |
| Rails + Hotwire | Polished SSR interactivity | Differentiate: typed controllers, signed plugins |
| Phoenix LiveView | Server-driven UI (stateful WS) | **Do not** rebuild LiveView's stateful diffing — too much surface; offer HTMX fragments instead |
| Express + HTMX | DIY, ubiquitous | Compete: integrated (auth/CSRF/WS/view) vs assemble-it-yourself |

**Where to compete:** TS/Node teams who want SSR interactivity without a SPA, with
auth/CSRF/realtime already integrated. **Where not to:** stateful LiveView-style
server diffing (scope/maintenance risk — **RISK**), and "frontend framework" framing.

**Positioning statement:**
> *StreetJS is the TypeScript backend for HTMX apps — typed controllers that return
> HTML, with authentication, CSRF, and realtime built in. Full-stack interactivity
> without a SPA, on a dependency-light, self-hostable core.*

---

## Final deliverables

**Ecosystem strategy:** ship HTMX as `@streetjs/plugin-htmx` + `--frontend htmx`
starter + `/docs/htmx/` + content. Core stays frontend-agnostic.

**Plugin architecture:** dependency-free view engine (Option E) + `ctx.view/partial/
fragment` + `ctx.hx.*` + CSRF/form helpers + SSE/WS helpers; signed manifest.

**Starter spec:** `src/views/{layouts,partials,pages}` + `public/` + CRUD/auth/
realtime examples + scaffold-build test.

**Docs roadmap:** 7 pages under `/docs/htmx/` + a `/compare/` entry.

**Marketing roadmap:** Dev.to/Hashnode/Reddit/LinkedIn/X, evidence-based, reusing
the existing content pipeline.

### 30-day plan
- Build `@streetjs/plugin-htmx` MVP: view engine (Option E), `ctx.view/partial/
  fragment`, `HX-Request` detection, `ctx.hx.redirect/trigger`, CSRF form helper.
- Unit tests; publish under the existing release flow.
- Draft `/docs/htmx/` Getting Started + Rendering + Forms.

### 90-day roadmap
- `--frontend htmx` starter (CRUD + auth + realtime examples) with a scaffold-build test.
- SSE + WS helpers; full `/docs/htmx/` (7 pages) + `/compare/htmx` entry.
- Launch content series; seed `r/htmx` show-and-tell.

### Success metrics
- `@streetjs/plugin-htmx` weekly npm downloads; `--frontend htmx` usage (CLI downloads).
- `/docs/htmx/` organic sessions; HTMX-tag keywords in Search Console top 20.
- ≥1 community HTMX showcase app within 90 days.

### Go / No-Go
**GO (P0).** High strategic fit, strongly on-brand (server-rendered HTML, typed
controllers, dependency-light), and fully achievable as a plugin + starter + docs
without touching core or the frontend-agnostic philosophy. The main risk —
scope-creep toward a stateful frontend framework — is mitigated by explicitly
declining LiveView-style server diffing and keeping everything out of core.

| Overall recommendation | Impact | Effort | Adoption | Maint | Priority |
|---|---|---|---|---|---|
| Ship HTMX ecosystem (plugin + starter + docs) | High | Med-High | 5 | 3 | **P0 — GO** |
