# Starter Catalog Plan — StreetJS Phase 18, Workstream B

> **Scope:** Audit of the `street create` starter/template catalog and the
> `/starters/` discovery surface, with a prioritized plan to close gaps.
> **Method:** Every claim below was verified from source. No core framework
> changes are proposed. No fake starters are invented — where a requested
> starter does not exist, a roadmap page is recommended instead.
> **Tags:** every finding is exactly one of **VERIFIED** / **GAP** / **RISK** / **RECOMMENDATION**.

Primary sources read for this audit:
- `packages/cli/src/commands/create.ts` (the scaffolder — `TEMPLATES`, `STARTER_ALIASES`, `FRONTENDS`, `DATABASES`, `--with-*` flags, `CreateCommand.execute`)
- `docs/starters.md` (the `/starters/` discovery page)
- `docs/cli-reference.md`, `docs/cli/commands.md`, `docs/examples/index.md`, `docs/roadmap.md`
- `STARTERS-ROADMAP.md` (Phase 17 roadmap)
- `packages/` (package existence checks)

---

## 1. Executive Summary

The `street create` scaffolder is **further along than the docs claim**. The
Phase 17 `STARTERS-ROADMAP.md` still says "There is **no `--starter` flag**",
but the current `create.ts` ships a working `--starter`/`--template` system with
six real templates, four friendly aliases, four frontends, two databases, and
four opt-in `--with-*` flags. — **VERIFIED** (`packages/cli/src/commands/create.ts:32`, `:3883`, `:3890`, `:3901`)

The real gaps are **not in the engine — they are in discovery and accuracy**:

1. **Documentation drift.** `docs/starters.md` attributes the SaaS starter to
   `@streetjs/admin`, but the actual default SaaS scaffold composes
   `@streetjs/plugin-htmx` + core `requireRoles` and treats `@streetjs/admin` as
   an *optional* upgrade. `docs/cli-reference.md` lists only `none|react|next`
   frontends (omits the real `htmx` frontend) and omits all `--with-*` flags.
   `docs/cli/commands.md` documents `street create` with only `--install`.
2. **Workstream B discovery requirements unmet.** `/starters/` (`docs/starters.md`)
   has install commands but **no screenshots, no architecture diagrams, no
   per-starter feature detail, and no per-starter docs links**.
3. **A naming-expectation mismatch.** `--starter htmx` **does not exist** — `htmx`
   is a `--frontend` value, not a template. This is a real footgun worth an
   explicit doc fix (and optionally a friendlier CLI error).

Top-line recommendation: **fix accuracy first (cheap, high trust), then enrich
`/starters/` discovery (screenshots/diagrams/feature lists/doc links), then
address the `htmx` naming mismatch.** No new starters need to be invented to
satisfy Workstream B; the AI, SaaS, realtime, ecommerce, and dating starters all
already exist in source.

---

## 2. VERIFIED Inventory — Templates, Frontends, Databases, Flags

### 2.1 Real `--starter` / `--template` values (`TEMPLATES`)

`export const TEMPLATES` (`create.ts:32`) defines exactly six keys. `--starter`
is a friendly alias of `--template`; both resolve through the same map
(`create.ts:3890`). — **VERIFIED**

| `--starter` key | Always-on packages | Starter module | Extra files (migrations / docs / overlay) | Flag-gated packages |
|---|---|---|---|---|
| `app` *(default)* | _(none)_ | _(none — empty `starter`)_ | _(none)_ | _(none)_ |
| `saas` | `@streetjs/plugin-htmx ^1.0.0` | `src/features/saas.ts` (RBAC via core `requireRoles`) | `migrations/001_saas.sql`, `002_api_keys.sql`, `003_settings.sql`; `src/middleware/tenant.ts` + `apiKeyAuth.ts`; org / membership / invitation / apikey / settings / audit / notification services; `src/types/street-saas.d.ts`; `SAAS.md`; `.env.saas.example`; billing + admin-ui + marzpay overlays (flag-gated) | `with-billing`→`@streetjs/plugin-stripe ^1.0.2`; `with-admin-ui`→`@streetjs/auth-ui ^0.1.2` + `@streetjs/admin-ui ^0.1.2`; `with-marzpay`→`@streetjs/plugin-marzpay ^1.0.0` |
| `ecommerce` | `@streetjs/commerce ^1.0.0` | `src/features/ecommerce.ts` | `migrations/001_commerce.sql`; `COMMERCE.md` | _(none)_ |
| `realtime-chat` | `@streetjs/social-users ^1.0.0` | `src/features/chat.ts` | `migrations/001_realtime.sql`; `REALTIME.md` | _(none)_ |
| `dating-app` | `@streetjs/dating-profiles ^1.0.0` | `src/features/dating.ts` | **none** | _(none)_ |
| `ai` | `@streetjs/ai ^1.0.0` | `src/features/ai.ts` | **none** | _(none)_ |

Source: `create.ts:33` (`app`), `:39` (`saas`), `:3643` (`ecommerce`), `:3752`
(`realtime-chat`), `:3825` (`dating-app`), `:3839` (`ai`). — **VERIFIED**

**GAP:** the `ai` and `dating-app` starters are noticeably thinner than the
others — they ship a one-file feature stub with **no migration and no per-starter
README overlay** (no `AI.md` / `DATING.md`), whereas `saas`, `ecommerce`, and
`realtime-chat` each ship migrations + a `*.md` guide. (`create.ts:3825`, `:3839`)

### 2.2 Friendly aliases (`STARTER_ALIASES`, `create.ts:3883`)

| Alias | Resolves to | Status |
|---|---|---|
| `realtime` | `realtime-chat` | **VERIFIED** |
| `chat` | `realtime-chat` | **VERIFIED** |
| `marketplace` | `ecommerce` | **VERIFIED** |
| `dating` | `dating-app` | **VERIFIED** |

Resolution: `const template = STARTER_ALIASES[requested] ?? requested;` then
validated against `TEMPLATES`; unknown values exit 1 with an "Unknown starter"
message listing both template keys and aliases (`create.ts:3890`–`:3896`). — **VERIFIED**

### 2.3 Frontends (`FRONTENDS`, `create.ts:3901`)

`const FRONTENDS = ['none', 'react', 'next', 'htmx'];` — **VERIFIED**

| `--frontend` | What it scaffolds | Source |
|---|---|---|
| `none` *(default)* | Backend only; CI without a `web:` job | `create.ts:3900`, `:6232` |
| `react` | Vite SPA under `web/` wired to `@streetjs/client` + `@streetjs/react`; web CI job; MarzPay React overlay | `create.ts:4204` |
| `next` | App-Router Next.js app under `web/` + `@streetjs/next`; MarzPay Next overlay | `create.ts:4217` |
| `htmx` | Server-rendered views **into the backend** (no `web/`), adds `@streetjs/plugin-htmx`, views controller, MarzPay HTMX overlay; CI has no `web:` job | `create.ts:4232`, `:4238` |

Root sample scaffolds confirm these outputs exist: `app-none/`, `app-react/`,
`app-next/`, `app-htmx/`. — **VERIFIED** (directory listing at repo root)

### 2.4 Databases (`DATABASES`, `create.ts:3915`)

`['sqlite', 'postgres']`; default `sqlite` (zero-config boot); `postgres`
degrades gracefully if unreachable. — **VERIFIED**

### 2.5 Opt-in `--with-*` flags (`create.ts:3931`–`:3935`)

Parsed into a `starterFlags` set and passed to `applyTemplate`; each flag gates
overlay file(s) and adds only the deps those files import. These are **only
meaningful for the `saas` template** (only `saas` defines `flagPackages` /
`flag`-tagged `extraFiles`). — **VERIFIED**

| Flag | Adds packages | Gated overlay |
|---|---|---|
| `--with-billing` | `@streetjs/plugin-stripe ^1.0.2` | Stripe webhook controller `src/modules/billing/billing.controller.ts` |
| `--with-admin-ui` | `@streetjs/auth-ui ^0.1.2`, `@streetjs/admin-ui ^0.1.2` | Auth/RBAC React management screens |
| `--with-email` | _(none auto-added; `@streetjs/plugin-sendgrid` install-on-demand)_ | Email delivery for notifications (injected `Mailer`) |
| `--with-marzpay` | `@streetjs/plugin-marzpay ^1.0.0` | MarzPay billing service/controllers/dashboard under `src/modules/billing/` |

**VERIFIED note:** `--with-email` does **not** appear in `saas.flagPackages`
(`create.ts:59`–`77` defines only `with-billing`, `with-admin-ui`, `with-marzpay`),
matching the in-source comment that SendGrid is install-on-demand. So the flag
gates files but adds no dependency automatically.

### 2.6 Referenced-package existence check (`packages/`)

All packages referenced by the templates and flags **exist** in the monorepo:
`ai`, `commerce`, `social-users`, `dating-profiles`, `plugin-htmx`,
`plugin-stripe`, `auth-ui`, `admin-ui`, `plugin-sendgrid`, `plugin-marzpay`,
`admin`. — **VERIFIED** (directory listing of `packages/`)

### 2.7 The four specifically-requested values

| Requested | Exists? | Evidence | Verdict |
|---|---|---|---|
| `--starter saas` | **Yes** | `TEMPLATES.saas` (`create.ts:39`) | **VERIFIED** |
| `--starter ai` | **Yes** | `TEMPLATES.ai` (`create.ts:3839`) | **VERIFIED** |
| `--starter realtime` | **Yes (via alias)** | `STARTER_ALIASES.realtime → realtime-chat` (`create.ts:3884`) | **VERIFIED** |
| `--starter htmx` | **No** | `htmx` is **not** in `TEMPLATES` nor `STARTER_ALIASES`; it is a `--frontend` value (`create.ts:3901`) | **GAP / naming mismatch** |

**RISK:** Running `street create x --starter htmx` exits 1 with
`Unknown starter "htmx"` (`create.ts:3893`). A user who read a comparison page or
expected "htmx" as a starter (it is a popular hypermedia approach) hits a dead end
even though `--frontend htmx` is exactly what they want. See Recommendation R5.

---

## 3. `/starters/` Discovery Audit (`docs/starters.md`) vs Workstream B

Workstream B requires each starter to be discoverable with: **features, install
commands, docs links, screenshots, architecture diagrams.**

### 3.1 Accuracy findings on `docs/starters.md`

- **RISK:** The SaaS row reads "Admin users, roles (RBAC) and an audit log
  (`@streetjs/admin`)". The actual default SaaS scaffold composes
  `@streetjs/plugin-htmx` + **core** `requireRoles` and explicitly documents
  `@streetjs/admin` as an *optional* upgrade only (`create.ts:56`, `:81`–`:99`).
  The page overstates the dependency and understates what actually ships
  (multi-tenant orgs, API keys, invitations, settings, audit, notifications).
- **GAP:** The page advertises `--frontend next|react` (`docs/starters.md:21`) but
  omits the real `htmx` frontend.
- **GAP:** The page never mentions the `--with-billing` / `--with-admin-ui` /
  `--with-email` / `--with-marzpay` flags at all.
- **VERIFIED:** The `ai` starter is listed and is real (`TEMPLATES.ai`), so the
  page is *not* over-claiming AI. Aliases listed (`realtime`, `marketplace`,
  `dating`) match source; `chat` alias is omitted (minor).

### 3.2 Workstream B requirement coverage matrix (per starter, on `/starters/`)

| Starter | Features detail | Install command | Docs link | Screenshot | Architecture diagram |
|---|---|---|---|---|---|
| `saas` | one-liner only — **GAP** | **VERIFIED** | **GAP** (no link to `SAAS.md` / a SaaS page) | **GAP** | **GAP** |
| `ai` | one-liner only — **GAP** | **VERIFIED** | **GAP** (no AI starter page; no `AI.md` exists) | **GAP** | **GAP** |
| `realtime-chat` | one-liner only — **GAP** | **VERIFIED** | **GAP** (no link to `REALTIME.md`) | **GAP** | **GAP** |
| `ecommerce` | one-liner only — **GAP** | **VERIFIED** | **GAP** (no link to `COMMERCE.md`) | **GAP** | **GAP** |
| `dating-app` | one-liner only — **GAP** | **VERIFIED** | **GAP** (no `DATING.md` exists) | **GAP** | **GAP** |
| `app` (minimal) | one-liner only — **GAP** | **VERIFIED** | n/a | **GAP** | n/a |

Summary: **install commands are the only Workstream-B requirement fully met.**
Features are shallow, and screenshots / architecture diagrams / per-starter docs
links are entirely absent. (`docs/starters.md:24`–`:48`)

### 3.3 Cross-doc consistency findings

- **GAP:** `docs/cli/commands.md` documents `street create` with only the
  `--install`/`-i` flag (`docs/cli/commands.md:21`–`:30`) — no `--starter`,
  `--frontend`, `--database`, or `--with-*`. This is the canonical command
  reference and is the most incomplete.
- **GAP:** `docs/cli-reference.md` `--frontend` row lists `none, react, next`
  (`docs/cli-reference.md:42`) — missing `htmx`. Its `--starter` row is otherwise
  accurate and even lists `ai` (`:41`).
- **GAP:** `docs/roadmap.md:69` lists templates as `app, saas, ecommerce,
  realtime-chat, dating-app` (omits `ai`) and `--frontend react|next` (omits
  `htmx`) — stale.
- **RISK:** `STARTERS-ROADMAP.md` opens with "There is **no `--starter` flag** and
  no domain-specific starter templates. — GAP" which directly contradicts the
  current source. The file is a Phase 17 artifact and is now misleading; it also
  proposes a `cms` starter that does **not** exist in `TEMPLATES`.

---

## 4. RISKs

- **R-RISK-1 (trust):** `docs/starters.md` mis-attributes the SaaS starter to
  `@streetjs/admin`. A developer who installs based on the page gets a different
  (and larger) dependency story than what scaffolds. Damages "no marketing claims
  without evidence."
- **R-RISK-2 (dead-end UX):** `--starter htmx` errors out; the error lists
  available starters but does **not** hint that the user wants `--frontend htmx`.
- **R-RISK-3 (stale roadmap):** `STARTERS-ROADMAP.md` claims the feature is
  unbuilt and references a non-existent `cms` starter. Readers may duplicate work
  or believe starters don't exist.
- **R-RISK-4 (thin starters look like stubs):** `ai` and `dating-app` ship no
  migration and no README overlay. If `/starters/` adds screenshots/architecture
  diagrams for them, there is little scaffolded substance to depict — risk of the
  page over-promising relative to what the template emits.
- **R-RISK-5 (doc coverage drift):** Four separate docs describe `create` flags
  inconsistently (`starters.md`, `cli-reference.md`, `cli/commands.md`,
  `roadmap.md`). Without a single source of truth, drift will recur.

---

## 5. Prioritized RECOMMENDATIONS

Each recommendation lists **Implementation Order**, **ROI ranking**, **Adoption
Impact**, and **Maintenance Cost**. None require core framework changes;
CLI-touching items are flagged explicitly.

### R1 — Correct `/starters/` accuracy (SaaS attribution, htmx frontend, `--with-*` flags)
- **What:** Rewrite the SaaS row to reflect the real default scaffold
  (`@streetjs/plugin-htmx` + core `requireRoles`; multi-tenant orgs, API keys,
  invitations, settings, audit, notifications), state `@streetjs/admin` is an
  *optional* upgrade, add the `htmx` frontend, and add a short `--with-*` flag
  table. Evidence: `create.ts:39`–`:99`, `:3901`, `:3931`.
- **Implementation Order:** 1 (do first — pure docs, unblocks trust).
- **ROI ranking:** Highest (small edit, removes a false claim).
- **Adoption Impact:** High — the SaaS starter is the highest-intent entry point.
- **Maintenance Cost:** Low.

### R2 — Make `/starters/` meet Workstream B: per-starter feature lists + docs links
- **What:** Expand each starter into a section with a real feature list and a
  "What gets scaffolded" file map (sourced from the `extraFiles` in `create.ts`),
  and link to the scaffolded guides that already exist (`SAAS.md`, `COMMERCE.md`,
  `REALTIME.md`). For `ai` and `dating-app`, link to the relevant package docs
  (`@streetjs/ai`, `@streetjs/dating-profiles`) since no overlay README exists yet.
- **Implementation Order:** 2.
- **ROI ranking:** High (docs-only; large discoverability gain).
- **Adoption Impact:** High.
- **Maintenance Cost:** Low–Medium (must track `create.ts` template changes).

### R3 — Add screenshots and architecture diagrams to `/starters/`
- **What:** Add one screenshot and one simple architecture/flow diagram per
  starter (e.g., the SaaS request → tenantResolver → org-scoped repo flow; the
  ecommerce cart → order → payment flow already described in `COMMERCE.md`; the
  realtime connect → channel → broadcast flow in `REALTIME.md`). Use diagrams that
  reflect **what actually scaffolds**, citing the overlay files.
- **Implementation Order:** 3.
- **ROI ranking:** Medium (higher effort: assets to produce and keep current).
- **Adoption Impact:** Medium–High (visuals drive evaluation conversions).
- **Maintenance Cost:** Medium (image assets drift as scaffolds evolve).

### R4 — Unify `create` flag documentation (single source of truth)
- **What:** Bring `docs/cli/commands.md` `street create` up to full flag coverage
  (`--starter`/`--template`, `--frontend` incl. `htmx`, `--database`, `--with-*`,
  `--install`), and fix `docs/cli-reference.md` `--frontend` row to include `htmx`
  and add a `--with-*` row. Update `docs/roadmap.md:69` to include `ai` and `htmx`.
- **Implementation Order:** 4.
- **ROI ranking:** High (cheap; kills recurring drift).
- **Adoption Impact:** Medium.
- **Maintenance Cost:** Low.

### R5 — Resolve the `--starter htmx` naming mismatch
- **What (docs-first):** Add an explicit note on `/starters/` and the CLI reference
  that htmx is a **frontend** (`--frontend htmx`), not a starter, and can be
  combined with any starter (e.g. `--starter saas --frontend htmx`).
- **Optional (CLI, not core):** Improve the "Unknown starter" error in
  `create.ts:3893` to detect `htmx` (and other frontend values) and print a hint:
  "did you mean `--frontend htmx`?" — **RECOMMENDATION, not an assumption**: this
  edits `packages/cli/src/commands/create.ts` (acceptable; it is CLI ergonomics,
  not a core framework change) and would need a unit test in
  `packages/cli/src/tests/`. Do **not** add a `htmx` entry to `TEMPLATES`/
  `STARTER_ALIASES` — that would imply a starter that doesn't exist.
- **Implementation Order:** 5.
- **ROI ranking:** Medium.
- **Adoption Impact:** Medium (removes a sharp edge for a popular approach).
- **Maintenance Cost:** Low (docs) / Low–Medium (the optional CLI hint + test).

### R6 — Retire/supersede `STARTERS-ROADMAP.md` and add roadmap pages for non-existent starters
- **What:** Mark `STARTERS-ROADMAP.md` as **superseded** (the `--starter` flag now
  exists) and convert its forward-looking items into a clearly-labeled roadmap.
  For starters that are **proposed but do not exist** — notably `cms` (referenced
  in the old roadmap) — publish a **roadmap page**, not a catalog entry. Do not add
  them to `/starters/` as if shippable. **RECOMMENDATION:** do not invent a `cms`
  starter; track it as planned.
- **Implementation Order:** 6.
- **ROI ranking:** Medium (prevents misinformation and duplicated effort).
- **Adoption Impact:** Low–Medium.
- **Maintenance Cost:** Low.

### R7 — (Optional) Bring `ai` and `dating-app` to parity with the other starters
- **What:** Consider adding a migration + an `AI.md` / `DATING.md` overlay so all
  starters ship comparable substance, making R3's diagrams/screenshots honest.
  **RECOMMENDATION, not an assumption** — this edits `create.ts` template content
  (CLI package, not core) and would need accompanying scaffold tests. Until done,
  R2/R3 should depict `ai`/`dating-app` accurately as lighter stubs.
- **Implementation Order:** 7 (defer; only if parity is a goal).
- **ROI ranking:** Low–Medium.
- **Adoption Impact:** Medium (AI is a high-intent term).
- **Maintenance Cost:** Medium.

---

## 6. Implementation Order Summary

1. **R1** — fix SaaS attribution + add htmx/`--with-*` to `/starters/` (accuracy).
2. **R2** — per-starter features + docs links on `/starters/`.
3. **R3** — screenshots + architecture diagrams.
4. **R4** — unify `create` flag docs across the four pages.
5. **R5** — htmx-frontend clarification (docs; optional CLI hint).
6. **R6** — supersede the Phase 17 roadmap; roadmap pages for non-existent (`cms`) starters.
7. **R7** — optional `ai`/`dating-app` parity (deferred).

All items 1–6 are **docs-only** except the *optional* CLI hint in R5; R7 is the
only template-content change and is explicitly deferred. **No core framework
changes are proposed anywhere in this plan.**

---

## 7. Evidence Index (files cited)

- `packages/cli/src/commands/create.ts` — `TemplateSpec` (`:11`), `TEMPLATES` (`:32`), `saas` (`:39`), `ecommerce` (`:3643`), `realtime-chat` (`:3752`), `dating-app` (`:3825`), `ai` (`:3839`), `STARTER_ALIASES` (`:3883`), template resolution (`:3890`), `FRONTENDS` (`:3901`), `DATABASES` (`:3915`), `--with-*` parsing (`:3931`), `scaffoldFrontend` (`:4202`), `scaffoldHtmx` (`:4238`), CI web-job gating (`:6232`).
- `docs/starters.md` — discovery page (`:21` frontends, `:24`–`:48` table).
- `docs/cli-reference.md` — flag table (`:41` starter, `:42` frontend).
- `docs/cli/commands.md` — `street create` section (`:21`–`:30`).
- `docs/examples/index.md` — `--template` usage examples (`:36`–`:46`).
- `docs/roadmap.md` — templates/frontends line (`:69`).
- `STARTERS-ROADMAP.md` — Phase 17 roadmap (stale "no `--starter` flag" claim; proposes `cms`).
- `packages/` — confirmed existence of `ai`, `commerce`, `social-users`, `dating-profiles`, `plugin-htmx`, `plugin-stripe`, `auth-ui`, `admin-ui`, `plugin-sendgrid`, `plugin-marzpay`, `admin`.
- Repo root — sample scaffolds `app-none/`, `app-react/`, `app-next/`, `app-htmx/`.
