# StreetJS Plugin Marketplace — Plan & Audit (Phase 18, Workstream A)

> **Scope:** Ecosystem Visibility / Workstream A — Official Plugin Marketplace.
> **Type:** Planning + audit document only. No source, generator, or framework code is modified by this deliverable.
> **Finding tags:** every finding below is exactly one of **VERIFIED** (confirmed by reading source), **GAP** (absent / not implemented), **RISK** (present but a correctness/trust hazard), **RECOMMENDATION** (proposed change).
> **Method:** enumerated `packages/plugin-*`, read every `package.json`, checked each package directory for `manifest.signed.json`, read `scripts/gen-plugins-data.mjs`, `docs/_data/plugins.json`, `docs/plugins/marketplace.md`, and the existing root/ecosystem docs. Nothing here is assumed.

---

## 1. Executive Summary

The Official Plugin Marketplace is **real and largely built** (**VERIFIED**). A dependency-free build-time generator (`scripts/gen-plugins-data.mjs`) reads `packages/plugin-*/package.json` as the single source of truth and emits `docs/_data/plugins.json` plus one SEO page per category and one detail page per plugin. The discovery hub (`docs/plugins/marketplace.md`) renders server-side cards with client-side search and category filtering, safe for GitHub Pages.

Source verification confirms **21 `plugin-*` package directories**: **20 are listed** in the marketplace and **1 is intentionally hidden** (`@streetjs/plugin-marzpay`, via `streetjs.unlisted: true`). The current `docs/_data/plugins.json` reports `count: 20` across **9 categories** — consistent with source. Every listed plugin is **TypeScript-first, MIT, Node ≥ 20**, and declares **exactly one runtime dependency** (`streetjs` itself), i.e. **zero third-party runtime deps** — the "dependency-free" claim is accurate when read as "free of third-party deps."

The marketplace **meets** its core auto-generation requirements: no manual list duplication, generated from packages, and unlisted plugins are excluded (**VERIFIED**). The most important shortfalls are: (1) **trust badges are hardcoded, not derived** — every detail page asserts "Signed manifest" and "Dependency-free" regardless of the package's actual state, and `@streetjs/plugin-htmx` is listed yet has **no committed `manifest.signed.json`** (**RISK**); (2) several requested categories (**Realtime, Search, Observability, Integrations**) have **no category mapping and no plugins** (**GAP**); and (3) per-plugin **maintainer info, a visible GitHub/source link, and a numeric dependency count** are not surfaced (**GAP**).

**Top 3 gaps:** hardcoded/unverified trust signals (htmx unsigned but shown as signed); missing requested categories with no generator mapping; no maintainer / GitHub link / dependency-count surfaced per plugin.

---

## 2. VERIFIED Plugin Inventory

Source of truth: each `packages/plugin-*/package.json` (read directly) + on-disk `manifest.signed.json` check + `docs/_data/plugins.json`.

- **Runtime deps** = count of keys in `dependencies`. For every plugin this is **1** — the `streetjs` framework — i.e. **0 third-party** runtime dependencies.
- **Signed** = `manifest.signed.json` present in the package directory on disk.
- **Listed** = surfaced by the marketplace (passes the generator's `private` / `streetjs.unlisted` filter).

| # | Package | Ver | Category (generated) | Runtime deps | `private` | `unlisted` | `manifest.signed.json` | Listed? | Why |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `@streetjs/plugin-openai` | 1.0.2 | AI | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 2 | `@streetjs/plugin-auth0` | 1.0.2 | Auth & Identity | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 3 | `@streetjs/plugin-clerk` | 1.0.2 | Auth & Identity | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 4 | `@streetjs/plugin-firebase` | 1.0.2 | Auth & Identity | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 5 | `@streetjs/plugin-redis` | 1.0.2 | Cache & KV | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 6 | `@streetjs/plugin-africastalking` | 1.0.1 | Communications | 1 (`streetjs` ^1.0.9) | no | no | PRESENT | **Listed** | passes filter |
| 7 | `@streetjs/plugin-mongodb` | 1.0.2 | Database | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 8 | `@streetjs/plugin-mysql` | 1.0.2 | Database | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 9 | `@streetjs/plugin-postgres` | 1.0.2 | Database | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 10 | `@streetjs/plugin-supabase` | 1.0.2 | Database | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 11 | `@streetjs/plugin-htmx` | 1.0.0 | Frontend & Views | 1 (`streetjs`) | no | no | **ABSENT** | **Listed** | passes filter — but no committed signed manifest (see RISK-1) |
| 12 | `@streetjs/plugin-kafka` | 1.0.2 | Messaging | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 13 | `@streetjs/plugin-nats` | 1.0.2 | Messaging | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 14 | `@streetjs/plugin-rabbitmq` | 1.0.2 | Messaging | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 15 | `@streetjs/plugin-sendgrid` | 1.0.2 | Messaging | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 16 | `@streetjs/plugin-twilio` | 1.0.2 | Messaging | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 17 | `@streetjs/plugin-paypal` | 1.0.2 | Payments | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 18 | `@streetjs/plugin-stripe` | 1.0.2 | Payments | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 19 | `@streetjs/plugin-r2` | 1.0.2 | Storage | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 20 | `@streetjs/plugin-s3` | 1.0.2 | Storage | 1 (`streetjs`) | no | no | PRESENT | **Listed** | passes filter |
| 21 | `@streetjs/plugin-marzpay` | 1.0.0 | (would be Payments) | 1 (`streetjs`) | no | **yes** | PRESENT | **Hidden** | `streetjs.unlisted: true` → excluded by generator |

**VERIFIED inventory facts**
- **VERIFIED:** 21 `plugin-*` directories; 20 listed, 1 hidden. Matches `docs/_data/plugins.json` `count: 20`.
- **VERIFIED:** No plugin sets `"private": true`. The only exclusion in use is `streetjs.unlisted` (marzpay).
- **VERIFIED:** Every plugin declares exactly one runtime dependency (`streetjs`). No third-party runtime deps anywhere — supports the "dependency-free" positioning.
- **VERIFIED:** 20 of 21 packages carry a committed `manifest.signed.json`. **GAP/RISK:** `plugin-htmx` does **not** (only `manifest.json` is present on disk), yet it is listed and its generated detail page asserts it is signed.
- **VERIFIED:** Category distribution (listed): Database 4, Messaging 5, Auth & Identity 3, Payments 2, Storage 2, AI 1, Cache & KV 1, Communications 1, Frontend & Views 1 → 9 categories, 20 plugins.

---

## 3. Requirement-by-Requirement Gap Matrix (Workstream A)

Each row cites the file whose behavior was read.

| # | Requirement | Status | Evidence / Notes |
|---|---|---|---|
| R1 | **Search** | **VERIFIED** | `docs/plugins/marketplace.md` — `#mkt-search` input filters cards client-side by `data-text` (name + title + description + keywords). Vanilla JS, GitHub-Pages-safe. |
| R2 | **Category filtering** | **VERIFIED** | `docs/plugins/marketplace.md` — `#mkt-chips` chips toggle on `data-cat`; chips generated from `data.categories`. |
| R3 | **Plugin detail pages** | **VERIFIED** | `gen-plugins-data.mjs` writes `docs/plugins/registry/<slug>.md` → `/plugins/<slug>/` with Overview, Trust signals, Install, Quick start, Compatibility, Certification, Related plugins. |
| R4 | **Installation instructions** | **VERIFIED** | Detail page emits an `## Install` block with `npm install <name>`. Hub also shows `npm install {{ data.plugins[0].name }}`. |
| R5 | **npm links** | **VERIFIED** | `npm` field = `https://www.npmjs.com/package/<name>`; rendered on hub card ("npm →") and detail page. |
| R6 | **GitHub / source links** | **GAP** | No human-visible per-plugin GitHub link on hub or detail page. The repo URL appears only inside the `SoftwareSourceCode` JSON-LD `codeRepository` (`github.com/hassanmubiru/StreetJS`) — invisible to users and not the per-package path. |
| R7 | **Version display** | **VERIFIED (partial)** | Version shown on detail pages (`**Version:** v<x>`) and category pages (table column). **GAP:** the **hub marketplace card does not render the version** — the `.ver` element is reused for the "Details →" link, not `p.version`. |
| R8 | **Compatibility display** | **VERIFIED (static)** | Detail page renders a compatibility matrix (StreetJS `>=1.0.0`, Node `>=20`, TS `>=5.0`). **RISK:** values are **hardcoded in the generator**, not read from each package's `engines`/`peerDependencies`, so they cannot drift with the package. |
| R9 | **Signed badge** | **VERIFIED (unconditional)** | Detail page asserts "✅ Signed manifest (Ed25519)" and "· Signed ·" for **every** plugin. **RISK:** not derived from presence of `manifest.signed.json`; htmx is shown signed but is unsigned on disk. |
| R10 | **Verified badge** | **GAP** | The certification program (`docs/ecosystem/plugin-certification.md`) defines an **Official / Verified / Community** trust gradient, but the generator hardcodes `tier: 'Official'` for all and renders only that one badge. No distinct "Verified" badge is surfaced, and the tier is not data-driven. |
| R11 | **Dependency count** | **GAP** | Neither hub nor detail page shows a numeric dependency count. A static "Dependency-free" label is printed unconditionally rather than computed from `dependencies` (which is `streetjs` only). |
| R12 | **Maintainer information** | **GAP** | `package.json author` is `"street contributors"`, but no maintainer/author is rendered on the hub or detail pages. CODEOWNERS exists at repo level but is not surfaced in the marketplace. |

### 3a. Category set: requested vs. generator's actual

Generator categories (`scripts/gen-plugins-data.mjs` `CATEGORIES` regex map): **Database, Cache & KV, Messaging, Storage, Payments, Auth & Identity, Communications, AI, Frontend & Views** + fallback **Other**. Categories actually emitted in `plugins.json` (9): AI, Auth & Identity, Cache & KV, Communications, Database, Frontend & Views, Messaging, Payments, Storage. (`Other` is defined but currently unused — no plugin falls through.)

| Requested category | In generator map? | Has ≥1 plugin? | Status | Notes |
|---|---|---|---|---|
| Authentication | Yes (as **Auth & Identity**) | Yes (3) | **VERIFIED** (label differs) | Requested "Authentication" maps to existing "Auth & Identity"; consider an alias. |
| Payments | Yes | Yes (2) | **VERIFIED** | stripe, paypal (marzpay hidden). |
| AI | Yes | Yes (1) | **VERIFIED** | openai. |
| Realtime | **No** | **No** | **GAP** | No regex, no plugin. Closest is "Messaging" (kafka/nats/rabbitmq pub/sub) but it is not labeled Realtime. |
| Storage | Yes | Yes (2) | **VERIFIED** | s3, r2. |
| Search | **No** | **No** | **GAP** | No regex, no plugin. A non-plugin `packages/search` exists but is **not** a `plugin-*` package, so it is excluded by design. |
| Messaging | Yes | Yes (5) | **VERIFIED** | kafka, nats, rabbitmq, sendgrid, twilio. |
| Observability | **No** | **No** | **GAP** | No regex and no package at all (`packages/observability` does not exist). |
| Frontend & Views | Yes | Yes (1) | **VERIFIED** | htmx. |
| Integrations | **No** | **No** | **GAP** | No regex, no plugin; would otherwise be the `Other` catch-all. |

**VERIFIED:** the generator also ships categories **not** in the requested set — **Database, Cache & KV, Communications** — so the requested taxonomy and the implemented taxonomy diverge in both directions.

**VERIFIED (exclusion of non-plugin packages):** the generator scans only `readdirSync(pkgsDir).filter(d => d.startsWith('plugin-'))`. Confirmed non-plugin scoped packages present in `packages/` that are therefore **excluded** from the marketplace: `ai`, `search`, `storage`, `orm`, `edge`, `devtools`, `admin`, `admin-ui`, `ai-ui`, `auth-ui`, `cli`, `client`, `commerce`, `core`, `core-compat`, `next`, `nuxt`, `react`, `vue`, `registry-server`, `dating-auth`, `dating-messaging`, `dating-moderation`, `dating-profiles`, `social-comments`, `social-feed`, `social-notifications`, `social-users`. (`observability` and `realtime` packages do not exist.) This is **by design** — they are framework/app packages, not signed `@streetjs/plugin-*` units.

---

## 4. Auto-generation / "no manual duplication" / "unlisted hidden" verification

- **VERIFIED — single source of truth, no manual list:** `gen-plugins-data.mjs` derives everything from `packages/plugin-*/package.json` and writes `docs/_data/plugins.json` + category + detail pages. The hub (`marketplace.md`) reads `site.data.plugins` via Liquid — no hand-maintained plugin list.
- **VERIFIED — `private` excluded:** `if (pj.private) continue;`. (No plugin currently uses it.)
- **VERIFIED — `unlisted` excluded:** `if (pj.streetjs && pj.streetjs.unlisted) continue;`.
- **VERIFIED — marzpay is hidden:** `packages/plugin-marzpay/package.json` sets `"streetjs": { "unlisted": true }`; it is absent from `docs/_data/plugins.json` (which lists 20, not 21). The exclusion works as specified.
- **VERIFIED — regeneration is idempotent/clean:** the generator `rmSync`s `docs/plugins/category` and `docs/plugins/registry` before writing, so removed/renamed plugins and categories do not linger.
- **VERIFIED — description hygiene:** the generator strips trailing "Signed manifest…" marketing text from descriptions (`.replace(/\s*Signed manifest.*$/i, '')`).

---

## 5. RISKs

- **RISK-1 (trust integrity — highest):** Trust badges are **hardcoded**, not derived. Every detail page asserts "Signed manifest (Ed25519)", "Dependency-free", and "npm provenance" for all plugins unconditionally. `plugin-htmx` is **listed and shown as signed** but has **no committed `manifest.signed.json`**. A marketplace whose "signed/verified" claims are not computed from actual artifacts can display a false trust signal — directly contrary to the "signed plugins / no marketing claims without evidence" principle.
- **RISK-2 (compatibility drift):** The compatibility matrix on every detail page is static (`StreetJS >=1.0.0`, `Node >=20`, `TS >=5.0`) and ignores each package's real `engines`/`peerDependencies`. If a plugin raises its floor (e.g. africastalking depends on `streetjs ^1.0.9` vs others' `^1.0.6`), the page will misstate compatibility.
- **RISK-3 (stale companion doc):** `PLUGIN-MARKETPLACE.md` states "8 category pages" and "19 detail pages", but current `plugins.json` yields **9 categories / 20 detail pages** (htmx + "Frontend & Views" were added later). Generated output is correct; the prose doc is stale.
- **RISK-4 (taxonomy expectation mismatch):** Stakeholders asking for Realtime/Search/Observability/Integrations will find no landing pages, which can read as "missing capability" even where an adjacent category (Messaging) or a non-plugin package (`packages/search`) covers part of the need.
- **RISK-5 (single-publisher signing key):** All "Official" badges imply one StreetJS signing key; the certification doc's "Verified" (third-party key) tier is documented but not represented in marketplace data, so there is no data path to safely list third-party plugins later.

---

## 6. RECOMMENDATIONS (prioritized, planning-only)

Each item lists **ROI (High/Med/Low)**, **Adoption Impact**, and **Maintenance Cost**. All changes are confined to `scripts/gen-plugins-data.mjs`, the Jekyll templates, and per-package metadata — **no core framework changes**.

### Implementation Order

1. **REC-1 — Derive trust signals from artifacts (fix RISK-1).**
   Make the generator compute `signed` from the on-disk presence (and, ideally, verification) of `manifest.signed.json`, and compute `depCount` from `dependencies`. Render "Signed"/"Dependency-free" badges **only when true**; otherwise omit or mark accordingly. Either sign+commit `plugin-htmx`'s manifest or stop labeling it signed.
   - **ROI: High** — restores truthfulness of the marketplace's core value prop (signed, dependency-free) at low effort; one generator change covers all pages.
   - **Adoption Impact: High** — trustworthy badges are the primary reason teams adopt an "official" marketplace.
   - **Maintenance Cost: Low** — derived at build time from data already in the repo; self-correcting.

2. **REC-2 — Surface dependency count + maintainer + GitHub link (close R6, R11, R12).**
   Add `depCount` (computed), `maintainer` (from `author`/CODEOWNERS), and a per-package source link (`repository.url` + `packages/plugin-<slug>`) to `plugins.json` and render on hub cards and detail pages.
   - **ROI: High** — closes three requirement gaps with one metadata pass.
   - **Adoption Impact: Med/High** — maintainer + source link materially increase reviewer trust and contribution.
   - **Maintenance Cost: Low** — fields already exist in `package.json`/repo; generated, not hand-kept.

3. **REC-3 — Make compatibility data-driven (fix RISK-2).**
   Read `engines.node`, `peerDependencies`, and the declared `streetjs` range per package into `plugins.json`; render the real values in the matrix.
   - **ROI: Med** — improves accuracy; lower visibility than badges.
   - **Adoption Impact: Med** — matters most to teams on older runtimes.
   - **Maintenance Cost: Low** — sourced from each `package.json`.

4. **REC-4 — Render version on hub cards (close R7 fully).**
   Emit `v{{ p.version }}` on each marketplace card (data already present).
   - **ROI: Med** — small, high-polish win; aids at-a-glance scanning.
   - **Adoption Impact: Low/Med.**
   - **Maintenance Cost: Low** — template-only.

5. **REC-5 — Reconcile taxonomy with requested categories (address RISK-4 / category GAPs).**
   Add alias display ("Authentication" → Auth & Identity) and decide explicitly, per requested-but-empty category (Realtime, Search, Observability, Integrations), whether to (a) add a regex mapping that will populate when a matching plugin ships, (b) show an empty "coming soon" category, or (c) document them as out-of-scope. Do **not** invent plugins to fill them.
   - **ROI: Med** — aligns marketplace with stakeholder mental model; prevents "missing capability" misreads.
   - **Adoption Impact: Med** — better navigation/SEO landing coverage.
   - **Maintenance Cost: Low** — generator map + intro copy only; empty categories add thin-content/SEO risk, so prefer alias + on-demand mapping over empty pages.

6. **REC-6 — Add a `tier`/`certification` data field for the Verified gradient (address RISK-5, R10).**
   Drive `tier` from per-package metadata (default Official) so the documented Verified/Community levels become representable when third-party plugins are added, and render the matching badge.
   - **ROI: Med** — unlocks future third-party listings; low immediate payoff while all plugins are first-party.
   - **Adoption Impact: Med (future).**
   - **Maintenance Cost: Med** — needs a small governance rule for who sets the tier.

7. **REC-7 — Refresh `PLUGIN-MARKETPLACE.md` counts / regenerate (fix RISK-3).**
   Re-run the generator and update the companion prose to 9 categories / 20 detail pages, or stop hardcoding counts in prose and point to `plugins.json`.
   - **ROI: Low** — documentation hygiene.
   - **Adoption Impact: Low.**
   - **Maintenance Cost: Low.**

### ROI ranking summary

| ROI | Recommendations |
|---|---|
| **High** | REC-1 (truthful badges), REC-2 (deps/maintainer/GitHub) |
| **Med** | REC-3 (data-driven compat), REC-4 (version on cards), REC-5 (taxonomy reconcile), REC-6 (Verified tier data) |
| **Low** | REC-7 (doc refresh) |

---

## 7. Evidence Index (files read)

- `scripts/gen-plugins-data.mjs` — generator: source scan, `private`/`unlisted` exclusion, `CATEGORIES` regex map, category + detail page emission, hardcoded trust/compat blocks.
- `packages/plugin-*/package.json` (all 21) — name, version, description, keywords, `dependencies` (always `streetjs` only), `private` (none), `streetjs.unlisted` (marzpay only).
- On-disk `manifest.signed.json` check across all 21 packages — present for 20; **absent for `plugin-htmx`**.
- `docs/_data/plugins.json` — generated data: `count: 20`, 9 categories, 20 plugin records (marzpay absent).
- `docs/plugins/marketplace.md` — hub: JSON-LD ItemList, search (`#mkt-search`), category chips (`#mkt-chips`), cards (category/tier/title/pkg/description/Details/npm); no version or GitHub on card.
- `docs/ecosystem/plugin-certification.md` — Official/Verified/Community trust gradient (basis for R10/REC-6).
- `PLUGIN-MARKETPLACE.md`, `ECOSYSTEM-PLUGINS-AUDIT.md`, `docs/plugins.md`, `docs/plugins-official.md`, `docs/plugin-registry.md`, `docs/ecosystem/plugin-author-guide.md` — read to avoid duplication; this plan extends (does not restate) them and flags the stale counts in `PLUGIN-MARKETPLACE.md`.
- `packages/` listing — confirmed non-plugin scoped packages excluded by the `plugin-*` filter.
