# Production Starters Roadmap — StreetJS Phase 17 (Workstream B)

> **⚠️ SUPERSEDED (Phase 18).** This Phase 17 roadmap is retained for history. The
> `--starter` system it proposed has since **shipped**: `street create` now supports
> `--starter saas|ai|realtime|marketplace|dating` (+ aliases), `--frontend
> none|react|next|htmx`, `--database sqlite|postgres`, and the SaaS `--with-billing
> / --with-marzpay / --with-admin-ui / --with-email` opt-in flags. See the live
> [Starters catalog](/StreetJS/starters/) and `STARTER-CATALOG-PLAN.md` for the
> current source-verified state. The "Current state" section below is historical.

> Tags: **VERIFIED** · **GAP** · **RECOMMENDATION**.

## Current state — VERIFIED (Phase 17 — now historical)

`street create` (`packages/cli/src/commands/create.ts`) generates a backend
project and supports:

- `--frontend next | react` (full scaffold; Next 16 / React 19 verified) — VERIFIED
- `--database postgres | sqlite` (sqlite default, zero-config boot) — VERIFIED
- CI workflow, lockfile, secure ephemeral dev keys — VERIFIED

~~There is **no `--starter` flag** and no domain-specific starter templates.~~ —
**RESOLVED in Phase 18**: a working `--starter`/`--template` system now ships with
six templates, friendly aliases, four frontends (incl. `htmx`), and SaaS `--with-*`
flags. See [Starters](/StreetJS/starters/).

The CLI also already exposes `generate` (controller/service/repository/middleware),
`add`, `plugin`, `seed`, `migrate`, so starters can compose existing generators
rather than hand-rolling files.

## Design — `street create my-app --starter <name>`

Proposed flag, additive and non-breaking (default = current bare template):

```bash
street create my-app --starter saas --database postgres
```

Each starter is a composition layer over the existing scaffold + generators +
official plugins (no new framework features required).

### `--starter saas` — RECOMMENDATION (highest ROI)
- Auth: email/password + sessions + OAuth presets (`plugin-oauth`)
- Teams + roles (RBAC) using core guards
- Billing via `@streetjs/plugin-stripe` (subscriptions + webhook handler)
- Dashboard (Next frontend) + protected API
- PostgreSQL entities: User, Team, Membership, Subscription
- Seed data + migrations wired

### `--starter realtime`
- `@streetjs/core` WebSocket server + typed events + SSE
- Chat channels, presence, notifications
- Auth-on-upgrade; Redis fan-out optional via `plugin-redis`

### `--starter ai`
- `@streetjs/plugin-openai` chat + streaming endpoint
- Minimal chat UI (Next), SSE token streaming
- Embeddings-ready: pgvector-style table + repository stubs

### `--starter marketplace`
- Entities: User, Product, Order, Payment
- Stripe Connect-ready payments; order state machine via core saga engine
- Search via `@streetjs/search` (PG full-text default)

### `--starter cms`
- Content models + admin dashboard (`@streetjs/admin` / `admin-ui` — VERIFIED these packages exist)
- Media uploads via `@streetjs/plugin-s3` or `plugin-r2`
- Draft/publish workflow

## Implementation strategy

1. Introduce a `starters/` template registry inside `packages/cli` (one dir per
   starter; reuse the existing template-copy + token-substitution pipeline).
2. Add `--starter` parsing to `create.ts`; validate against the registry; default
   to the current template when omitted (non-breaking).
3. Each starter ships an integration test that scaffolds → `npm install` →
   `npm run build` in a temp dir (mirror the existing `create-boot.integration.test.ts`
   pattern). **Add new test files to the explicit lists in `packages/cli/package.json`**
   `test`/`coverage` scripts or coverage drops and CI won't run them.
4. Keep coverage ≥ 85% branches (current gate).

## Priority & impact

| Starter | Effort | Adoption impact | Order |
|---|---|---|---|
| saas | L | Very High | 1 |
| ai | M | High | 2 |
| realtime | M | High | 3 |
| marketplace | L | Medium | 4 |
| cms | L | Medium | 5 |

**RECOMMENDATION:** ship `saas` first — it's the highest-intent search term
("typescript saas starter") and exercises auth + billing + teams + dashboard,
the four things every SaaS evaluator checks in the first five minutes.
